// Email verification via Resend, using stateless HMAC tokens.
//
// Serverless functions have no shared memory, so instead of storing codes we
// issue a signed token: HMAC(email + code + expiry, VERIFY_SECRET). The client
// holds the token, sends it back with the code the user typed, and the server
// recomputes the signature to validate. Nothing is persisted server-side.
//
// Required environment variables:
//   RESEND_API_KEY  - from resend.com
//   VERIFY_SECRET   - any long random string
//   VERIFY_FROM     - verified sender, e.g. "UXNest <noreply@yourdomain.com>"
//                     (during testing Resend allows onboarding@resend.dev)

import crypto from "crypto";

export const maxDuration = 20;

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const sendHits = new Map();

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const entry = sendHits.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  sendHits.set(key, entry);
  return entry.count > max;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.VERIFY_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfigured: VERIFY_SECRET is not set" });
    return;
  }

  const { action, email, code, token } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  // ---------- Send a code ----------
  if (action === "send") {
    if (!process.env.RESEND_API_KEY) {
      res.status(500).json({ error: "Server misconfigured: RESEND_API_KEY is not set" });
      return;
    }
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (rateLimited(`ip:${ip}`, 10, 60 * 60 * 1000) || rateLimited(`em:${cleanEmail}`, 5, 60 * 60 * 1000)) {
      res.status(429).json({ error: "Too many verification requests. Please try again later." });
      return;
    }

    const generated = String(crypto.randomInt(100000, 1000000)); // 6 digits
    const expires = Date.now() + CODE_TTL_MS;
    const issued = `${cleanEmail}.${generated}.${expires}`;
    const signature = sign(issued, secret);

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.VERIFY_FROM || "UXNest <onboarding@resend.dev>",
          to: [cleanEmail],
          subject: `${generated} is your UXNest verification code`,
          text: `Your UXNest verification code is ${generated}.\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#12302B">
            <h2 style="margin:0 0 8px;font-size:20px">Verify your email</h2>
            <p style="color:#3E5A54;font-size:14px;line-height:1.6;margin:0 0 20px">Enter this code in UXNest to finish creating your account.</p>
            <div style="font-size:32px;font-weight:800;letter-spacing:6px;background:#DFF3EC;color:#0C7D62;padding:16px;text-align:center;border-radius:12px">${generated}</div>
            <p style="color:#6E8681;font-size:12px;margin:20px 0 0">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
          </div>`,
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        res.status(502).json({ error: `Couldn't send the verification email. ${detail.slice(0, 200)}` });
        return;
      }
    } catch (e) {
      res.status(502).json({ error: "Couldn't reach the email service. Please try again." });
      return;
    }

    // The code itself is never returned — only the signed envelope.
    res.status(200).json({ token: `${expires}.${signature}`, expires });
    return;
  }

  // ---------- Check a code ----------
  if (action === "verify") {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) {
      res.status(400).json({ error: "Invalid verification token" });
      return;
    }
    const [expiresStr, signature] = parts;
    const expires = Number(expiresStr);
    if (!expires || Date.now() > expires) {
      res.status(400).json({ error: "That code has expired. Request a new one." });
      return;
    }
    const expected = sign(`${cleanEmail}.${String(code || "").trim()}.${expires}`, secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      res.status(400).json({ error: "That code isn't right. Check the email and try again." });
      return;
    }
    res.status(200).json({ verified: true });
    return;
  }

  res.status(400).json({ error: "Unknown action" });
}
