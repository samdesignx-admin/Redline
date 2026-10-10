// Admin analytics across every account and audit. Protected by ADMIN_KEY.

import { requireDb, rateLimit, clientIp, safeEqual } from "./_lib.js";

export const maxDuration = 20;

const ROW_LIMIT = 1000;

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

  const db = requireDb(res);
  if (!db) return;

  // Throttle guesses at the key (per IP), then compare in constant time.
  if (!(await rateLimit(db, `admin:ip:${clientIp(req)}`, 10, 600))) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  if (!safeEqual(String((req.body || {}).key || ""), expected)) {
    res.status(401).json({ error: "Invalid admin key" });
    return;
  }

  try {
    const [
      { data: accounts, count: accountTotal, error: aErr },
      { data: audits, count: auditTotal, error: uErr },
    ] = await Promise.all([
      db.from("accounts")
        .select("id,email,name,company,mobile,provider,email_verified,audits_used,created_at,last_login_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
      db.from("audits")
        .select("id,account_id,title,mode,url,screen_count,score,assessment,scorecard,severities,created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
    ]);
    if (aErr) throw aErr;
    if (uErr) throw uErr;

    // Attach the owning email to each audit for the admin table.
    const byId = Object.fromEntries((accounts || []).map((a) => [a.id, a.email]));
    const enriched = (audits || []).map((x) => ({ ...x, email: byId[x.account_id] || "—" }));

    res.status(200).json({
      accounts: accounts || [],
      audits: enriched,
      // The tables are capped at ROW_LIMIT rows; totals show when that cut data off.
      totals: { accounts: accountTotal ?? (accounts || []).length, audits: auditTotal ?? enriched.length, limit: ROW_LIMIT },
    });
  } catch (e) {
    console.error("[UXNest admin]", e);
    res.status(500).json({ error: "Admin request failed." });
  }
}
