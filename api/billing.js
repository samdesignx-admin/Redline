// Authenticated UXNest purchase history and refund requests.
// Refund requests do not initiate money movement; an administrator must review them.
import { requireDb, readSession } from "./_lib.js";
export const maxDuration = 20;
export default async function handler(req, res) {
  if (!["POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  const token = req.body?.token;
  const session = readSession(token);
  if (!session) return res.status(401).json({ error: "Please sign in again." });
  const db = requireDb(res);
  if (!db) return;
  const accountId = session.accountId;
  try {
    const { data: account, error: accountError } = await db.from("accounts")
      .select("id,paid_audits,credit_debt").eq("id", accountId).maybeSingle();
    if (accountError) throw accountError;
    if (!account) return res.status(401).json({ error: "Account not found." });
    const action = req.body?.action || "history";
    if (action === "history") {
      const { data: purchases, error: purchaseError } = await db.from("audit_purchases")
        .select("id,created_at,quantity,amount_cents,currency,payment_provider,creem_checkout_id,creem_transaction_id,refund_status,refunded_at,refunded_amount_cents")
        .eq("account_id", accountId).order("created_at", { ascending: false }).limit(100);
      if (purchaseError) throw purchaseError;
      const { data: refunds, error: refundError } = await db.from("audit_refund_requests")
        .select("id,purchase_id,reason,status,created_at,updated_at")
        .eq("account_id", accountId).order("created_at", { ascending: false }).limit(100);
      if (refundError) throw refundError;
      return res.status(200).json({ purchases, refunds, availableCredits: account.paid_audits, creditAdjustmentDue: account.credit_debt });
    }
    if (action === "request_refund") {
      const purchaseId = String(req.body.purchaseId || "");
      const reason = String(req.body.reason || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(purchaseId))
        return res.status(400).json({ error: "Invalid purchase." });
      if (reason.length < 5 || reason.length > 1000)
        return res.status(400).json({ error: "Please provide a reason (5–1000 characters)." });
      const { data: purchase, error: lookupError } = await db.from("audit_purchases")
        .select("id,refund_status").eq("id", purchaseId).eq("account_id", accountId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!purchase) return res.status(404).json({ error: "Purchase not found." });
      if (purchase.refund_status && purchase.refund_status !== "none")
        return res.status(409).json({ error: "This purchase already has a refund status." });
      const { data: existing, error: existingError } = await db.from("audit_refund_requests")
        .select("id").eq("purchase_id", purchaseId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return res.status(409).json({ error: "A refund request already exists." });
      const { data, error } = await db.from("audit_refund_requests")
        .insert({ account_id: accountId, purchase_id: purchaseId, reason, status: "requested" })
        .select("id,status,created_at").single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ error: "A refund request already exists." });
        throw error;
      }
      return res.status(201).json({ request: data });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    console.error("[UXNest billing]", error);
    return res.status(500).json({ error: "Unable to process billing request." });
  }
}
