// Creem webhook for UXNest audit credits.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
export const maxDuration = 20;
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
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (!verifySignature(rawBody, req.headers["creem-signature"], process.env.CREEM_WEBHOOK_SECRET)) { res.status(401).send("Invalid signature"); return; }
  let event; try { event = JSON.parse(rawBody); } catch { res.status(400).send("Invalid JSON"); return; }
  try {
    if (event.eventType !== "checkout.completed") { res.status(200).send("OK"); return; }
    const checkout = event.object || {}, metadata = checkout.metadata || {};
    const accountId = String(metadata.account_id || ""), quantity = parseQuantity(checkout.units || metadata.quantity);
    const product = typeof checkout.product === "object" ? checkout.product : null;
    const actualProductId = product?.id || checkout.product;
    if (checkout.status !== "completed" || !accountId || !quantity || !checkout.id) throw new Error("Incomplete checkout.completed event.");
    if (!process.env.CREEM_PRODUCT_ID || actualProductId !== process.env.CREEM_PRODUCT_ID) throw new Error("Unexpected Creem product.");
    if (product?.billing_type && product.billing_type !== "onetime") throw new Error("Unexpected Creem billing type.");
    const { data: existing } = await db.from("audit_purchases").select("id").eq("creem_checkout_id", checkout.id).maybeSingle();
    if (existing) { res.status(200).send("OK"); return; }
    const { data: eventExisting } = await db.from("audit_purchases").select("id").eq("creem_event_id", event.id).maybeSingle();
    if (eventExisting) { res.status(200).send("OK"); return; }
    const { error: insertError } = await db.from("audit_purchases").insert({
      account_id: accountId, creem_checkout_id: checkout.id, creem_event_id: event.id || null,
      amount_cents: product?.price ? Number(product.price) * quantity : 0, quantity,
      currency: String(product?.currency || "USD").toLowerCase(), payment_provider: "creem",
    });
    if (insertError) throw insertError;
    const { error: creditError } = await db.rpc("increment_paid_audits", { p_account_id: accountId, p_amount: quantity });
    if (creditError) throw creditError;
    res.status(200).send("OK");
  } catch (e) { console.error("[UXNest Creem webhook]", e); res.status(500).send("Internal error"); }
}
