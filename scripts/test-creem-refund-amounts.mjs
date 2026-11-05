// Run with: node scripts/test-creem-refund-amounts.mjs
// No network, payment provider, or production database access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { Readable } from "node:stream";

const original = await readFile(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
const instrumented = original
  .replace('import crypto from "crypto";', 'const crypto = globalThis.__refundTest.crypto;')
  .replace('import { requireDb } from "./_lib.js";', 'const requireDb = globalThis.__refundTest.requireDb;')
  .replace('import { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";',
    'const { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } = globalThis.__refundTest;');
assert.notEqual(instrumented, original, "Webhook test instrumentation must replace imports");
assert.ok(!instrumented.includes('from "./_lib.js"'), "Database import was not mocked");
const secret = "isolated-refund-test-secret";
process.env.CREEM_WEBHOOK_SECRET = secret;
const calls = [];
let purchaseAmount = 500;
const db = {
  from(table) {
    if (table === "creem_refund_events") return { upsert: async (row) => { calls.push({ type: "event", row }); return { error: null }; } };
    assert.equal(table, "audit_purchases");
    return { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return { data: { id: "purchase_1", amount_cents: purchaseAmount, refund_status: null }, error: null };
    } };
  },
  async rpc(name, args) { calls.push({ type: "rpc", name, args }); return { data: true, error: null }; },
};
globalThis.__refundTest = {
  crypto, requireDb: () => db,
  getCreemCheckout: async () => { throw new Error("Unexpected checkout"); },
  syncCreemPurchase: async () => { throw new Error("Unexpected purchase"); },
  syncRefundTransactionFromCreem: async () => { throw new Error("Unexpected transaction sync"); },
};
const { default: handler } = await import("data:text/javascript;base64," + Buffer.from(instrumented).toString("base64"));

async function run({ refundAmount, paidAmount, recordedAmount, currency = "usd" }) {
  calls.length = 0;
  purchaseAmount = recordedAmount;
  const payload = JSON.stringify({
    id: "evt_test_refund_amount", eventType: "refund.created",
    object: { id: "ref_test_refund", status: "succeeded", refund_amount: refundAmount,
      refund_currency: currency,
      transaction: { id: "tran_test_payment", status: "paid", amount_paid: paidAmount } },
  });
  const req = Readable.from([payload]);
  req.method = "POST";
  req.headers = { "creem-signature": crypto.createHmac("sha256", secret).update(payload).digest("hex") };
  const res = { statusCode: null, status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; } };
  await handler(req, res);
  assert.equal(res.statusCode, 200, res.body);
  return calls.filter(c => c.type === "rpc");
}
assert.equal((await run({ refundAmount: 600, paidAmount: 500, recordedAmount: 500 })).length, 0, "Over-refund must not reverse credits");
assert.equal((await run({ refundAmount: 400, paidAmount: 500, recordedAmount: 500 })).length, 0, "Partial refund must not reverse credits");
assert.equal((await run({ refundAmount: 500, paidAmount: 500, recordedAmount: 600 })).length, 0, "Recorded purchase mismatch must not reverse credits");
assert.equal((await run({ refundAmount: 500, paidAmount: 500, recordedAmount: 500, currency: "eur" })).length, 0, "Non-USD refund must not reverse credits");
const exact = await run({ refundAmount: 500, paidAmount: 500, recordedAmount: 500 });
assert.equal(exact.length, 1, "Matching full refund should invoke the financial RPC exactly once");
assert.equal(exact[0].name, "apply_creem_refund");
console.log("PASS: refund amount and currency webhook gates (isolated mocks)");
