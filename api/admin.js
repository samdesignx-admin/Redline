// Admin analytics across every account and audit. Protected by ADMIN_KEY.

import { requireDb } from "./_lib.js";

export const maxDuration = 20;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    res.status(500).json({ error: "Server misconfigured: ADMIN_KEY is not set" });
    return;
  }
  if (((req.body || {}).key || "") !== expected) {
    res.status(401).json({ error: "Invalid admin key" });
    return;
  }

  const db = requireDb(res);
  if (!db) return;

  try {
    const [{ data: accounts, error: aErr }, { data: audits, error: uErr }] = await Promise.all([
      db.from("accounts")
        .select("id,email,name,company,mobile,provider,email_verified,audits_used,created_at,last_login_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      db.from("audits")
        .select("id,account_id,title,mode,url,screen_count,score,assessment,scorecard,severities,created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    if (aErr) throw aErr;
    if (uErr) throw uErr;

    // Attach the owning email to each audit for the admin table.
    const byId = Object.fromEntries((accounts || []).map((a) => [a.id, a.email]));
    const enriched = (audits || []).map((x) => ({ ...x, email: byId[x.account_id] || "—" }));

    res.status(200).json({ accounts: accounts || [], audits: enriched });
  } catch (e) {
    res.status(500).json({ error: `Admin request failed: ${(e && e.message) || "unknown error"}` });
  }
}
