// Account-scoped purchase history and refund requests. No refund is issued here.
import { requireDb, readSession } from "./_lib.js";
export const maxDuration = 20;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const db = requireDb(res); if (!db) return;
  const session = readSession(req.body?.token);
  if (!session) return res.status(401).json({ error: "Please sign in to see your purchase history." });
  try {
    if (req.body.action === "list") {
      const {data: purchases,error} = await db.from("audit_purchases")
        .select("id,amount_cents,quantity,currency,payment_provider,creem_checkout_id,refund_status,refunded_at,created_at")
        .eq("account_id",session.accountId).order("created_at",{ascending:false}).limit(100);
      if (error) throw error;
      const {data: requests,error:re} = await db.from("audit_refund_requests")
        .select("id,purchase_id,status,reason,created_at")
        .eq("account_id",session.accountId).order("created_at",{ascending:false}).limit(100);
      if(re) throw re;
      return res.status(200).json({purchases:purchases||[],refundRequests:requests||[]});
    }
    if(req.body.action === "request_refund") {
      const purchaseId=String(req.body.purchaseId||"").trim();
      const reason=String(req.body.reason||"").trim();
      if(!/^[0-9a-f-]{36}$/i.test(purchaseId) || reason.length<5 || reason.length>1000)
        return res.status(400).json({error:"Select a purchase and provide a reason (5–1000 characters)."});
      const {data:purchase,error:pe}=await db.from("audit_purchases")
        .select("id,payment_provider,refund_status").eq("id",purchaseId)
        .eq("account_id",session.accountId).maybeSingle();
      if(pe) throw pe;
      if(!purchase || purchase.payment_provider!=="creem") return res.status(404).json({error:"This Creem purchase wasn't found in your account."});
      if(purchase.refund_status==="refunded") return res.status(409).json({error:"This purchase has already been refunded."});
      const {data:existing,error:ee}=await db.from("audit_refund_requests")
        .select("id,status").eq("purchase_id",purchaseId).eq("account_id",session.accountId).maybeSingle();
      if(ee) throw ee;
      if(existing) return res.status(200).json({request:existing,alreadyRequested:true});
      const {data:created,error:ce}=await db.from("audit_refund_requests")
        .insert({account_id:session.accountId,purchase_id:purchaseId,reason})
        .select("id,purchase_id,status,reason,created_at").single();
      if(ce) {
        if(ce.code==="23505") return res.status(409).json({error:"A refund request already exists for this purchase. Refresh your history."});
        throw ce;
      }
      return res.status(200).json({request:created,submitted:true,
        message:"Refund request submitted for review. No money has been refunded yet."});
    }
    return res.status(400).json({error:"Unknown action."});
  } catch(e) {
    console.error("[UXNest purchase history]",e);
    return res.status(500).json({error:"Unable to load or update purchases right now."});
  }
}
