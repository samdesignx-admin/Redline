// Applies db/schema.sql + every migration to a real Postgres engine (PGlite) and checks
// credits, rate limiting and function privileges. Also reproduces the pre-fix failures.
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const read = (p) => fs.readFileSync(`${repo}/${p}`, "utf8");
const db = new PGlite();
let failures = 0;
const ok = (name, cond, detail) => { console.log(cond ? "ok  " : "FAIL", name, cond ? "" : JSON.stringify(detail ?? "")); if (!cond) failures++; };
const tryQ = async (sql, params) => { try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; } };

// Supabase's roles
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
               grant usage on schema public to anon, authenticated, service_role;`);

// ---- baseline: original schema + original Creem migration ----
await db.exec(read("db/schema.sql").replace(/alter table accounts add column if not exists paid_audits[^;]*;/, "").replace(/alter table audit_purchases add column if not exists quantity[^;]*;/, ""));
await db.exec(read("supabase/migrations/20260926_creem_audit_payments.sql"));
const acct = (await db.query(`insert into accounts (email) values ('a@x.com') returning id`)).rows[0].id;

// the schema.sql in the repo is already fixed, so recreate the ORIGINAL NOT NULL to prove the old failure mode
await db.exec(`alter table audit_purchases alter column stripe_session_id set not null;`);
let r = await tryQ(`select grant_creem_audit_purchase($1, 'ch_1', 'ev_1', 500, 1, 'usd') as granted`, [acct]);
ok("BEFORE migration: Creem grant fails on NOT NULL stripe_session_id", !!r.error && /stripe_session_id/.test(r.error), r);

// PUBLIC can execute by default -> the anon-key hole
await db.exec(`set role anon`);
r = await tryQ(`select increment_paid_audits($1, 100)`, [acct]);
await db.exec(`reset role`);
ok("BEFORE migration: anon CAN mint credits via increment_paid_audits (the vulnerability)", !r.error, r);
await db.exec(`update accounts set paid_audits = 0`);

// ---- apply the hardening migration (twice, to prove idempotence) ----
await db.exec(read("supabase/migrations/20261009_security_hardening.sql"));
await db.exec(read("supabase/migrations/20261009_security_hardening.sql"));
ok("migration applies cleanly and is re-runnable", true);

// ---- grant works now; idempotent; validated ----
r = await tryQ(`select grant_creem_audit_purchase($1, 'ch_1', 'ev_1', 500, 2, 'usd') as granted`, [acct]);
ok("AFTER: Creem grant succeeds without a Stripe id", r.rows?.[0]?.granted === true, r);
r = await tryQ(`select grant_creem_audit_purchase($1, 'ch_1', 'ev_2', 500, 2, 'usd') as granted`, [acct]);
ok("AFTER: same checkout again is a no-op (false)", r.rows?.[0]?.granted === false, r);
ok("AFTER: credits granted exactly once", (await db.query(`select paid_audits from accounts where id=$1`, [acct])).rows[0].paid_audits === 2);
r = await tryQ(`select grant_creem_audit_purchase($1, 'ch_9', null, 500, 9999, 'usd')`, [acct]);
ok("AFTER: absurd quantity rejected inside the function", !!r.error && /invalid purchase quantity/.test(r.error), r);
r = await tryQ(`select grant_creem_audit_purchase($1, 'ch_8', null, 500, 0, 'usd')`, [acct]);
ok("AFTER: zero quantity rejected", !!r.error, r);

// ---- privileges ----
for (const role of ["anon", "authenticated"]) {
  for (const [label, sql] of [
    ["create_audit_with_credit", `select create_audit_with_credit('${acct}', 1, '{}'::jsonb)`],
    ["grant_creem_audit_purchase", `select grant_creem_audit_purchase('${acct}', 'ch_x', null, 500, 5, 'usd')`],
    ["hit_rate_limit", `select hit_rate_limit('k', 5, 60)`],
  ]) {
    await db.exec(`set role ${role}`);
    const res = await tryQ(sql);
    await db.exec(`reset role`);
    ok(`AFTER: ${role} cannot call ${label}`, !!res.error && /permission denied/.test(res.error), res);
  }
}
r = await tryQ(`select increment_paid_audits('${acct}', 1)`);
ok("AFTER: increment_paid_audits no longer exists", !!r.error && /does not exist/.test(r.error), r);
await db.exec(`set role service_role`);
r = await tryQ(`select hit_rate_limit('svc', 5, 60) as allowed`);
await db.exec(`reset role`);
ok("AFTER: service_role can still call the functions", r.rows?.[0]?.allowed === true, r);

// ---- atomic credit consumption ----
const a2 = (await db.query(`insert into accounts (email) values ('b@x.com') returning id`)).rows[0].id;
const audit = JSON.stringify({ title: "T", mode: "url", url: "https://x.test", screen_count: 0, score: 81.6, assessment: "Good", scorecard: { usability: 80 }, severities: null, pages: ["https://x.test"], raw_text: "raw" });
r = await tryQ(`select create_audit_with_credit($1, 1, $2::jsonb) as res`, [a2, audit]);
let res = r.rows?.[0]?.res;
ok("credit: first audit consumes the FREE credit", res && res.used === 1 && res.paid === 0 && res.audit.account_id === a2, r);
ok("credit: audit row stored with sanitised values (score rounded, JSON null -> SQL null)", res.audit.score === 82 && res.audit.severities === null && Array.isArray(res.audit.pages), res.audit);
r = await tryQ(`select create_audit_with_credit($1, 1, $2::jsonb) as res`, [a2, audit]);
ok("credit: second audit with nothing left returns NULL and inserts nothing", r.rows?.[0]?.res === null && (await db.query(`select count(*)::int c from audits where account_id=$1`, [a2])).rows[0].c === 1, r);
await db.exec(`update accounts set paid_audits = 2 where id = '${a2}'`);
r = await tryQ(`select create_audit_with_credit($1, 1, $2::jsonb) as res`, [a2, audit]);
ok("credit: next audit spends a PAID credit (2 -> 1), free count unchanged", r.rows?.[0]?.res?.paid === 1 && r.rows[0].res.used === 1, r);
r = await tryQ(`select create_audit_with_credit($1, 1, $2::jsonb) as res`, [a2, audit]);
r = await tryQ(`select create_audit_with_credit($1, 1, $2::jsonb) as res`, [a2, audit]);
ok("credit: balance stops at zero (never negative) and refuses further audits", r.rows?.[0]?.res === null && (await db.query(`select paid_audits from accounts where id=$1`, [a2])).rows[0].paid_audits === 0, r);

// failed insert must roll the credit back (bad uuid account => FK violation inside the function)
await db.exec(`update accounts set paid_audits = 1, audits_used = 1 where id='${a2}'`);
r = await tryQ(`select create_audit_with_credit($1, 1, '{"screen_count":"not-a-number"}'::jsonb)`, [a2]);
const bal = (await db.query(`select paid_audits from accounts where id=$1`, [a2])).rows[0].paid_audits;
ok("credit: if the audit insert fails, the credit is NOT lost (transaction rolled back)", !!r.error && bal === 1, { r, bal });

// ---- rate limiter ----
const hits = [];
for (let i = 0; i < 7; i++) hits.push((await db.query(`select hit_rate_limit('rl:test', 5, 60) as a`)).rows[0].a);
ok("rate limit: first 5 allowed, then denied", JSON.stringify(hits) === JSON.stringify([true, true, true, true, true, false, false]), hits);
await db.exec(`update rate_limits set window_start = now() - interval '2 minutes' where key = 'rl:test'`);
ok("rate limit: window expiry resets the counter", (await db.query(`select hit_rate_limit('rl:test', 5, 60) as a`)).rows[0].a === true && (await db.query(`select count from rate_limits where key='rl:test'`)).rows[0].count === 1);
ok("rate limit: keys are independent", (await db.query(`select hit_rate_limit('rl:other', 1, 60) as a`)).rows[0].a === true);

// ---- session_epoch column ----
ok("accounts.session_epoch exists and defaults to 0", (await db.query(`select session_epoch from accounts where id=$1`, [a2])).rows[0].session_epoch === 0);
console.log(failures ? `\n${failures} SQL check(s) FAILED` : "\nSQL migration checks passed.");
process.exit(failures ? 1 : 0);
