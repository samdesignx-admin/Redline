import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Execute the real webhook handler with external modules replaced by controlled stubs.
// No network calls, provider charges, or database writes.
let source = readFileSync(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
source = source.replace('import crypto from "crypto";', 'const crypto = globalThis.__refundTest.crypto;')
  .replace('import { requireDb } from "./_lib.js";', 'const requireDb = () => globalThis.__refundTest.db;')
  .replace('import { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";',
    'const getCreemCheckout = () => { throw Error("unexpected checkout"); }; const syncCreemPurchase = () => { throw Error("unexpected sync"); };');
// The transformed module evaluates its crypto binding during import; initialize the stub first.
globalThis.__refundTest = { crypto, db: null };
const { default: handler } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const originalSecret = process.env.CREEM_WEBHOOK_SECRET;
const originalGate = process.env.CREEM_AUTOMATED_REFUNDS;
process.env.CREEM_WEBHOOK_SECRET = "local-test-secret";
delete process.env.CREEM_AUTOMATED_REFUNDS;
const event = (id, overrides = {}) => ({
  id, eventType: "refund.created", object: {
    id: "ref_test123", status: "succeeded", refund_amount: 500,
    refund_currency: "USD", transaction: { id: "tran_test123", amount_paid: 500, status: "paid" },
    ...overrides
  }
});
async function send(payload, signatureValid = true, purchaseAmount = 500) {
  const events = [], calls = [];
  const db = {
    from(table) {
      return {
        upsert(row) { events.push({ table, ...row }); return Promise.resolve({ error: null }); },
        select() { return this; }, eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: { id: "purchase1", amount_cents: purchaseAmount }, error: null }); }
      };
    },
    rpc(name) { calls.push(name); throw Error("Financial RPC must not execute"); }
  };
  globalThis.__refundTest = { crypto, db };
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET).update(raw).digest("hex");
  const req = {
    method: "POST", headers: { "creem-signature": signatureValid ? signature : "00" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(raw); }
  };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, send(msg) { this.body = msg; return this; } };
  await handler(req, res);
  return { res, events, calls };
}
try {
  for (const id of ["evt_first", "evt_second", "evt_first"]) {
    const { res, events, calls } = await send(event(id));
    assert.equal(res.statusCode, 200);
    assert.equal(events.at(-1)?.state, "review_required");
    assert.equal(events.at(-1)?.refund_id, "ref_test123");
    assert.deepEqual(calls, []);
  }
  const invalid = await send(event("evt_bad"), false);
  assert.equal(invalid.res.statusCode, 401);
  assert.equal(invalid.events.length, 0);
  const partial = await send(event("evt_partial", { refund_amount: 200 }));
  assert.equal(partial.res.statusCode, 200);
  assert.equal(partial.events.at(-1)?.state, "review_required");
  assert.deepEqual(partial.calls, []);
  // Even if the legacy automation flag is enabled, over-amount events must
  // never reach the financial RPC. The mock RPC throws if invoked.
  process.env.CREEM_AUTOMATED_REFUNDS = "enabled";
  for (const [id, payload, purchaseAmount] of [
    ["evt_over_provider", { refund_amount: 600 }, 500],
    ["evt_over_purchase", { refund_amount: 500, transaction: { id: "tran_test123", amount_paid: 500 } }, 400],
    ["evt_under_purchase", { refund_amount: 500, transaction: { id: "tran_test123", amount_paid: 500 } }, 600],
    ["evt_wrong_currency", { refund_currency: "EUR" }, 500],
    ["evt_bad_refund_id", { id: "invalid" }, 500],
  ]) {
    const result = await send(event(id, payload), true, purchaseAmount);
    assert.equal(result.res.statusCode, 200, id);
    assert.equal(result.events.at(-1)?.state, "review_required", id);
    assert.deepEqual(result.calls, [], id);
  }
  delete process.env.CREEM_AUTOMATED_REFUNDS;
  const pending = await send(event("evt_pending", { status: "pending" }));
  assert.equal(pending.events.at(-1)?.state, "received");
  assert.deepEqual(pending.calls, []);
  console.log("PASS: signed manual refund, duplicate/replayed events, partial, over/under-amount, currency, invalid IDs, pending and invalid signature; no financial RPC");
} finally {
  if (originalSecret === undefined) delete process.env.CREEM_WEBHOOK_SECRET;
  else process.env.CREEM_WEBHOOK_SECRET = originalSecret;
  if (originalGate === undefined) delete process.env.CREEM_AUTOMATED_REFUNDS;
  else process.env.CREEM_AUTOMATED_REFUNDS = originalGate;
  delete globalThis.__refundTest;
}
