// End-to-end checks of the serverless API handlers against an in-memory fake
// of the Supabase client and stubbed outbound HTTP. Run with:
//   node --experimental-test-module-mocks scripts/verify-api-flows.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { mock } from "node:test";

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.SESSION_SECRET = "session-secret-for-tests-0123456789";
process.env.VERIFY_SECRET = "verify-secret-for-tests-0123456789";
process.env.RESEND_API_KEY = "resend-key";
process.env.ANTHROPIC_API_KEY = "anthropic-key";
process.env.ADMIN_KEY = "admin-key-for-tests";
process.env.CREEM_API_KEY = "creem-key";
process.env.CREEM_PRODUCT_ID = "prod_test";
process.env.CREEM_WEBHOOK_SECRET = "whsec_test";
process.env.SITE_URL = "https://uxnest.ai";
delete process.env.GOOGLE_CLIENT_ID;

/* ---------------- fake Supabase client ---------------- */
const tables = { accounts: [], audits: [], audit_purchases: [] };
const limits = new Map();
const rpcLog = [];

function builder(table) {
  const st = { op: "select", filters: [], values: null, single: false };
  const matches = (row) => st.filters.every(([c, v]) => row[c] === v);
  const run = () => {
    const rows = tables[table];
    if (st.op === "insert") {
      const row = {
        id: crypto.randomUUID(), session_epoch: 0, audits_used: 0, paid_audits: 0, plan: "free",
        provider: "password", email_verified: false, created_at: new Date().toISOString(), ...st.values,
      };
      if (table === "accounts" && rows.some((r) => r.email === row.email)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      rows.push(row);
      return { data: st.single ? row : [row], error: null };
    }
    if (st.op === "update") { rows.filter(matches).forEach((r) => Object.assign(r, st.values)); return { data: null, error: null }; }
    if (st.op === "delete") { tables[table] = rows.filter((r) => !matches(r)); return { data: null, error: null }; }
    const found = rows.filter(matches);
    return { data: st.single ? found[0] || null : found, error: null };
  };
  const b = {
    select() { return b; },
    insert(v) { st.op = "insert"; st.values = v; return b; },
    update(v) { st.op = "update"; st.values = v; return b; },
    delete() { st.op = "delete"; return b; },
    eq(c, v) { st.filters.push([c, v]); return b; },
    order() { return b; },
    limit() { return b; },
    single() { st.single = true; return b; },
    maybeSingle() { st.single = true; return b; },
    then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } },
  };
  return b;
}

async function rpc(name, args) {
  rpcLog.push([name, args]);
  if (name === "hit_rate_limit") {
    const now = Date.now();
    let e = limits.get(args.p_key);
    if (!e || now - e.start >= args.p_window_seconds * 1000) e = { start: now, count: 0 };
    e.count++;
    limits.set(args.p_key, e);
    return { data: e.count <= args.p_limit, error: null };
  }
  if (name === "create_audit_with_credit") {
    const acct = tables.accounts.find((a) => a.id === args.p_account_id);
    if (!acct || !(acct.audits_used < args.p_free_quota || acct.paid_audits > 0)) return { data: null, error: null };
    if (acct.audits_used < args.p_free_quota) acct.audits_used++; else acct.paid_audits--;
    const audit = { id: crypto.randomUUID(), account_id: acct.id, ...args.p_audit };
    tables.audits.push(audit);
    return { data: { audit, used: acct.audits_used, paid: acct.paid_audits }, error: null };
  }
  if (name === "grant_creem_audit_purchase") {
    if (tables.audit_purchases.some((p) => p.creem_checkout_id === args.p_checkout_id)) return { data: false, error: null };
    tables.audit_purchases.push({ creem_checkout_id: args.p_checkout_id, quantity: args.p_quantity });
    const acct = tables.accounts.find((a) => a.id === args.p_account_id);
    acct.paid_audits += args.p_quantity;
    return { data: true, error: null };
  }
  return { data: null, error: { message: `unknown rpc ${name}` } };
}

mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => ({ from: builder, rpc }) },
});

/* ---------------- stubbed outbound HTTP ---------------- */
const outbound = [];
let googleInfo = {};
let creemCheckout = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  outbound.push({ url: u, opts });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://api.resend.com")) return json({ id: "email_1" });
  if (u.startsWith("https://oauth2.googleapis.com/tokeninfo")) return json(googleInfo);
  if (u.startsWith("https://api.anthropic.com")) return json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
  if (u.startsWith("https://api.creem.io/v1/checkouts") && (opts.method || "GET") === "GET") return json(creemCheckout);
  throw new Error(`unexpected outbound fetch: ${u}`);
};

