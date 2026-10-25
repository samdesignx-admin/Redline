// Creem webhook for UXNest audit credits.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
import { syncCreemPurchase, syncRefundTransactionFromCreem } from "./_creem-transactions.js";
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
      if (refund.status !== "succeeded") { res.status(200).send("OK"); return; }
      const txn = typeof refund.transaction === "object" ? refund.transaction : null;
      // Partial refunds do not map reliably to whole audit credits; defer them
      // for manual review and leave credits unchanged.
      if (!txn || txn.status !== "refunded") {
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
      if (recorded !== true) throw new Error("Refund purchase not linked; retry after reconciliation.");
      res.status(200).send("OK");
      return;
    }
    if (event.eventType !== "checkout.completed") { res.status(200).send("OK"); return; }
    const checkout = event.object || {}, metadata = checkout.metadata || {};
    const accountId = String(metadata.account_id || ""), quantity = parseQuantity(checkout.units || metadata.quantity);
    const product = typeof checkout.product === "object" ? checkout.product : null;
    const actualProductId = product?.id || checkout.product;
    const expectedMode = process.env.CREEM_MODE || "test";
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
