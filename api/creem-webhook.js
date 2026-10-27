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
  const { error } = await db.from("creem_refund_events").upsert({
    event_id: event.id,
    refund_id: refund.id || "",
    transaction_id: txn?.id || (typeof refund.transaction === "string" ? refund.transaction : null),
    amount_cents: Number.isInteger(Number(refund.refund_amount)) ? Number(refund.refund_amount) : null,
    currency: refund.refund_currency || null,
    transaction_status: txn?.status || null,
    refund_status: refund.status || null,
    state, detail,
    updated_at: new Date().toISOString(),
  }, { onConflict: "event_id" });
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
      if (refund.status !== "succeeded") {
        await saveRefundEvent(db, event, refund, "received", "Refund not yet succeeded.");
        res.status(200).send("OK"); return;
      }
      await saveRefundEvent(db, event, refund, "received");
      const txn = typeof refund.transaction === "object" ? refund.transaction : null;
      // Partial refunds do not map reliably to whole audit credits; defer them
      // for manual review and leave credits unchanged.
      if (!txn || txn.status !== "refunded") {
        await saveRefundEvent(db, event, refund, "review_required", "Partial or unconfirmed refund; do not revoke whole credits.");
        console.warn("[UXNest Creem webhook] Partial or unconfirmed refund requires review.");
        res.status(200).send("Partial refund acknowledged for manual review");
        return;
      }
      const transactionId = txn?.id || refund.transaction;
      const refundId = refund.id;
      const amountCents = Number(refund.refund_amount);
      if (String(refund.refund_currency || "").toLowerCase() !== "usd" ||
          !/^tran_[A-Za-z0-9_-]+$/.test(transactionId || "") ||
          !/^ref_[A-Za-z0-9_-]+$/.test(refundId || "") ||
          !Number.isInteger(amountCents) || amountCents <= 0 ||
          (Number.isFinite(Number(txn.amount_paid)) && Number(txn.amount_paid) > 0 && amountCents < Number(txn.amount_paid))) {
        throw new Error("Invalid or unexpected Creem refund payload.");
      }
      let { data: recorded, error: refundError } = await db.rpc("apply_creem_refund", {
        p_transaction_id: transactionId, p_refund_id: refundId, p_amount_cents: amountCents,
      });
      if (refundError) throw refundError;
      if (recorded !== true) {
        // A refund may arrive before transaction linkage. Attempt provider-backed reconciliation.
        const linked = await syncRefundTransactionFromCreem(db, transactionId);
        if (linked) {
          ({ data: recorded, error: refundError } = await db.rpc("apply_creem_refund", {
            p_transaction_id: transactionId, p_refund_id: refundId, p_amount_cents: amountCents,
          }));
          if (refundError) throw refundError;
        }
      }
      if (recorded !== true) {
        await saveRefundEvent(db, event, refund, "pending_link", "Refund purchase not linked.");
        throw new Error("Refund purchase not linked; retry after reconciliation.");
      }
      await saveRefundEvent(db, event, refund, "applied");
      res.status(200).send("OK");
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