const { default: account } = await import("../api/account.js");
const { default: verify } = await import("../api/verify.js");
const { default: audits } = await import("../api/audits.js");
const { default: auditProxy } = await import("../api/audit.js");
const { default: payment } = await import("../api/payment.js");
const { default: webhook } = await import("../api/creem-webhook.js");
const { default: fetchUrl } = await import("../api/fetch-url.js");
const lib = await import("../api/_lib.js");

/* ---------------- helpers ---------------- */
let failures = 0;
function ok(name, cond, detail) {
  console.log(cond ? "ok  " : "FAIL", name, cond ? "" : (detail ? `-> ${JSON.stringify(detail)}` : ""));
  if (!cond) failures++;
}
function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(s) { this.body = s; return this; },
  };
}
async function call(handler, body, headers = {}) {
  const res = mockRes();
  await handler({ method: "POST", body, headers: { "x-forwarded-for": "9.9.9.9", ...headers }, socket: {} }, res);
  return res;
}
const lastCode = () => {
  const sent = outbound.filter((o) => o.url.startsWith("https://api.resend.com")).at(-1);
  return /^(\d{6}) is your/.exec(JSON.parse(sent.opts.body).subject)[1];
};
const emailsSent = () => outbound.filter((o) => o.url.startsWith("https://api.resend.com")).length;
const lastAnthropicBody = () => JSON.parse(outbound.filter((o) => o.url.startsWith("https://api.anthropic.com")).at(-1).opts.body);

async function signUp(email, password = "hunter22", headers = {}) {
  const sent = await call(verify, { action: "send", email, purpose: "signup" }, headers);
  const code = lastCode();
  const res = await call(account, { action: "signup", email, password, name: "T", company: "Co", code, verifyToken: sent.body.token }, headers);
  return { sent, code, res };
}

/* ---------------- library primitives ---------------- */
{
  const h = await lib.hashPassword("correct horse");
  ok("password: right password verifies", await lib.verifyPassword("correct horse", h));
  ok("password: wrong password rejected", !(await lib.verifyPassword("nope", h)));
  ok("password: missing hash rejected without throwing", !(await lib.verifyPassword("x", null)));
  ok("password: over-long input rejected", !(await lib.verifyPassword("a".repeat(500), h)));

  const id = crypto.randomUUID();
  const t = lib.issueSession(id, 3);
  ok("session: round-trips with epoch", lib.readSession(t)?.accountId === id && lib.readSession(t)?.epoch === 3);
  const parts = t.split(".");
  ok("session: tampered epoch rejected", lib.readSession([parts[0], parts[1], "9", parts[3]].join(".")) === null);
  ok("session: tampered account rejected", lib.readSession([crypto.randomUUID(), parts[1], parts[2], parts[3]].join(".")) === null);
  ok("session: legacy 3-part token rejected", lib.readSession(`${id}.${Date.now() + 1e6}.deadbeef`) === null);
  ok("session: non-uuid account id rejected", lib.readSession(["admin", parts[1], parts[2], parts[3]].join(".")) === null);

  // An email-code signature must never double as a session signature.
  const v = lib.issueVerification("a@b.co", "signup");
  ok("verification: right code accepted", lib.checkVerification({ email: "a@b.co", purpose: "signup", code: v.code, token: v.token }).ok);
  ok("verification: wrong code rejected", !lib.checkVerification({ email: "a@b.co", purpose: "signup", code: "000000", token: v.token }).ok);
  ok("verification: other email rejected", !lib.checkVerification({ email: "c@d.co", purpose: "signup", code: v.code, token: v.token }).ok);
  ok("verification: signup code can't be used for reset", !lib.checkVerification({ email: "a@b.co", purpose: "reset", code: v.code, token: v.token }).ok);
  const r = lib.issueVerification("a@b.co", "reset", "bind1");
  ok("verification: reset binding enforced", !lib.checkVerification({ email: "a@b.co", purpose: "reset", code: r.code, token: r.token, binding: "bind2" }).ok);
  ok("verification: expired token rejected", !lib.checkVerification({ email: "a@b.co", purpose: "signup", code: v.code, token: `signup.${Date.now() - 1}.${v.token.split(".")[2]}` }).ok);
}

