// Audit records. The quota is enforced here, server-side, so clearing browser
// storage no longer resets it.

import { requireDb, readSession } from "./_lib.js";
import { utcMonthWindow, monthlyQuota } from "./_free-beta-quota.js";

export const maxDuration = 20;

const AUDIT_QUOTA = 1; // first completed audit is free; additional audits consume purchased credits

export default async function handler(req, res) {
  // Fail closed until the monthly quota ledger and authentication gates are deployed.
  // Never enable FREE_BETA_AUDITS_ENABLED before those safeguards pass review.
  if (process.env.FREE_BETA_MODE === "true" && process.env.FREE_BETA_AUDITS_ENABLED !== "true") {
    res.setHeader("cache-control", "no-store");
    res.status(503).json({ error: "Free beta audits are not yet available.", code: "BETA_AUDITS_NOT_READY" });
    return;
  }
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
  const isFreeBeta = process.env.FREE_BETA_MODE === "true";
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
      if (isFreeBeta) {
        const { start, end } = utcMonthWindow();
        const { count, error } = await db.from("free_beta_audit_usage")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId).eq("month_start", start.slice(0, 10));
        if (error || count === null) throw error || new Error("Monthly usage unavailable");
        res.status(200).json({ ...monthlyQuota(count), paid: 0, resetsAt: end });
        return;
      }
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
      const requestId = String(req.body.requestId || "");
      if (isFreeBeta && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        res.status(400).json({ error: "A valid audit request ID is required.", code: "INVALID_REQUEST_ID" });
        return;
      }
      const { data, error } = await db.rpc(isFreeBeta ? "create_free_beta_audit" : "create_uxnest_audit", {
        p_account_id: accountId,
        ...(isFreeBeta ? { p_request_id: requestId } : {}),
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
        if (isFreeBeta && String(error.message || "").includes("BETA_MONTHLY_QUOTA_EXCEEDED")) {
          res.status(429).json({ error: "You have used all 3 free audits for this month.", code: "BETA_MONTHLY_QUOTA_EXCEEDED" });
          return;
        }
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
