// Audit records. The quota is enforced here, server-side, so clearing browser
// storage no longer resets it.

import { requireDb, readSession } from "./_lib.js";

export const maxDuration = 20;

const AUDIT_QUOTA = 1; // first completed audit is free; additional audits consume purchased credits

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const db = requireDb(res);
  if (!db) return;

  const sess = readSession((req.body || {}).token);
  if (!sess) {
    res.status(401).json({ error: "Please log in again." });
    return;
  }
  const accountId = sess.accountId;
  const { action } = req.body;

  try {
    /* ---------------- List this account's audits ---------------- */
    if (action === "list") {
      const { data, error } = await db
        .from("audits").select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      res.status(200).json({ audits: data || [] });
      return;
    }

    /* ---------------- Check remaining quota ---------------- */
    if (action === "quota") {
      const { data } = await db.from("accounts").select("audits_used, paid_audits").eq("id", accountId).maybeSingle();
      const used = (data && data.audits_used) || 0;
      const paid = (data && data.paid_audits) || 0;
      res.status(200).json({ used, quota: AUDIT_QUOTA, paid, remaining: Math.max(AUDIT_QUOTA - used, 0) + paid });
      return;
    }

    /* ---------------- Save and charge atomically ---------------- */
    if (action === "create") {
      const a = req.body.audit || {};
      // Database function locks the account and inserts the audit in one transaction:
      // two concurrent audits cannot spend one credit twice.
      const { data, error } = await db.rpc("create_uxnest_audit", {
        p_account_id: accountId,
        p_audit: {
          title: a.title || null,
          mode: a.mode || "files",
          url: a.url || null,
          screenCount: Number.isInteger(a.screenCount) ? a.screenCount : 0,
          score: typeof a.score === "number" && Number.isFinite(a.score) ? a.score : null,
          assessment: a.assessment || null,
          scorecard: a.scorecard || null,
          severities: a.severities || null,
          pages: a.pages || null,
          rawText: String(a.rawText || "").slice(0, 60000),
        },
      });
      if (error) {
        if (String(error.message || "").includes("AUDIT_PAYMENT_REQUIRED")) {
          res.status(402).json({ error: "Your free audit has been used. Purchase another audit for $5.", code: "AUDIT_PAYMENT_REQUIRED" });
          return;
        }
        throw error;
      }
      res.status(200).json(data);
      return;
    }

    /* ---------------- Delete one of this account's audits ---------------- */
    if (action === "delete") {
      const { error } = await db.from("audits").delete()
        .eq("id", req.body.id)
        .eq("account_id", accountId); // scoping prevents deleting another accounts rows
      if (error) throw error;
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(500).json({ error: `Audit request failed: ${(e && e.message) || "unknown error"}` });
  }
}