/* ---------------- signup requires a real code ---------------- */
{
  const email = "new@example.com";
  const sent = await call(verify, { action: "send", email, purpose: "signup" });
  ok("send: returns signed envelope only", sent.statusCode === 200 && typeof sent.body.token === "string" && !("code" in sent.body));
  const code = lastCode();

  let res = await call(account, { action: "signup", email, password: "hunter22", name: "T", company: "Co", emailVerified: true });
  ok("signup: client 'emailVerified' flag alone is rejected", res.statusCode === 400, res.body);
  res = await call(account, { action: "signup", email, password: "hunter22", name: "T", company: "Co", code: "000000", verifyToken: sent.body.token });
  ok("signup: wrong code rejected", res.statusCode === 400, res.body);
  res = await call(account, { action: "signup", email: "other@example.com", password: "hunter22", name: "T", company: "Co", code, verifyToken: sent.body.token });
  ok("signup: code for another email rejected", res.statusCode === 400, res.body);
  ok("signup: nothing created by failed attempts", tables.accounts.length === 0);

  res = await call(account, { action: "signup", email, password: "hunter22", name: "T", company: "Co", code, verifyToken: sent.body.token });
  ok("signup: valid code creates a verified account", res.statusCode === 200 && res.body.account.emailVerified === true && !!res.body.token, res.body);
  const token = res.body.token;

  res = await call(account, { action: "session", token });
  ok("session: restores account", res.body.account?.email === email);

  res = await call(account, { action: "signup", email, password: "hunter22", name: "T", company: "Co", code, verifyToken: sent.body.token });
  ok("signup: duplicate email -> 409", res.statusCode === 409, res.body);
}

/* ---------------- login ---------------- */
{
  let res = await call(account, { action: "login", email: "new@example.com", password: "wrong" });
  ok("login: wrong password -> 401", res.statusCode === 401);
  res = await call(account, { action: "login", email: "ghost@example.com", password: "wrong" });
  ok("login: unknown email gets the same 401 message", res.statusCode === 401 && res.body.error === "Incorrect email or password.");
  res = await call(account, { action: "login", email: "new@example.com", password: "hunter22" });
  ok("login: right password -> 200 with token", res.statusCode === 200 && !!res.body.token);

  let last;
  for (let i = 0; i < 12; i++) last = await call(account, { action: "login", email: "victim@example.com", password: `guess${i}` });
  ok("login: repeated guesses on one account get throttled (429)", last.statusCode === 429, last.statusCode);
}

/* ---------------- password reset ---------------- */
{
  const email = "new@example.com";
  const old = (await call(account, { action: "login", email, password: "hunter22" })).body.token;

  const before = emailsSent();
  const ghost = await call(verify, { action: "send", email: "nobody@example.com", purpose: "reset" });
  ok("reset: unknown email looks identical (200 + token)", ghost.statusCode === 200 && typeof ghost.body.token === "string");
  ok("reset: ...but no email is sent to it", emailsSent() === before);

  const sent = await call(verify, { action: "send", email, purpose: "reset" });
  const code = lastCode();
  ok("reset: known email is sent a code", emailsSent() === before + 1);

  let res = await call(verify, { action: "reset", email, code: "000000", token: sent.body.token, newPassword: "newpass99" });
  ok("reset: wrong code rejected", res.statusCode === 400, res.body);
  res = await call(verify, { action: "reset", email: "nobody@example.com", code: ghost.body.token.slice(0, 6), token: ghost.body.token, newPassword: "newpass99" });
  ok("reset: unknown account gets a generic 400, not a 404", res.statusCode === 400, res.body);
  res = await call(verify, { action: "reset", email, code, token: sent.body.token, newPassword: "short" });
  ok("reset: short password rejected", res.statusCode === 400);

  res = await call(verify, { action: "reset", email, code, token: sent.body.token, newPassword: "newpass99" });
  ok("reset: right code resets the password", res.statusCode === 200 && res.body.reset === true, res.body);
  res = await call(verify, { action: "reset", email, code, token: sent.body.token, newPassword: "another123" });
  ok("reset: the same code cannot be used twice", res.statusCode === 400, res.body);

  res = await call(account, { action: "session", token: old });
  ok("reset: sessions issued before the reset are revoked", res.body.account === null);
  res = await call(account, { action: "login", email, password: "hunter22" });
  ok("reset: old password no longer works", res.statusCode === 401);
  res = await call(account, { action: "login", email, password: "newpass99" });
  ok("reset: new password works and issues a working session", res.statusCode === 200 && (await call(account, { action: "session", token: res.body.token })).body.account?.email === email);

  // Guessing the 6-digit code is capped.
  const s2 = await call(verify, { action: "send", email, purpose: "reset" });
  let r;
  for (let i = 0; i < 12; i++) r = await call(verify, { action: "reset", email, code: String(100000 + i), token: s2.body.token, newPassword: "newpass99" });
  ok("reset: code guessing is cut off with 429", r.statusCode === 429, r.statusCode);
}

