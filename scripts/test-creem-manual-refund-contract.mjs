import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static safety contract: fast, dependency-free check of the launch gate.
// This is NOT a substitute for signed webhook integration tests.
const source = readFileSync(new URL("../api/creem-webhook.js", import.meta.url), "utf8");
const refundStart = source.indexOf('if (event.eventType === "refund.created")');
const checkoutStart = source.indexOf('if (event.eventType !== "checkout.completed")');
assert(refundStart >= 0 && checkoutStart > refundStart, "refund branch must precede checkout");
const refund = source.slice(refundStart, checkoutStart);
const guard = refund.indexOf('process.env.CREEM_AUTOMATED_REFUNDS !== "enabled"');
const review = refund.indexOf('saveRefundEvent(db, event, refund, "review_required",', guard);
const response = refund.indexOf('res.status(200).send("Refund recorded for manual reconciliation")', guard);
const stop = refund.indexOf('return;', response);
const reversal = refund.indexOf('db.rpc("apply_creem_refund"');
assert(guard >= 0, "automated refunds must be explicitly opted in");
assert(review > guard && response > review && stop > response, "manual path must persist review and stop");
assert(reversal > stop, "credit reversal must not run before manual gate");
assert(!refund.slice(guard, stop).includes('db.rpc("apply_creem_refund"'), "manual path must not reverse credits");
assert(refund.includes('if (amountCents < existing.amount_cents)'), "partial refunds must be flagged");
assert(refund.includes('if (!existing)'), "unmatched purchases must be flagged");
console.log("PASS: manual refund gate contract; integration tests still required");
