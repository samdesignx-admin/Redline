// Creem webhook for UXNest audit credits.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
export const maxDuration = 20;

// The signature is an HMAC over the exact bytes Creem sent. Re-serialising a
// parsed body does not reproduce those bytes reliably, so Vercel's automatic
// body parsing is turned off and the raw stream is read here.
export const config = { api: { bodyParser: false } };

const BETA_PRICE_CENTS = 500;

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.readable) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1_000_000) throw new Error("Webhook body too large.");
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  }
  // Platform already parsed the body; best effort only.
  return JSON.stringify(req.body || {});
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

// Events we deliberately ignore are acknowledged with 200 so Creem does not
// retry them forever; only genuine processing failures return 5xx.
function ignore(res, reason, detail) {
  console.error(`[UXNest Creem webhook] ignored: ${reason}`, detail || "");
  res.status(200).send("OK");
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  if (!process.env.CREEM_WEBHOOK_SECRET) { res.status(503).send("Creem webhook is not configured."); return; }
  const db = requireDb(res); if (!db) return;
  let rawBody;
  try { rawBody = await readRawBody(req); } catch { res.status(413).send("Payload too large"); return; }
  if (!verifySignature(rawBody, req.headers["creem-signature"], process.env.CREEM_WEBHOOK_SECRET)) { res.status(401).send("Invalid signature"); return; }
  let event; try { event = JSON.parse(rawBody); } catch { res.status(400).send("Invalid JSON"); return; }
  try {
    if (event.eventType !== "checkout.completed") { res.status(200).send("OK"); return; }
    const checkout = event.object || {}, metadata = checkout.metadata || {};
    const accountId = String(metadata.account_id || ""), quantity = parseQuantity(checkout.units || metadata.quantity);
    const product = typeof checkout.product === "object" ? checkout.product : null;
    const actualProductId = product?.id || checkout.product;
    if (checkout.status !== "completed" || !accountId || !quantity || !checkout.id) return ignore(res, "incomplete checkout.completed event", checkout.id);
    if (!process.env.CREEM_PRODUCT_ID || actualProductId !== process.env.CREEM_PRODUCT_ID) return ignore(res, "unexpected product", actualProductId);
    if (product?.billing_type && product.billing_type !== "onetime") return ignore(res, "unexpected billing type", product.billing_type);
    if (product?.currency && String(product.currency).toLowerCase() !== "usd") return ignore(res, "unexpected currency", product.currency);
    if (product?.price != null && Number(product.price) !== BETA_PRICE_CENTS) return ignore(res, "unexpected price", product.price);
    const amountCents = BETA_PRICE_CENTS * quantity;
    const { error: grantError } = await db.rpc("grant_creem_audit_purchase", {
      p_account_id: accountId,
      p_checkout_id: checkout.id,
      p_event_id: event.id || null,
      p_amount_cents: amountCents,
      p_quantity: quantity,
      p_currency: String(product?.currency || "USD").toLowerCase(),
    });
    if (grantError) throw grantError;

    res.status(200).send("OK");
  } catch (e) { console.error("[UXNest Creem webhook]", e); res.status(500).send("Internal error"); }
}