/* ---------------- Google sign-in ---------------- */
{
  googleInfo = { aud: "client-123", iss: "https://accounts.google.com", email: "g@example.com", email_verified: "true", name: "G" };
  let res = await call(account, { action: "google", credential: "tok" });
  ok("google: fails closed when GOOGLE_CLIENT_ID is unset", res.statusCode === 500, res.body);

  process.env.GOOGLE_CLIENT_ID = "client-123";
  googleInfo.aud = "someone-elses-app";
  res = await call(account, { action: "google", credential: "tok" });
  ok("google: token minted for another app rejected", res.statusCode === 401, res.body);
  googleInfo.aud = "client-123"; googleInfo.email_verified = "false";
  res = await call(account, { action: "google", credential: "tok" });
  ok("google: unverified email rejected", res.statusCode === 401, res.body);
  googleInfo.email_verified = "true"; googleInfo.iss = "https://evil.example";
  res = await call(account, { action: "google", credential: "tok" });
  ok("google: wrong issuer rejected", res.statusCode === 401, res.body);
  googleInfo.iss = "https://accounts.google.com";
  res = await call(account, { action: "google", credential: "tok" });
  ok("google: valid token signs in", res.statusCode === 200 && res.body.account.email === "g@example.com", res.body);
}

/* ---------------- quota is atomic and server-enforced ---------------- */
{
  const { res } = await signUp("quota@example.com");
  const token = res.body.token;
  const id = res.body.account.id;
  const acct = tables.accounts.find((a) => a.id === id);

  ok("audits: bad token -> 401", (await call(audits, { action: "list", token: "junk" })).statusCode === 401);
  const mk = () => call(audits, { action: "create", token, audit: { title: "T", mode: "url", url: "https://x.test", score: 77, rawText: "r", pages: ["https://x.test"] } });

  let r = await mk();
  ok("audits: first audit uses the free credit", r.statusCode === 200 && r.body.used === 1 && r.body.remaining === 0, r.body);
  r = await mk();
  ok("audits: second audit blocked with 402", r.statusCode === 402 && r.body.code === "AUDIT_PAYMENT_REQUIRED", r.body);

  acct.paid_audits = 1;
  const results = await Promise.all([mk(), mk(), mk(), mk(), mk()]);
  ok("audits: 5 concurrent saves with 1 paid credit -> exactly 1 succeeds", results.filter((x) => x.statusCode === 200).length === 1, results.map((x) => x.statusCode));
  ok("audits: credit counters end at zero (never negative)", acct.paid_audits === 0);

  const rpcCall = rpcLog.filter(([n]) => n === "create_audit_with_credit").at(-1)[1];
  ok("audits: client input is sanitised before the DB", rpcCall.p_audit.mode === "url" && rpcCall.p_audit.score === 77);
  r = await call(audits, { action: "create", token, audit: { title: "x".repeat(10000), score: "not-a-number", mode: "evil" } });
  ok("audits: no credit left -> still 402 for odd input", r.statusCode === 402);
  r = await call(audits, { action: "delete", token, id: "not-a-uuid" });
  ok("audits: delete rejects non-uuid ids", r.statusCode === 400);
}

