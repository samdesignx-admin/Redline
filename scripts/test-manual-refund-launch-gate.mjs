// Source-level launch safety checks; does not replace signed-webhook integration tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
const refundStart = source.indexOf('if (event.eventType === "refund.created")');
const checkoutStart = source.indexOf('if (event.eventType !== "checkout.completed")');
assert(refundStart >= 0 && checkoutStart > refundStart, "refund and checkout handlers must exist");
const refund = source.slice(refundStart, checkoutStart);
const gate = refund.indexOf('process.env.CREEM_AUTOMATED_REFUNDS !== "enabled"');
const rpc = refund.indexOf('db.rpc("apply_creem_refund"');
assert(gate >= 0 && rpc > gate, "manual gate must precede automated reversal");
const gateBody = refund.slice(gate, rpc);
assert.match(gateBody, /saveRefundEvent\(db, event, refund, "review_required"/, "manual refunds must be recorded for review");
assert.match(gateBody, /res\.status\(200\)/, "acknowledge recorded manual refunds");
assert.match(gateBody, /return;/, "manual branch must exit before financial RPC");
assert.match(refund, /if \(refund\.status !== "succeeded"\)/, "non-successful refunds must not reverse credits");
assert.match(refund, /if \(!existing\)/, "unmatched purchases require reconciliation");
assert.match(refund, /amountCents !== Number\(existing\.amount_cents\)/, "mismatched refunds require review");
console.log("PASS: manual refund default gate precedes credit reversal; refund review branches preserved");
