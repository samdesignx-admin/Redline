// Admin refund review. Approving a request does NOT move money.
// Provider refund execution must be verified separately before marking refunded.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
export const maxDuration = 20;
function validKey(given, expected) {
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ADMIN_KEY) return res.status(503).json({ error: "Admin access not configured." });
  if (!validKey(req.body?.key, process.env.ADMIN_KEY)) return res.status(401).json({ error: "Unauthorized." });
  const db = requireDb(res); if (!db) return;
  try {
    if (req.body?.action === "list") {
      const { data: requests, error } = await db.from("audit_refund_requests")
        .select("id,account_id,purchase_id,reason,status,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = [...new Set((requests || []).map(r => r.purchase_id))];
      let purchases = [];
      if (ids.length) {
        const p = await db.from("audit_purchases").select("id,account_id,quantity,amount_cents,currency,payment_provider,creem_transaction_id,refund_status").in("id", ids);
        if (p.error) throw p.error;
        purchases = p.data || [];
      }
      return res.status(200).json({ requests, purchases });
    }
    if (req.body?.action === "review") {
      const id = String(req.body?.requestId || "");
      const decision = String(req.body?.decision || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || !["approved", "rejected", "reviewing"].includes(decision))
        return res.status(400).json({ error: "Invalid review parameters." });
      const { data: request, error: lookupError } = await db.from("audit_refund_requests")
        .select("id,status,purchase_id").eq("id", id).maybeSingle();
      if (lookupError) throw lookupError;
      if (!request) return res.status(404).json({ error: "Request not found." });
      if (!["requested", "reviewing"].includes(request.status))
        return res.status(409).json({ error: "This request has already been decided." });
      const { data: purchase, error: pError } = await db.from("audit_purchases")
        .select("refund_status").eq("id", request.purchase_id).single();
      if (pError) throw pError;
      if (purchase.refund_status !== "none") return res.status(409).json({ error: "Purchase refund state is not eligible." });
      const { data, error } = await db.from("audit_refund_requests")
        .update({ status: decision, updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", request.status).select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: "Request changed during review." });
      return res.status(200).json({ request: data, note: "Review decision saved. No money moved." });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    console.error("[UXNest refund admin]", error);
    return res.status(500).json({ error: "Refund review failed." });
  }
}
