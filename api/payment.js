// Creem one-time checkout for UXNest audit credits.
import { requireDb, readSession } from "./_lib.js";
export const maxDuration = 20;
const BETA_PRICE_CENTS = 500;
const MAX_PURCHASE_QUANTITY = 20;

function parseQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_PURCHASE_QUANTITY ? quantity : null;
}
function creemConfig() {
  if (!process.env.CREEM_API_KEY || !process.env.CREEM_PRODUCT_ID) {
    const err = new Error("Payments are not configured yet. Add CREEM_API_KEY and CREEM_PRODUCT_ID in Vercel.");
    err.code = "CREEM_NOT_CONFIGURED";
    throw err;
  }
  return { apiKey: process.env.CREEM_API_KEY, productId: process.env.CREEM_PRODUCT_ID, baseUrl: process.env.CREEM_API_BASE_URL || "https://api.creem.io" };
}
async function creemRequest(path, options = {}) {
  const { apiKey, baseUrl } = creemConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "x-api-key": apiKey, "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || "Creem request failed.");
  return data;
}
async function getCheckout(checkoutId) {
  return creemRequest(`/v1/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`, { method: "GET" });
}
async function grantPurchase(db, { accountId, checkoutId, eventId = null, quantity, amountCents = null, currency = "USD" }) {
  const { data, error } = await db.rpc("grant_creem_audit_purchase", {
    p_account_id: accountId,
    p_checkout_id: checkoutId,
    p_event_id: eventId,
    p_amount_cents: amountCents ?? BETA_PRICE_CENTS * quantity,
    p_quantity: quantity,
    p_currency: String(currency || "USD").toLowerCase(),
  });
  if (error) throw error;
  return { granted: data === true, duplicate: data !== true };
}

async function validateCompletedCheckout(checkout, accountId) {
  const { productId } = creemConfig();
  if (!checkout || checkout.status !== "completed") { const e = new Error("Payment has not been completed yet."); e.status = 402; throw e; }
  const metadata = checkout.metadata || {};
  if (metadata.account_id !== accountId) { const e = new Error("This payment belongs to a different account."); e.status = 403; throw e; }
  const quantity = parseQuantity(checkout.units || metadata.quantity);
  if (!quantity) { const e = new Error("Unexpected audit quantity."); e.status = 400; throw e; }
  const product = typeof checkout.product === "object" ? checkout.product : null;
  if ((product?.id || checkout.product) !== productId) { const e = new Error("Unexpected payment product."); e.status = 400; throw e; }
  if (product?.billing_type && product.billing_type !== "onetime") { const e = new Error("Unexpected payment type."); e.status = 400; throw e; }
  if (product?.currency && String(product.currency).toLowerCase() !== "usd") { const e = new Error("Unexpected payment currency."); e.status = 400; throw e; }
  if (product?.price != null && Number(product.price) !== BETA_PRICE_CENTS) { const e = new Error("Unexpected payment price."); e.status = 400; throw e; }
  return { checkoutId: checkout.id, quantity, amountCents: product?.price ? Number(product.price) * quantity : BETA_PRICE_CENTS * quantity, currency: product?.currency || "USD" };
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const db = requireDb(res); if (!db) return;
  const sess = readSession((req.body || {}).token);
  if (!sess) { res.status(401).json({ error: "Please log in again." }); return; }
  try {
    if (req.body.action === "checkout") {
      const quantity = parseQuantity(req.body.quantity);
      if (!quantity) { res.status(400).json({ error: "Choose between 1 and 20 audits." }); return; }
      const { productId } = creemConfig();
      const { data: account } = await db.from("accounts").select("email").eq("id", sess.accountId).maybeSingle();
      if (!account?.email) throw new Error("Your account email could not be loaded.");
      const origin = String(req.headers.origin || process.env.SITE_URL || "https://uxnest.ai").replace(/\/$/, "");
      const requestId = `uxnest_${sess.accountId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const checkout = await creemRequest("/v1/checkouts", {
        method: "POST",
        body: JSON.stringify({
          product_id: productId, request_id: requestId, units: quantity, customer: { email: account.email },
          success_url: `${origin}/?payment=success&checkout_id={checkout_id}`,
          metadata: { account_id: sess.accountId, quantity: String(quantity), source: "uxnest_web" },
        }),
      });
      if (!checkout.checkout_url || !checkout.id) throw new Error("Creem did not return a checkout URL.");
      res.status(200).json({ checkout_url: checkout.checkout_url, checkout_id: checkout.id, quantity, total_cents: BETA_PRICE_CENTS * quantity });
      return;
    }
    if (req.body.action === "verify") {
      const checkoutId = String(req.body.checkoutId || "").trim();
      if (!checkoutId || !/^ch_[A-Za-z0-9_-]+$/.test(checkoutId)) { res.status(400).json({ error: "Invalid payment checkout." }); return; }
      const checkout = await getCheckout(checkoutId);
      const verified = await validateCompletedCheckout(checkout, sess.accountId);
      await grantPurchase(db, { accountId: sess.accountId, checkoutId: verified.checkoutId, quantity: verified.quantity, amountCents: verified.amountCents, currency: verified.currency });
      const { data: acct } = await db.from("accounts").select("audits_used, paid_audits").eq("id", sess.accountId).maybeSingle();
      res.status(200).json({ paid: (acct && acct.paid_audits) || 0, used: (acct && acct.audits_used) || 0, credited: true, quantity: verified.quantity });
      return;
    }
    res.status(400).json({ error: "Unknown payment action" });
  } catch (e) {
    console.error("[UXNest Creem payment]", e);
    res.status(e?.code === "CREEM_NOT_CONFIGURED" ? 503 : (e?.status || 500)).json({ error: e?.message || "Payment request failed.", code: e?.code || "PAYMENT_ERROR" });
  }
}
