// Audit records. The quota is enforced here, server-side, so clearing browser
// storage no longer resets it.

import { requireDb, readSession } from "./_lib.js";

export const maxDuration = 20;

const AUDIT_QUOTA = Number(process.env.AUDIT_QUOTA || 1);

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
      const { data } = await db.from("accounts").select("audits_used").eq("id", accountId).maybeSingle();
      const used = (data && data.audits_used) || 0;
      res.status(200).json({ used, quota: AUDIT_QUOTA, remaining: Math.max(AUDIT_QUOTA - used, 0) });
      return;
    }

    /* ---------------- Save a completed audit ---------------- */
    if (action === "create") {
      const { data: acct } = await db.from("accounts").select("audits_used").eq("id", accountId).maybeSingle();
      const used = (acct && acct.audits_used) || 0;
      if (used >= AUDIT_QUOTA) {
        res.status(403).json({ error: "You've used your included audit." });
        return;
      }

      const a = req.body.audit || {};
      const { data, error } = await db.from("audits").insert({
        account_id: accountId,
        title: a.title || null,
        mode: a.mode || "files",
        url: a.url || null,
        screen_count: a.screenCount || 0,
        score: typeof a.score === "number" ? a.score : null,
        assessment: a.assessment || null,
        scorecard: a.scorecard || null,
        severities: a.severities || null,
        pages: a.pages || null,
        raw_text: (a.rawText || "").slice(0, 60000),
      }).select().single();
      if (error) throw error;

      await db.from("accounts").update({ audits_used: used + 1 }).eq("id", accountId);
      res.status(200).json({ audit: data, used: used + 1, remaining: Math.max(AUDIT_QUOTA - used - 1, 0) });
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
