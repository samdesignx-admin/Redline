// Shared server-side helpers. Never imported by browser code — this module
// uses the Supabase service role key, which bypasses row level security.

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/* ---------------- Passwords ---------------- */
// scrypt with a per-user random salt. Stored as "salt:hash".
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- Sessions ---------------- */
// Stateless signed tokens: accountId.expiry.signature
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.VERIFY_SECRET;
}

export function issueSession(accountId) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expires = Date.now() + SESSION_TTL_MS;
  const sig = crypto.createHmac("sha256", secret).update(`${accountId}.${expires}`).digest("hex");
  return `${accountId}.${expires}.${sig}`;
}

export function readSession(token) {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [accountId, expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${accountId}.${expires}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { accountId };
}

/* ---------------- Misc ---------------- */
export function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
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
