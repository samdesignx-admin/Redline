import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// Isolated webhook integration harness: replace only external imports with injected mocks.
const source = await readFile(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
const instrumented = source
  .replace('import { requireDb } from "./_lib.js";', "const requireDb = globalThis.__refundTest.requireDb;")
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

  console.log("Refund webhook replay tests passed (2 cases)");
} finally {
  if (originalSecret === undefined) delete process.env.CREEM_WEBHOOK_SECRET;
  else process.env.CREEM_WEBHOOK_SECRET = originalSecret;
  delete globalThis.__refundTest;
}