/* ---------------- AI proxy ---------------- */
{
  const msgs = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  const evilTools = [{ type: "web_search_20250305", name: "web_search", max_uses: 9999 }, { type: "code_execution_20250522", name: "code_execution" }];

  let res = await call(auditProxy, { purpose: "preview", model: "claude-opus-5-5", max_tokens: 4096, messages: msgs, tools: evilTools }, { "x-forwarded-for": "1.1.1.1" });
  const b = lastAnthropicBody();
  ok("proxy/preview: works without an account", res.statusCode === 200);
  ok("proxy/preview: model is fixed server-side", b.model === "claude-sonnet-5-5", b.model);
  ok("proxy/preview: max_tokens capped", b.max_tokens === 700, b.max_tokens);
  ok("proxy/preview: only web_search allowed, uses capped", b.tools?.length === 1 && b.tools[0].name === "web_search" && b.tools[0].max_uses === 3, b.tools);

  res = await call(auditProxy, { purpose: "support", max_tokens: 900, messages: msgs, tools: evilTools }, { "x-forwarded-for": "1.1.1.2" });
  ok("proxy/support: tools are dropped entirely", res.statusCode === 200 && lastAnthropicBody().tools === undefined);

  res = await call(auditProxy, { purpose: "preview", messages: [{ role: "user", content: "x".repeat(40000) }] }, { "x-forwarded-for": "1.1.1.3" });
  ok("proxy/preview: oversize request -> 413", res.statusCode === 413);
  res = await call(auditProxy, { purpose: "preview", messages: [] }, { "x-forwarded-for": "1.1.1.3" });
  ok("proxy: empty messages -> 400", res.statusCode === 400);

  let last;
  for (let i = 0; i < 12; i++) last = await call(auditProxy, { purpose: "preview", messages: msgs }, { "x-forwarded-for": "2.2.2.2" });
  ok("proxy/preview: per-IP limit kicks in (429)", last.statusCode === 429, last.statusCode);

  res = await call(auditProxy, { max_tokens: 1000, messages: msgs }, { "x-forwarded-for": "3.3.3.3" });
  ok("proxy/audit: no account -> 401 (default purpose is the strict one)", res.statusCode === 401, res.body);
  res = await call(auditProxy, { purpose: "audit", token: "junk", messages: msgs }, { "x-forwarded-for": "3.3.3.3" });
  ok("proxy/audit: bad token -> 401", res.statusCode === 401);

  const { res: su } = await signUp("proxy@example.com");
  const acct = tables.accounts.find((a) => a.email === "proxy@example.com");
  res = await call(auditProxy, { purpose: "audit", token: su.body.token, max_tokens: 99999, model: "claude-opus-5-5", messages: msgs }, { "x-forwarded-for": "3.3.3.4" });
  ok("proxy/audit: signed-in account with credit -> 200", res.statusCode === 200, res.body);
  ok("proxy/audit: model fixed and max_tokens capped", lastAnthropicBody().model === "claude-sonnet-5-5" && lastAnthropicBody().max_tokens === 4096);

  acct.audits_used = 1; acct.paid_audits = 0;
  const calls = outbound.length;
  res = await call(auditProxy, { purpose: "audit", token: su.body.token, messages: msgs }, { "x-forwarded-for": "3.3.3.4" });
  ok("proxy/audit: out of credits -> 402 and no upstream call is made", res.statusCode === 402 && outbound.length === calls, res.body);

  res = await call(auditProxy, { purpose: "audit", token: su.body.token, messages: msgs, }, { "x-forwarded-for": "3.3.3.4", "x-uxnest-request-id": "bad\r\nset-cookie: x=1" });
  ok("proxy: unsafe request-id header is not echoed", !String(res.headers["x-uxnest-request-id"] || "").includes("set-cookie"));
}

/* ---------------- fetch-url ---------------- */
{
  let res = await call(fetchUrl, { url: "https://example.com" });
  ok("fetch-url: no account -> 401", res.statusCode === 401);

  const { res: su } = await signUp("fetcher@example.com");
  res = await call(fetchUrl, { url: "http://169.254.169.254/latest/meta-data/", token: su.body.token });
  ok("fetch-url: cloud metadata address refused", res.statusCode === 422 && /Private network|public website/i.test(res.body.reason || ""), res.body);
  res = await call(fetchUrl, { url: "http://[::ffff:7f00:1]:8080/", token: su.body.token });
  ok("fetch-url: IPv4-mapped IPv6 loopback refused", res.statusCode === 422, res.body);
  res = await call(fetchUrl, { url: "http://localhost/admin", token: su.body.token });
  ok("fetch-url: localhost refused", res.statusCode === 422);

  tables.accounts.find((a) => a.email === "fetcher@example.com").audits_used = 1;
  res = await call(fetchUrl, { url: "https://example.com", token: su.body.token });
  ok("fetch-url: no credits -> 402 before any provider is called", res.statusCode === 402);
}

