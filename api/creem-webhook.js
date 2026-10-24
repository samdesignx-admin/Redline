// Creem webhook for UXNest audit credits.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
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
      const tx = refund.transaction;
      const txId = typeof tx === "string" ? tx : tx?.id;
      if (refund.status !== "succeeded") { res.status(200).send("OK"); return; }
      if (!/^tran_[A-Za-z0-9_-]+$/.test(String(txId || "")) ||
          !/^ref_[A-Za-z0-9_-]+$/.test(String(refund.id || ""))) {
        throw new Error("Refund event missing transaction/refund ID.");
      }
      const amount = Number(refund.refund_amount);
      const { data: applied, error } = await db.rpc("apply_creem_refund", {
        p_transaction_id: txId, p_refund_id: refund.id, p_amount_cents: amount,
      });
      if (error) throw error;
      if (!applied) {
        console.error("[UXNest] Refund could not be reconciled with a matching, fully-paid purchase",txId);
        res.status(500).send("Refund reconciliation pending");
        return;
      }
      res.status(200).send("OK");
      return;
    }
    if (event.eventType !== "checkout.completed") { res.status(200).send("OK"); return; }
    const checkout = event.object || {}, metadata = checkout.metadata || {};
    const accountId = String(metadata.account_id || ""), quantity = parseQuantity(checkout.units || metadata.quantity);
    const product = typeof checkout.product === "object" ? checkout.product : null;
    const actualProductId = product?.id || checkout.product;
    const expectedMode = process.env.CREEM_MODE || "test";
    if (checkout.mode && checkout.mode !== expectedMode) throw new Error("Creem event came from the wrong payment mode.");
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
    const tx = checkout?.order?.transaction || checkout?.transaction || checkout?.order?.transactions?.[0];
    const txId = typeof tx === "string" ? tx : tx?.id;
    if (typeof txId === "string" && /^tran_[A-Za-z0-9_-]+$/.test(txId)) {
      const {error:txError}=await db.from("audit_purchases").update({creem_transaction_id:txId})
        .eq("creem_checkout_id",checkout.id).is("creem_transaction_id",null);
      if (txError) console.warn("[UXNest] Could not save Creem transaction",txError.message);
    }


    res.status(200).send("OK");
  } catch (e) { console.error("[UXNest Creem webhook]", e); res.status(500).send("Internal error"); }
}
