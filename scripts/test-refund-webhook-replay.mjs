import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// Isolated webhook integration harness: replace only external imports with injected mocks.
const source = await readFile(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
const instrumented = source
  .replace('import { requireDb } from "./_lib.js";', "const requireDb = (...args) => globalThis.__refundTest.requireDb(...args);")
  .replace('import { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";',
    "const { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } = globalThis.__refundTest;");
assert.notEqual(instrumented, source, "Test harness must inject dependencies");
globalThis.__refundTest = { requireDb: () => { throw new Error("Mock database not installed"); } };
const { default: handler } = await import("data:text/javascript;base64," + Buffer.from(instrumented).toString("base64"));
const originalSecret = process.env.CREEM_WEBHOOK_SECRET;
process.env.CREEM_WEBHOOK_SECRET = "isolated-test-secret";
const event = { id: "evt_replay_001", eventType: "refund.created", object: {
  id: "ref_replay_001", status: "succeeded", refund_amount: 500, refund_currency: "USD",
  transaction: { id: "tran_replay_001", amount_paid: 500, status: "paid" }
}};
async function deliver(state, { failLookup = false } = {}) {
  const calls = [];
  const db = { from(table) {
    assert.equal(table, "creem_refund_events");
    return {
      select(cols) { assert.equal(cols, "state"); return this; },
      eq(key, value) { assert.equal(key, "event_id"); assert.equal(value, event.id); return this; },
      async maybeSingle() { return { data: state ? { state } : null, error: failLookup ? { message: "database unavailable" } : null }; },
      async upsert() { calls.push("upsert"); return { error: null }; }
    };
  }, async rpc() { calls.push("rpc"); return { data: true, error: null }; } };
  globalThis.__refundTest = { requireDb: () => db };
  const body = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET).update(body).digest("hex");
  const req = { method: "POST", headers: { "creem-signature": signature },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, send(s) { this.body = s; return this; } };
  await handler(req, res);
  return { calls, res };
}
try {
  const replay = await deliver("applied");
  assert.equal(replay.res.statusCode, 200);
  assert.match(replay.res.body, /already applied/);
  assert.deepEqual(replay.calls, [], "Applied replay must not write or reverse credits");

  const failure = await deliver(null, { failLookup: true });
  assert.equal(failure.res.statusCode, 500);
  assert.deepEqual(failure.calls, [], "Lookup failures must not mutate refund state");

  // Reject unauthenticated and non-POST requests before any database writes.
  const body = JSON.stringify(event);
  const makeRequest = (method, signature) => ({
    method, headers: { "creem-signature": signature },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); }
  });
  const makeResponse = () => ({
    statusCode: 200,
    status(n) { this.statusCode = n; return this; },
    send(value) { this.body = value; return this; }
  });
  const unexpectedDb = () => { throw new Error("Database must not be accessed"); };
  globalThis.__refundTest = { requireDb: unexpectedDb };
  const wrongMethod = makeResponse();
  await handler(makeRequest("GET", "irrelevant"), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  // The handler initializes its database before signature verification,
  // so use a no-write mock to verify the signature gate itself.
  let writes = 0;
  globalThis.__refundTest = { requireDb: () => ({
    from() { writes++; throw new Error("Unauthorized request reached database"); },
    rpc() { writes++; throw new Error("Unauthorized request reached RPC"); }
  }) };
  const invalidSignature = makeResponse();
  await handler(makeRequest("POST", "00".repeat(32)), invalidSignature);
  assert.equal(invalidSignature.statusCode, 401);
  assert.equal(writes, 0, "Invalid signatures must not access refund tables");


  // Financial reversal can commit before event-state recording fails.
  // A retry must call the idempotent refund RPC again and reach applied,
  // never report success for the failed first attempt.
  let recordedState = null;
  let rpcCalls = 0;
  let failFinalWrite = true;
  const recoveryDb = {
    from(table) {
      if (table === "creem_refund_events") return {
        select(columns) { assert.equal(columns, "state"); return this; },
        eq(column, value) { assert.equal(column, "event_id"); assert.equal(value, event.id); return this; },
        async maybeSingle() { return { data: recordedState ? { state: recordedState } : null, error: null }; },
        async upsert(record) {
          if (record.state === "applied" && failFinalWrite) {
            failFinalWrite = false;
            return { error: { message: "simulated event write failure after financial RPC" } };
          }
          recordedState = record.state;
          return { error: null };
        }
      };
      if (table === "audit_purchases") return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { id: "purchase-1", amount_cents: 500 }, error: null }; }
      };
      throw new Error("Unexpected table " + table);
    },
    async rpc(name, params) {
      assert.equal(name, "apply_creem_refund");
      assert.equal(params.p_refund_id, event.object.id);
      rpcCalls++;
      // Simulate the deployed SQL function's idempotent success on retry.
      return { data: true, error: null };
    }
  };
  globalThis.__refundTest = { requireDb: () => recoveryDb };
  const signedBody = JSON.stringify(event);
  const signedSignature = crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET)
    .update(signedBody).digest("hex");
  const recoveryRequest = () => ({
    method: "POST", headers: { "creem-signature": signedSignature },
    async *[Symbol.asyncIterator]() { yield Buffer.from(signedBody); }
  });
  const firstAttempt = makeResponse();
  await handler(recoveryRequest(), firstAttempt);
  assert.equal(firstAttempt.statusCode, 500, "Failed final event write must not acknowledge success");
  assert.equal(recordedState, "received", "Failure leaves a recoverable event state");
  assert.equal(rpcCalls, 1, "First attempt must execute financial reversal exactly once");
  const retry = makeResponse();
  await handler(recoveryRequest(), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body, "Refund applied");
  assert.equal(recordedState, "applied", "Retry must complete event reconciliation");
  assert.equal(rpcCalls, 2, "Retry must re-enter idempotent financial RPC");
  const finalReplay = makeResponse();
  await handler(recoveryRequest(), finalReplay);
  assert.equal(finalReplay.statusCode, 200);
  assert.match(finalReplay.body, /already applied/);
  assert.equal(rpcCalls, 2, "Applied replay must not re-enter financial RPC");


  // A signed but partial refund must be acknowledged for review without
  // reversing any audit credits. The purchase lookup must not be reached.
  async function deliverRefundCase(object, { purchase = null, lookupError = null } = {}) {
    const seen = { eventStates: [], purchaseLookups: 0, reversals: 0 };
    const caseEvent = { ...event, id: "evt_case_" + object.id.slice(4), object };
    globalThis.__refundTest = { requireDb: () => ({
      from(table) {
        if (table === "creem_refund_events") return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: null, error: null }; },
          async upsert(row) { seen.eventStates.push(row.state); return { error: null }; }
        };
        if (table === "audit_purchases") {
          seen.purchaseLookups++;
          return {
            select() { return this; },
            eq() { return this; },
            async maybeSingle() { return { data: purchase, error: lookupError }; }
          };
        }
        throw new Error("Unexpected table " + table);
      },
      async rpc() { seen.reversals++; return { data: true, error: null }; }
    }) };
    const payload = JSON.stringify(caseEvent);
    const signed = crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET)
      .update(payload).digest("hex");
    const request = { method: "POST", headers: { "creem-signature": signed },
      async *[Symbol.asyncIterator]() { yield Buffer.from(payload); } };
    const response = makeResponse();
    await handler(request, response);
    return { seen, response };
  }
  const partial = await deliverRefundCase({
    ...event.object, id: "ref_partial_001", refund_amount: 250
  });
  assert.equal(partial.response.statusCode, 200);
  assert.deepEqual(partial.seen.eventStates, ["received", "review_required"]);
  assert.equal(partial.seen.purchaseLookups, 0);
  assert.equal(partial.seen.reversals, 0, "Partial refunds must never reverse full credits");

  const missingPurchase = await deliverRefundCase({
    ...event.object, id: "ref_unlinked_001"
  });
  assert.equal(missingPurchase.response.statusCode, 200);
  assert.deepEqual(missingPurchase.seen.eventStates, ["received", "pending_link"]);
  assert.equal(missingPurchase.seen.purchaseLookups, 1);
  assert.equal(missingPurchase.seen.reversals, 0, "Unlinked refunds must not reverse credits");

  const shortPurchaseRefund = await deliverRefundCase({
    ...event.object, id: "ref_short_001"
  }, { purchase: { id: "purchase-1", amount_cents: 1000 } });
  assert.equal(shortPurchaseRefund.response.statusCode, 200);
  assert.deepEqual(shortPurchaseRefund.seen.eventStates, ["received", "review_required"]);
  assert.equal(shortPurchaseRefund.seen.reversals, 0, "Refund below stored purchase must not reverse credits");

  const failedPurchaseLookup = await deliverRefundCase({
    ...event.object, id: "ref_lookup_001"
  }, { lookupError: { message: "temporary database failure" } });
  assert.equal(failedPurchaseLookup.response.statusCode, 500, "DB lookup failure must be retried");
  assert.deepEqual(failedPurchaseLookup.seen.eventStates, ["received"]);
  assert.equal(failedPurchaseLookup.seen.reversals, 0, "Lookup failure must not reverse credits");

  console.log("Refund webhook replay, recovery, partial-refund, missing-purchase and failure gates passed (9 cases)");
} finally {
  if (originalSecret === undefined) delete process.env.CREEM_WEBHOOK_SECRET;
  else process.env.CREEM_WEBHOOK_SECRET = originalSecret;
  delete globalThis.__refundTest;
}