/* ---------------- payments ---------------- */
{
  const { res: su } = await signUp("payer@example.com");
  const acct = tables.accounts.find((a) => a.email === "payer@example.com");
  const completed = (id) => ({ id, status: "completed", units: 3, metadata: { account_id: acct.id, quantity: "3" }, product: { id: "prod_test", billing_type: "onetime", currency: "USD", price: 500 } });

  creemCheckout = completed("ch_abc123");
  let res = await call(payment, { action: "verify", token: su.body.token, checkoutId: "ch_abc123" });
  ok("payment: verify with checkoutId credits the account", res.statusCode === 200 && res.body.paid === 3 && acct.paid_audits === 3, res.body);
  res = await call(payment, { action: "verify", token: su.body.token, checkoutId: "ch_abc123" });
  ok("payment: replaying the same checkout does not double-credit", acct.paid_audits === 3, acct.paid_audits);
  res = await call(payment, { action: "verify", token: su.body.token, sessionId: "ch_def456" });
  ok("payment: legacy 'sessionId' param is still understood", res.statusCode !== 400, res.body);
  res = await call(payment, { action: "verify", token: su.body.token, checkoutId: "../etc/passwd" });
  ok("payment: malformed checkout id -> 400", res.statusCode === 400);

  const { res: other } = await signUp("other@example.com");
  creemCheckout = completed("ch_zzz999"); // belongs to payer, not other
  res = await call(payment, { action: "verify", token: other.body.token, checkoutId: "ch_zzz999" });
  ok("payment: someone else's checkout cannot be claimed (403)", res.statusCode === 403, res.body);

  creemCheckout = { ...completed("ch_cheap01"), product: { id: "prod_test", billing_type: "onetime", currency: "USD", price: 1 } };
  res = await call(payment, { action: "verify", token: su.body.token, checkoutId: "ch_cheap01" });
  ok("payment: wrong price rejected", res.statusCode === 400, res.body);
}

/* ---------------- webhook: signature is over the raw bytes ---------------- */
{
  const acct = tables.accounts.find((a) => a.email === "payer@example.com");
  const before = acct.paid_audits;
  // Deliberately NOT what JSON.stringify(JSON.parse(x)) would produce.
  const raw = `{\n  "id" : "evt_1",\n  "eventType" : "checkout.completed",\n  "object" : { "id":"ch_hook001", "status":"completed", "units":2,\n    "metadata": {"account_id":"${acct.id}","quantity":"2"},\n    "product": {"id":"prod_test","billing_type":"onetime","currency":"USD","price":500} }\n}`;
  const sign = (body) => crypto.createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET).update(body).digest("hex");
  const send = async (body, sig) => {
    const res = mockRes();
    const req = Readable.from([Buffer.from(body)]);
    Object.assign(req, { method: "POST", headers: { "creem-signature": sig }, socket: {} });
    await webhook(req, res);
    return res;
  };

  let res = await send(raw, "0".repeat(64));
  ok("webhook: bad signature -> 401", res.statusCode === 401);
  res = await send(raw, sign(raw));
  ok("webhook: valid signature over pretty-printed raw body -> 200 and credits", res.statusCode === 200 && acct.paid_audits === before + 2, { status: res.statusCode, paid: acct.paid_audits, before });
  res = await send(raw, sign(raw));
  ok("webhook: redelivery is idempotent", res.statusCode === 200 && acct.paid_audits === before + 2);

  const wrongProduct = raw.replace("prod_test", "prod_other").replace("ch_hook001", "ch_hook002");
  res = await send(wrongProduct, sign(wrongProduct));
  ok("webhook: wrong product is acknowledged (no retry storm) but never credited", res.statusCode === 200 && acct.paid_audits === before + 2);
}

/* ---------------- admin ---------------- */
{
  let res = await call(await import("../api/admin.js").then((m) => m.default), { key: "wrong" });
  ok("admin: wrong key -> 401", res.statusCode === 401);
  let last;
  const admin = (await import("../api/admin.js")).default;
  for (let i = 0; i < 12; i++) last = await call(admin, { key: `guess${i}` }, { "x-forwarded-for": "8.8.4.4" });
  ok("admin: key guessing is throttled (429)", last.statusCode === 429, last.statusCode);
}

console.log(failures ? `\n${failures} API flow check(s) FAILED` : "\nAPI flow checks passed.");
process.exit(failures ? 1 : 0);
