import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Stateful regression: intentionally fails against the current unconditional upsert.
// Uses the real handler, a persistent in-memory table, and no network/DB access.
// Run: node scripts/test-creem-refund-replay-stateful.mjs
let source = readFileSync(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
source = source.replace('import crypto from "crypto";', 'const crypto = globalThis.__replay.crypto;')
  .replace('import { requireDb } from "./_lib.js";', 'const requireDb = () => globalThis.__replay.db;')
  .replace('import { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";',
    'const getCreemCheckout = () => { throw Error("unexpected checkout"); }; const syncCreemPurchase = () => { throw Error("unexpected checkout sync"); };');
const rows = new Map();
const financialCalls = [];
const db = {
  from(table) {
    if (table === "creem_refund_events") return {
      upsert(row) { rows.set(row.event_id, { ...row }); return Promise.resolve({ error: null }); }
    };
    if (table === "audit_purchases") return {
      select() { return this; }, eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: { id: "purchase1", amount_cents: 500 }, error: null }); }
    };
    throw Error("Unexpected table " + table);
  },
  rpc(name, args) {
    if (name !== "record_creem_refund_event") {
      financialCalls.push(name);
      throw Error("Financial RPC not permitted in regression test");
    }
    const prior = rows.get(args.p_event_id);
    const rank = { received: 0, pending_link: 1, review_required: 2 };
    if (prior && (prior.refund_id !== args.p_refund_id || prior.transaction_id !== args.p_transaction_id || prior.amount_cents !== args.p_amount_cents || prior.currency !== args.p_currency)) {
      return Promise.resolve({ error: Error("Conflicting refund event identity") });
    }
    if (!prior || rank[args.p_state] > rank[prior.state]) {
      rows.set(args.p_event_id, {
        event_id: args.p_event_id, refund_id: args.p_refund_id,
        transaction_id: args.p_transaction_id, amount_cents: args.p_amount_cents,
        currency: args.p_currency, state: args.p_state, detail: args.p_detail,
      });
    }
    return Promise.resolve({ data: { state: rows.get(args.p_event_id).state }, error: null });
  }
};
globalThis.__replay = { crypto, db };
const { default: handler } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const originalSecret = process.env.CREEM_WEBHOOK_SECRET;
const originalMode = process.env.CREEM_MODE;
const originalGate = process.env.CREEM_AUTOMATED_REFUNDS;
process.env.CREEM_WEBHOOK_SECRET = "local-replay-test-secret";
process.env.CREEM_MODE = "test";
delete process.env.CREEM_AUTOMATED_REFUNDS;
async function deliver(status) {
  const payload = { id: "evt_replay_stateful", eventType: "refund.created", object: {
    id: "ref_replay1", mode: "test", status, refund_amount: 500,
    refund_currency: "USD", transaction: { id: "tran_replay1", amount_paid: 500, status: "paid" }
  }};
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET).update(raw).digest("hex");
  const req = { method: "POST", headers: { "creem-signature": signature },
    async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, send(body) { this.body = body; return this; } };
  await handler(req, res);
  assert.equal(res.statusCode, 200, res.body);
}
try {
  await deliver("succeeded");
  assert.equal(rows.get("evt_replay_stateful")?.state, "review_required");
  // A delayed earlier-status delivery must never erase an already-reviewed event.
  await deliver("pending");
  assert.equal(rows.size, 1);
  assert.equal(rows.get("evt_replay_stateful")?.state, "review_required",
    "REPLAY REGRESSION: pending webhook downgraded review_required");
  assert.deepEqual(financialCalls, []);
  console.log("PASS: refund reconciliation state is monotonic across deliveries");
} finally {
  if (originalSecret === undefined) delete process.env.CREEM_WEBHOOK_SECRET;
  else process.env.CREEM_WEBHOOK_SECRET = originalSecret;
  if (originalMode === undefined) delete process.env.CREEM_MODE;
  else process.env.CREEM_MODE = originalMode;
  if (originalGate === undefined) delete process.env.CREEM_AUTOMATED_REFUNDS;
  else process.env.CREEM_AUTOMATED_REFUNDS = originalGate;
  delete globalThis.__replay;
}
