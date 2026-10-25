// Temporary one-time operational reconciliation. Preview-only, expiring token.
// Does not issue refunds or grant/revoke credits. Remove after execution.
import crypto from "node:crypto";
import { requireDb } from "./_lib.js";
import { getCreemCheckout, syncCreemPurchase } from "./_creem-transactions.js";
export const maxDuration = 30;
const DIGEST = "311c136bd3b6cbf2f2302c47161105b6c8e980d3293117c9326eb6064e214f13";
const EXPIRES_MS = 1792931750869;
function validToken(value) {
  if (typeof value !== "string" || value.length > 200 || Date.now() > EXPIRES_MS) return false;
  const actual = crypto.createHash("sha256").update(value).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(DIGEST, "hex"));
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" || process.env.VERCEL_ENV !== "preview" || !validToken(req.query?.t)) {
    res.status(404).json({ error: "Not found" }); return;
  }
  const db = requireDb(res); if (!db) return;
  try {
    const { data: records, error } = await db.from("audit_purchases")
      .select("id,account_id,creem_checkout_id,quantity,amount_cents,currency")
      .eq("payment_provider", "creem").is("creem_transaction_id", null)
      .order("created_at", { ascending: true }).limit(5);
    if (error) throw error;
    const results = [];
    for (const purchase of records || []) {
      if (!purchase.creem_checkout_id) { results.push("no-checkout"); continue; }
      const checkout = await getCreemCheckout(purchase.creem_checkout_id);
      const product = checkout?.product;
      const productId = typeof product === "object" ? product?.id : product;
      const currency = typeof product === "object" ? product?.currency : undefined;
      const unitPrice = typeof product === "object" ? Number(product.price) : undefined;
      const expectedMode = process.env.CREEM_MODE || "test";
      const modeMatches = checkout?.mode === expectedMode || (expectedMode === "live" && checkout?.mode === "prod");
      if (checkout?.id !== purchase.creem_checkout_id ||
          checkout.status !== "completed" || !modeMatches ||
          checkout.metadata?.account_id !== purchase.account_id ||
          productId !== process.env.CREEM_PRODUCT_ID ||
          Number(checkout.units || checkout.metadata?.quantity) !== purchase.quantity ||
          (currency && String(currency).toLowerCase() !== "usd") ||
          (unitPrice != null && unitPrice !== 500) ||
          purchase.amount_cents !== 500 * purchase.quantity) {
        results.push("checkout-verification-failed"); continue;
      }
      const linked = await syncCreemPurchase(db, checkout);
      results.push(linked.transactionLinked ? "transaction-linked" :
        linked.orderLinked ? "order-only" : "no-provider-identifiers");
    }
    return res.status(200).json({ inspected: (records || []).length, results });
  } catch (e) {
    console.error("[UXNest preview reconciliation] error", e?.message);
    return res.status(502).json({ error: "Provider or database reconciliation failed; see preview logs." });
  }
}
