// Creem webhook for UXNest audit credits.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
import { getCreemCheckout, syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";
export const maxDuration = 20;
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(computed, "hex"), b = Buffer.from(String(signature), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseQuantity(value) {
  const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}
async function saveRefundEvent(db, event, refund, state, detail = null) {
  const txn = refund.transaction && typeof refund.transaction === "object" ? refund.transaction : null;
  if (!/^evt_[A-Za-z0-9_-]+$/.test(event.id || "")) throw new Error("Creem refund event missing id.");
  const { error } = await db.rpc("record_creem_refund_event", {
    p_event_id: event.id,
    p_refund_id: refund.id || "",
    p_transaction_id: txn?.id || (typeof refund.transaction === "string" ? refund.transaction : null),
    p_amount_cents: Number.isInteger(Number(refund.refund_amount)) ? Number(refund.refund_amount) : null,
    p_currency: refund.refund_currency || null,
    p_transaction_status: txn?.status || null,
    p_refund_status: refund.status || null,
    p_state: state,
    p_detail: detail,
  });
  if (error) throw error;
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  if (!process.env.CREEM_WEBHOOK_SECRET) { res.status(503).send("Creem webhook is not configured."); return; }
  const db = requireDb(res); if (!db) return;
  const rawBody = await readRawBody(req);
  if (!verifySignature(rawBody, req.headers["creem-signature"], process.env.CREEM_WEBHOOK_SECRET)) { res.status(401).send("Invalid signature"); return; }
  let event; try { event = JSON.parse(rawBody); } catch { res.status(400).send("Invalid JSON"); return; }
  try {
    if (event.eventType === "refund.created") {
      const refund = event.object || {};
      // Signed refund events must not be reconciled across Creem environments.
      // Older payloads without an explicit mode remain review-only.
      const expectedRefundMode = process.env.CREEM_MODE || "test";
      const refundMode = String(refund.mode || event.mode || "").toLowerCase();
      const refundModeMatches = expectedRefundMode === "live"
        ? ["live", "prod"].includes(refundMode)
        : expectedRefundMode === "test" && refundMode === "test";
      if (!refundModeMatches) {
        await saveRefundEvent(db, event, refund, "review_required",
          "Refund payment mode missing or mismatched; no audit credits reversed.");
        res.status(200).send("Refund recorded for payment-mode review");
        return;
      }
      if (refund.status !== "succeeded") {
        await saveRefundEvent(db, event, refund, "received", "Refund not yet succeeded.");
        res.status(200).send("OK"); return;
      }
      // The refund status is authoritative in the SIGNED Creem event.
      // Its embedded transaction.status can still be "paid" immediately
      // after a successful full refund. Check the refunded amount against
      // the original amount paid instead of relying on that stale status.
      await saveRefundEvent(db, event, refund, "received");
      const txn = refund.transaction && typeof refund.transaction === "object" ? refund.transaction : null;
      const transactionId = txn?.id;
      const refundId = refund.id;
      const amountCents = Number(refund.refund_amount);
      const paidCents = Number(txn?.amount_paid);
      const validIdentifiers = /^tran_[A-Za-z0-9_-]+$/.test(transactionId || "") &&
        /^ref_[A-Za-z0-9_-]+$/.test(refundId || "");
      const validAmounts = Number.isInteger(amountCents) && amountCents > 0 &&
        Number.isInteger(paidCents) && paidCents > 0;
      if (!txn || !validIdentifiers || !validAmounts ||
          String(refund.refund_currency || "").toLowerCase() !== "usd" ||
          amountCents !== paidCents) {
        await saveRefundEvent(db, event, refund, "review_required",
          "Unverified, amount-mismatched, non-USD, or invalid refund; no audit credits reversed.");
        res.status(200).send("Refund acknowledged for manual review");
        return;
      }

      const { data: existing, error: lookupError } = await db.from("audit_purchases")
        .select("id,amount_cents,refund_status")
        .eq("creem_transaction_id", transactionId)
        .eq("payment_provider", "creem").maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) {
        // Never apply a sample refund to an unrelated customer. Preserve the
        // signed event for reconciliation if the original purchase is unlinked.
        await saveRefundEvent(db, event, refund, "pending_link",
          "Refund succeeded, but no matching Creem purchase transaction is linked.");
        res.status(200).send("Refund recorded for purchase reconciliation");
        return;
      }
      if (!Number.isInteger(Number(existing.amount_cents)) || amountCents !== Number(existing.amount_cents)) {
        await saveRefundEvent(db, event, refund, "review_required",
          "Refund amount does not match the recorded purchase amount.");
        res.status(200).send("Mismatched refund recorded for manual review");
        return;
      }

      // Launch policy: refunds are handled in the Creem dashboard and reconciled
      // by an authorized operator. Do not automatically reverse audit credits.
      // This fail-closed default prevents unintended balance changes while
      // the refund accounting and concurrency tests are being consolidated.
      if (process.env.CREEM_AUTOMATED_REFUNDS !== "enabled") {
        await saveRefundEvent(db, event, refund, "review_required",
          "Manual refund reconciliation required; audit credits unchanged.");
        res.status(200).send("Refund recorded for manual reconciliation");
        return;
      }

      // Never execute a financial reversal from this webhook until the accounting
      // transaction and concurrent-delivery behavior are independently approved.
      throw new Error("Automated Creem refund reconciliation is not approved.");
      return;
    }
        if (event.eventType !== "checkout.completed") { res.status(200).send("OK"); return; }
    let checkout = event.object || {};
    let metadata = checkout.metadata || {};
    const expectedMode = process.env.CREEM_MODE || "test";

    // Creem's dashboard "Send test event" generates a signed, synthetic
    // checkout without UXNest's account_id metadata. A fake checkout must
    // NEVER create a purchase or grant credits. Confirm the checkout is not
    // present in Creem's test API before acknowledging it with HTTP 200.
    // Genuine incomplete payments must continue to fail and be retried.
    if (expectedMode === "test" && !metadata.account_id) {
      const checkoutId = String(checkout.id || "");
      if (/^ch_[A-Za-z0-9_-]{3,200}$/.test(checkoutId)) {
        try {
          const providerCheckout = await getCreemCheckout(checkoutId);
          if (providerCheckout?.id === checkoutId && providerCheckout.status === "completed") {
            // An actual completed checkout: recover authoritative metadata.
            checkout = providerCheckout;
            metadata = checkout.metadata || {};
          } else {
            throw new Error("Creem checkout could not be confirmed for account crediting.");
          }
        } catch (lookupError) {
          if (lookupError?.message === "Creem transaction lookup failed (404)") {
            console.info("[UXNest Creem webhook] Synthetic test checkout acknowledged; no credits granted.");
            res.status(200).send("Synthetic checkout test acknowledged; no credits granted");
            return;
          }
          throw lookupError;
        }
      } else if (/^evt_test_[A-Za-z0-9_-]+$/.test(String(event.id || ""))) {
        console.info("[UXNest Creem webhook] Synthetic test checkout with no valid checkout reference; no credits granted.");
        res.status(200).send("Synthetic checkout test acknowledged; no credits granted");
        return;
      }
    }

    const accountId = String(metadata.account_id || ""), quantity = parseQuantity(checkout.units || metadata.quantity);
    const product = typeof checkout.product === "object" ? checkout.product : null;
    const actualProductId = product?.id || checkout.product;
    if (checkout.mode && !((expectedMode === "live" && ["live", "prod"].includes(checkout.mode)) || (expectedMode === "test" && checkout.mode === "test"))) throw new Error("Creem event came from the wrong payment mode.");
    if (checkout.status !== "completed" || !accountId || !quantity || !checkout.id) throw new Error("Incomplete checkout.completed event.");
    if (!process.env.CREEM_PRODUCT_ID || actualProductId !== process.env.CREEM_PRODUCT_ID) throw new Error("Unexpected Creem product.");
    if (product?.billing_type && product.billing_type !== "onetime") throw new Error("Unexpected Creem billing type.");
    const unitPriceCents = product?.price == null ? 500 : Number(product.price);
    if (unitPriceCents !== 500 || (product?.currency && String(product.currency).toLowerCase() !== "usd")) throw new Error("Unexpected Creem price or currency.");
    const amountCents = unitPriceCents * quantity;
    const { error: grantError } = await db.rpc("grant_creem_audit_purchase", {
      p_account_id: accountId,
      p_checkout_id: checkout.id,
      p_event_id: event.id || null,
      p_amount_cents: amountCents,
      p_quantity: quantity,
      p_currency: String(product?.currency || "USD").toLowerCase(),
    });
    if (grantError) throw grantError;
    await syncCreemPurchase(db, checkout);

    res.status(200).send("OK");
  } catch (e) { console.error("[UXNest Creem webhook]", e); res.status(500).send("Internal error"); }
}
