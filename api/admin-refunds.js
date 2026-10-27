// Admin refund review. Approving a request does NOT move money.
// Provider refund execution must be verified separately before marking refunded.
import crypto from "crypto";
import { requireDb } from "./_lib.js";
import { getCreemCheckout, syncCreemPurchase, getCreemTransaction, syncRefundTransactionFromCreem } from "./_creem-transactions.js";
import { issueCreemFullRefund } from "./_creem-refunds.js";
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
      const { data: unlinkedPurchases, error: unlinkedError } = await db.from("audit_purchases")
        .select("id,account_id,created_at,creem_checkout_id,quantity,amount_cents")
        .eq("payment_provider", "creem").is("creem_transaction_id", null).limit(50);
      if (unlinkedError) throw unlinkedError;
      const { data: refundEvents, error: refundEventsError } = await db.from("creem_refund_events")
        .select("event_id,refund_id,transaction_id,amount_cents,currency,transaction_status,refund_status,state,detail,received_at")
        .neq("state", "applied").order("received_at", { ascending: false }).limit(100);
      if (refundEventsError) throw refundEventsError;
      return res.status(200).json({ requests, purchases, unlinkedPurchases: unlinkedPurchases || [], refundEvents: refundEvents || [], apiRefundsEnabled: process.env.CREEM_ENABLE_API_REFUNDS === "true" });
    }
    if (req.body?.action === "issue_full_refund") {
      if (process.env.CREEM_ENABLE_API_REFUNDS !== "true")
        return res.status(403).json({ error: "Creem API refunds have not been enabled." });
      if (req.body.confirm !== "ISSUE_FULL_REFUND")
        return res.status(400).json({ error: "Explicit full-refund confirmation is required." });
      const requestId = String(req.body.requestId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId))
        return res.status(400).json({ error: "Invalid refund request." });
      const { data: request, error: requestError } = await db.from("audit_refund_requests")
        .select("id,purchase_id,account_id,status").eq("id", requestId).maybeSingle();
      if (requestError) throw requestError;
      if (!request || request.status !== "approved")
        return res.status(409).json({ error: "A reviewed, approved refund request is required." });
      const { data: purchase, error: purchaseError } = await db.from("audit_purchases")
        .select("id,account_id,payment_provider,creem_transaction_id,creem_order_id,refund_status,amount_cents,currency,quantity")
        .eq("id", request.purchase_id).maybeSingle();
      if (purchaseError) throw purchaseError;
      if (!purchase || purchase.account_id !== request.account_id ||
          purchase.payment_provider !== "creem" ||
          purchase.refund_status !== "none" || !purchase.creem_transaction_id)
        return res.status(409).json({ error: "This purchase is not eligible for a new Creem refund." });
      const { data: account, error: balanceError } = await db.from("accounts")
        .select("paid_audits").eq("id", purchase.account_id).single();
      if (balanceError) throw balanceError;
      if (account.paid_audits < purchase.quantity)
        return res.status(409).json({ error: "Not enough unused credits for a standard full refund." });
      const transaction = await getCreemTransaction(purchase.creem_transaction_id);
      const txnOrder = typeof transaction?.order === "object" ? transaction.order.id : transaction?.order;
      if (transaction?.id !== purchase.creem_transaction_id ||
          transaction.status !== "paid" ||
          String(transaction.currency || "").toLowerCase() !== "usd" ||
          (purchase.creem_order_id && txnOrder !== purchase.creem_order_id))
        return res.status(409).json({ error: "Creem has not confirmed this transaction is currently paid and refundable." });
      // The conditional update reserves this purchase: simultaneous admin clicks
      // cannot issue a second refund while the first is in flight.
      const { data: claimed, error: claimError } = await db.from("audit_purchases")
        .update({ refund_status: "processing" }).eq("id", purchase.id)
        .eq("refund_status", "none").select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return res.status(409).json({ error: "Another refund request is already processing." });
      try {
        const refund = await issueCreemFullRefund(purchase.creem_transaction_id);
        // Do not overwrite 'refunded' if a verified webhook arrived first.
        const { error: pendingError } = await db.from("audit_purchases")
          .update({ refund_status: "pending" })
          .eq("id", purchase.id).eq("refund_status", "processing");
        if (pendingError) throw pendingError;
        return res.status(200).json({
          note: "Refund submitted to Creem. Await its signed webhook before revoking credits.",
          refundId: typeof refund?.id === "string" ? refund.id : null,
          providerStatus: refund?.status || "submitted",
        });
      } catch (error) {
        // A failed/ambiguous API call may already have triggered a refund.
        // Keep 'processing' instead of retrying or creating a duplicate payment.
        console.error("[UXNest Creem refund submission requires reconciliation]", error);
        return res.status(502).json({
          error: "Creem refund submission could not be confirmed. The purchase is locked from further refund attempts; reconcile in Creem before any retry."
        });
      }
    }
    if (req.body?.action === "retry_event") {
      const eventId = String(req.body.eventId || "");
      if (!/^evt_[A-Za-z0-9_-]+$/.test(eventId))
        return res.status(400).json({ error: "Invalid Creem event." });
      const { data: event, error: eventError } = await db.from("creem_refund_events")
        .select("*").eq("event_id", eventId).maybeSingle();
      if (eventError) throw eventError;
      if (!event) return res.status(404).json({ error: "Event not found." });
      if (event.state === "applied") return res.status(200).json({ note: "Already reconciled." });
      if (event.refund_status !== "succeeded" ||
          event.currency?.toLowerCase() !== "usd" ||
          !/^tran_[A-Za-z0-9_-]+$/.test(event.transaction_id || "") ||
          !/^ref_[A-Za-z0-9_-]+$/.test(event.refund_id || "") ||
          !Number.isInteger(event.amount_cents) || event.amount_cents <= 0)
        return res.status(409).json({ error: "This is not a confirmed full USD refund; manual review required." });
      const transaction = await getCreemTransaction(event.transaction_id);
      if (!transaction || transaction.id !== event.transaction_id ||
          !["paid", "refunded"].includes(transaction.status) ||
          String(transaction.currency || "").toLowerCase() !== "usd" ||
          !Number.isInteger(Number(transaction.amount_paid)) || Number(transaction.amount_paid) <= 0 ||
          event.amount_cents < Number(transaction.amount_paid))
        return res.status(409).json({ error: "Creem has not confirmed a fully refunded transaction." });
      const { data: purchase, error: purchaseError } = await db.from("audit_purchases")
        .select("amount_cents").eq("creem_transaction_id", event.transaction_id)
        .eq("payment_provider", "creem").maybeSingle();
      if (purchaseError) throw purchaseError;
      if (purchase && event.amount_cents < purchase.amount_cents)
        return res.status(409).json({ error: "Partial refund cannot reverse an entire audit credit." });
      let { data: applied, error: rpcError } = await db.rpc("apply_creem_refund", {
        p_transaction_id: event.transaction_id,
        p_refund_id: event.refund_id,
        p_amount_cents: event.amount_cents,
      });
      if (rpcError) throw rpcError;
      if (!applied) {
        const linked = await syncRefundTransactionFromCreem(db, event.transaction_id);
        if (linked) {
          ({ data: applied, error: rpcError } = await db.rpc("apply_creem_refund", {
            p_transaction_id: event.transaction_id,
            p_refund_id: event.refund_id,
            p_amount_cents: event.amount_cents,
          }));
          if (rpcError) throw rpcError;
        }
      }
      if (!applied) return res.status(409).json({ error: "Reconcile the original checkout transaction before retrying this refund." });
      const { error: updateError } = await db.from("creem_refund_events")
        .update({ state: "applied", detail: null, updated_at: new Date().toISOString() })
        .eq("event_id", eventId);
      if (updateError) throw updateError;
      return res.status(200).json({ note: "Verified Creem refund reconciled and credit adjustment applied once. No refund payment initiated." });
    }
    if (req.body?.action === "sync_purchase") {
      const id = String(req.body?.purchaseId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return res.status(400).json({ error: "Invalid purchase." });
      const { data: purchase, error: lookupError } = await db.from("audit_purchases")
        .select("id,account_id,creem_checkout_id,quantity,amount_cents")
        .eq("id", id).eq("payment_provider", "creem").maybeSingle();
      if (lookupError) throw lookupError;
      if (!purchase?.creem_checkout_id) return res.status(404).json({ error: "Creem purchase not found." });
      const checkout = await getCreemCheckout(purchase.creem_checkout_id);
      const productId = typeof checkout?.product === "object" ? checkout.product.id : checkout?.product;
      if (checkout?.id !== purchase.creem_checkout_id || checkout.status !== "completed" ||
          checkout.metadata?.account_id !== purchase.account_id ||
          productId !== process.env.CREEM_PRODUCT_ID ||
          Number(checkout.units || checkout.metadata?.quantity) !== purchase.quantity)
        return res.status(409).json({ error: "Creem checkout does not match the recorded purchase." });
      const result = await syncCreemPurchase(db, checkout);
      return res.status(200).json({ result, note: "Purchase identifiers checked against Creem. No credits changed." });
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
        .select("refund_status,account_id,quantity,payment_provider,creem_transaction_id").eq("id", request.purchase_id).single();
      if (pError) throw pError;
      if (purchase.refund_status !== "none") return res.status(409).json({ error: "Purchase refund state is not eligible." });
      if (decision === "approved") {
        if (purchase.payment_provider !== "creem" || !purchase.creem_transaction_id)
          return res.status(409).json({ error: "Link the Creem transaction before approving this refund." });
        const { data: account, error: accountError } = await db.from("accounts")
          .select("paid_audits").eq("id", purchase.account_id).single();
        if (accountError) throw accountError;
        if ((account.paid_audits || 0) < purchase.quantity)
          return res.status(409).json({ error: "Not enough unused audit credits for a standard refund. Review as a manual exception." });
      }
      const { data, error } = await db.from("audit_refund_requests")
        .update({ status: decision, updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", request.status).select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) return res.status(409).json({ error: "Request changed during review." });
      return res.status(200).json({ request: data, note: "Review decision saved. No money moved; issue the refund in Creem and await its signed webhook." });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    console.error("[UXNest refund admin]", error);
    return res.status(500).json({ error: "Refund review failed." });
  }
}
