// Support requests: emails the site owner when the chat agent can't resolve
// something. Uses the same Resend setup as email verification.

import crypto from "crypto";

export const maxDuration = 20;

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  hits.set(key, entry);
  return entry.count > MAX_PER_WINDOW;
}

function esc(v) {
  return String(v || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "Server misconfigured: RESEND_API_KEY is not set" });
    return;
  }

  const to = process.env.SUPPORT_EMAIL;
  if (!to) {
    res.status(500).json({ error: "Server misconfigured: SUPPORT_EMAIL is not set" });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many support requests. Please try again later." });
    return;
  }

  const { email, message, transcript, page, userAgent } = req.body || {};
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: "A valid email address is required so we can reply." });
    return;
  }
  if (!message || String(message).trim().length < 5) {
    res.status(400).json({ error: "Please describe the problem." });
    return;
  }

  const ref = crypto.randomBytes(3).toString("hex").toUpperCase();
  const lines = Array.isArray(transcript) ? transcript.slice(-20) : [];
  const transcriptHtml = lines.length
    ? lines.map((m) => `<div style="margin-bottom:6px"><strong>${m.role === "user" ? "User" : "Agent"}:</strong> ${esc(m.content).slice(0, 800)}</div>`).join("")
    : "<em>No chat history</em>";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.VERIFY_FROM || "UXNest <onboarding@resend.dev>",
        to: [to],
        reply_to: cleanEmail,
        subject: `[Support ${ref}] ${String(message).trim().slice(0, 60)}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:640px;color:#12302B">
          <h2 style="margin:0 0 4px;font-size:18px">Support request ${ref}</h2>
          <p style="color:#6E8681;font-size:12px;margin:0 0 16px">Reply directly to this email to respond to the user.</p>
          <table style="font-size:13px;border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:4px 12px 4px 0;color:#6E8681">From</td><td>${esc(cleanEmail)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6E8681">Page</td><td>${esc(page)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6E8681">Browser</td><td style="font-size:11px;color:#6E8681">${esc(userAgent).slice(0, 160)}</td></tr>
          </table>
          <div style="background:#DFF3EC;border-radius:10px;padding:14px;margin-bottom:16px">
            <div style="font-weight:700;font-size:12px;color:#0C7D62;margin-bottom:6px">MESSAGE</div>
            <div style="font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(message)}</div>
          </div>
          <div style="border:1px solid #D5E0DC;border-radius:10px;padding:14px">
            <div style="font-weight:700;font-size:12px;color:#6E8681;margin-bottom:8px">CHAT HISTORY</div>
            <div style="font-size:12.5px;line-height:1.5;color:#3E5A54">${transcriptHtml}</div>
          </div>
        </div>`,
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: `Couldn't send the support request. ${detail.slice(0, 160)}` });
      return;
    }
  } catch {
    res.status(502).json({ error: "Couldn't reach the email service. Please try again." });
    return;
  }

  res.status(200).json({ sent: true, ref });
}
