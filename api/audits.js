// Audit records. The quota is enforced here, server-side, atomically in the
// database (create_audit_with_credit), so neither clearing browser storage nor
// concurrent requests can get around it.

import { requireDb, authenticate } from "./_lib.js";

export const maxDuration = 20;

const AUDIT_QUOTA = 1; // first completed audit is free; additional audits consume purchased credits
const MAX_JSON_BYTES = 2_000_000; // per JSON column (pages/scorecard/severities)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);

function jsonColumn(value) {
  if (value == null || typeof value !== "object") return null;
  try {
    return JSON.stringify(value).length <= MAX_JSON_BYTES ? value : null;
  } catch {
    return null;
  }
}

// Whitelist and bound every client-supplied field before it reaches the DB.
function sanitizeAudit(a) {
  const input = a && typeof a === "object" ? a : {};
  const screenCount = Number(input.screenCount);
  return {
    title: text(input.title, 300),
    mode: input.mode === "url" ? "url" : "files",
    url: text(input.url, 2048),
    screen_count: Number.isInteger(screenCount) && screenCount >= 0 && screenCount <= 100 ? screenCount : 0,
    score: typeof input.score === "number" && Number.isFinite(input.score) ? Math.max(0, Math.min(100, input.score)) : null,
    assessment: text(input.assessment, 2000),
    scorecard: jsonColumn(input.scorecard),
    severities: jsonColumn(input.severities),
    pages: jsonColumn(input.pages),
    raw_text: text(input.rawText, 60000) || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const db = requireDb(res);
  if (!db) return;

  const sess = await authenticate(db, (req.body || {}).token);
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

    /* ---------------- Save a completed audit ---------------- */
    if (action === "create") {
      // Spends one credit and inserts the audit in a single transaction.
      const { data, error } = await db.rpc("create_audit_with_credit", {
        p_account_id: accountId,
        p_free_quota: AUDIT_QUOTA,
        p_audit: sanitizeAudit(req.body.audit),
      });
      if (error) throw error;
      if (!data) {
        res.status(402).json({ error: "Your free audit has been used. Purchase another audit for $5.", code: "AUDIT_PAYMENT_REQUIRED" });
        return;
      }
      const used = data.used || 0;
      const paid = data.paid || 0;
      res.status(200).json({
        audit: data.audit,
        used,
        paid,
        remaining: Math.max(AUDIT_QUOTA - used, 0) + paid,
      });
      return;
    }

    /* ---------------- Delete one of this account's audits ---------------- */
    if (action === "delete") {
      const id = String(req.body.id || "");
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid audit id." });
        return;
      }
      const { error } = await db.from("audits").delete()
        .eq("id", id)
        .eq("account_id", accountId); // scoping prevents deleting another accounts rows
      if (error) throw error;
      res.status(200).json({ deleted: true });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    console.error("[UXNest audits]", e);
    res.status(500).json({ error: "Audit request failed. Please try again." });
  }
}
