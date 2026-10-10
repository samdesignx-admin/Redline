// Shared server-side helpers. Never imported by browser code — this module
// uses the Supabase service role key, which bypasses row level security.
// Files starting with "_" are not exposed as routes by Vercel.

import crypto from "crypto";
import { promisify } from "util";
import { createClient } from "@supabase/supabase-js";

const scrypt = promisify(crypto.scrypt);

export function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/* ---------------- Passwords ---------------- */
// scrypt with a per-user random salt. Stored as "salt:hash". The async
// variant is used so a login burst does not block the event loop.
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 200; // bounds scrypt work per request

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scrypt(String(password), salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(12).toString("hex"));
  return dummyHashPromise;
}

async function checkHash(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = (await scrypt(String(password), salt, 64)).toString("hex");
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Always performs one scrypt, even when there is no usable stored hash, so
// response time does not reveal whether an account exists.
export async function verifyPassword(password, stored) {
  const usable = typeof stored === "string" && stored.includes(":");
  const tooLong = String(password ?? "").length > MAX_PASSWORD_LENGTH;
  const ok = await checkHash(tooLong ? "" : password, usable ? stored : await dummyHash());
  return usable && !tooLong && ok;
}

export function passwordFingerprint(storedHash) {
  return crypto.createHash("sha256").update(String(storedHash || "")).digest("hex").slice(0, 32);
}

/* ---------------- Keys ---------------- */
// Sessions and email codes are signed with separate sub-keys derived from the
// configured secrets, so a signature produced for one purpose can never be
// replayed as the other.
function deriveKey(baseSecret, purpose) {
  return crypto.createHmac("sha256", baseSecret).update(`uxnest:${purpose}`).digest();
}

function sessionKey() {
  const base = process.env.SESSION_SECRET || process.env.VERIFY_SECRET;
  return base ? deriveKey(base, "session-v2") : null;
}

function verificationKey() {
  const base = process.env.VERIFY_SECRET;
  return base ? deriveKey(base, "email-code-v2") : null;
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------------- Sessions ---------------- */
// Stateless signed tokens: accountId.expiry.epoch.signature
// The epoch lives on the account row; bumping it (password reset) revokes
// every token issued before.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function issueSession(accountId, epoch = 0) {
  const key = sessionKey();
  if (!key) throw new Error("SESSION_SECRET is not set");
  const expires = Date.now() + SESSION_TTL_MS;
  const body = `${accountId}.${expires}.${Number(epoch) || 0}`;
  const sig = crypto.createHmac("sha256", key).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function readSession(token) {
  const key = sessionKey();
  if (!key || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4) return null;
  const [accountId, expiresStr, epochStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!UUID_RE.test(accountId) || !expires || Date.now() > expires) return null;
  const expected = crypto.createHmac("sha256", key).update(`${accountId}.${expiresStr}.${epochStr}`).digest("hex");
  if (!safeEqualHex(expected, sig)) return null;
  return { accountId, epoch: Number(epochStr) || 0 };
}

// Validates the token AND that it has not been revoked. Returns
// { accountId } or null. Use this instead of readSession in endpoints.
export async function authenticate(db, token) {
  const sess = readSession(token);
  if (!sess) return null;
  let { data, error } = await db.from("accounts").select("id, session_epoch").eq("id", sess.accountId).maybeSingle();
  if (error && /session_epoch/i.test(error.message || "")) {
    // Migration not applied yet: behave as epoch 0 rather than locking everyone out.
    ({ data } = await db.from("accounts").select("id").eq("id", sess.accountId).maybeSingle());
  }
  if (!data) return null;
  if ((data.session_epoch ?? 0) !== sess.epoch) return null;
  return { accountId: sess.accountId };
}

/* ---------------- Email verification codes ---------------- */
// HMAC(email, purpose, code, expiry, binding). `binding` ties a password-reset
// code to the account's current password hash, so a code stops working the
// moment it has been used.
export const CODE_TTL_MS = 10 * 60 * 1000;

export function verificationConfigured() {
  return !!verificationKey();
}

function signVerification({ email, purpose, code, expires, binding = "" }) {
  return crypto.createHmac("sha256", verificationKey())
    .update(`${email}.${purpose}.${code}.${expires}.${binding}`)
    .digest("hex");
}

export function issueVerification(email, purpose, binding = "") {
  const code = String(crypto.randomInt(100000, 1000000));
  const expires = Date.now() + CODE_TTL_MS;
  const signature = signVerification({ email, purpose, code, expires, binding });
  return { code, expires, token: `${purpose}.${expires}.${signature}` };
}

export function checkVerification({ email, purpose, code, token, binding = "" }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== purpose) return { ok: false, error: "Invalid verification token" };
  const expires = Number(parts[1]);
  if (!expires || Date.now() > expires) return { ok: false, error: "That code has expired. Request a new one." };
  const expected = signVerification({ email, purpose, code: String(code || "").trim(), expires, binding });
  if (!safeEqualHex(expected, parts[2])) return { ok: false, error: "That code isn't right. Check the email and try again." };
  return { ok: true };
}

/* ---------------- Rate limiting ---------------- */
// Backed by the hit_rate_limit() Postgres function so limits hold across
// serverless instances. Falls back to per-instance memory if the database or
// the function is unavailable (e.g. migration not applied yet).
const memHits = new Map();

function memoryAllow(key, limit, windowSec) {
  const now = Date.now();
  const entry = memHits.get(key);
  if (!entry || now - entry.start > windowSec * 1000) {
    memHits.set(key, { count: 1, start: now });
    if (memHits.size > 5000) for (const [k, v] of memHits) if (now - v.start > windowSec * 1000) memHits.delete(k);
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

// Returns true when the request is allowed.
export async function rateLimit(db, key, limit, windowSec) {
  if (db) {
    try {
      const { data, error } = await db.rpc("hit_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSec });
      if (!error && typeof data === "boolean") return data;
      if (error) console.error("[UXNest rateLimit]", error.message);
    } catch (e) {
      console.error("[UXNest rateLimit]", e && e.message);
    }
  }
  return memoryAllow(key, limit, windowSec);
}

export function clientIp(req) {
  const h = req.headers || {};
  const ip = h["x-vercel-forwarded-for"] || h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || req.socket?.remoteAddress || "unknown";
  return String(ip).trim().slice(0, 64);
}

/* ---------------- Misc ---------------- */
export function cleanEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 254);
}

export function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    company: row.company || "",
    plan: row.plan || "free",
    auditsUsed: row.audits_used || 0,
    paidAudits: row.paid_audits || 0,
    emailVerified: !!row.email_verified,
  };
}

export function requireDb(res) {
  const db = getDb();
  if (!db) {
    res.status(500).json({ error: "Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set" });
    return null;
  }
  return db;
}

// Constant-time string comparison that does not leak length.
export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
