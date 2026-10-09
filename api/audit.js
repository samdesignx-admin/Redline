// Vercel serverless function: proxies requests to the Anthropic API.
//
// IMPORTANT: model calls routinely take 20-60s. Vercel's default function
// timeout is 10s, which kills the request mid-flight and surfaces to the
// browser as a network failure. maxDuration raises this (60s is the Hobby
// timeout ceiling on Vercel's free tier).
// The API key lives in the ANTHROPIC_API_KEY environment variable — never in
// frontend code.
//
// This endpoint spends real money, so it is locked down:
//   * the model is fixed server-side (clients cannot pick a pricier one)
//   * only one tool is allowed, with a bounded number of uses
//   * three kinds of caller, each with its own rules:
//       purpose "preview"  landing-page preview: no account, tiny, tight IP limit
//       purpose "support"  support chat: no account, tiny, IP limit
//       purpose "audit"    full audit (the default): needs a signed-in account
//                          that still has an audit available, plus per-account limits
//   * limits live in the database, so they hold across serverless instances

import crypto from "crypto";
import { requireDb, authenticate, rateLimit, clientIp } from "./_lib.js";

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const AUDIT_QUOTA = 1;

const PROFILES = {
  preview: { maxTokens: 700, maxBytes: 30_000, maxMessages: 2, tools: true, ipPerHour: 10 },
  support: { maxTokens: 900, maxBytes: 60_000, maxMessages: 2, tools: false, ipPerHour: 40 },
  audit: { maxTokens: 4096, maxBytes: 4_400_000, maxMessages: 40, tools: true, ipPerHour: 120, acctPerHour: 120, acctPerDay: 300 },
};

// The only tool the product uses is web search; never forward client-defined
// tool definitions (server tools are billed per use).
function safeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const allowed = tools.some((t) => t && t.type === "web_search_20250305" && t.name === "web_search");
  return allowed ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] : undefined;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Server misconfigured: ANTHROPIC_API_KEY is not set" });
    return;
  }

  const input = req.body || {};
  const purpose = input.purpose === "preview" || input.purpose === "support" ? input.purpose : "audit";
  const profile = PROFILES[purpose];

  const { max_tokens, messages, tools } = input;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > profile.maxMessages) {
    res.status(400).json({ error: "Bad request: invalid messages" });
    return;
  }
  let size = 0;
  try { size = JSON.stringify(messages).length; } catch { size = Infinity; }
  if (size > profile.maxBytes) {
    res.status(413).json({ error: "Request is too large." });
    return;
  }

  const db = requireDb(res);
  if (!db) return;
  const ip = clientIp(req);

  if (!(await rateLimit(db, `ai:${purpose}:ip:${ip}`, profile.ipPerHour, 3600))) {
    res.status(429).json({
      error: purpose === "preview"
        ? "You've used the free previews for now. Sign up for full audits, or try again later."
        : "Rate limit exceeded. Try again later.",
    });
    return;
  }

  if (purpose === "audit") {
    const sess = await authenticate(db, input.token);
    if (!sess) {
      res.status(401).json({ error: "Please log in again." });
      return;
    }
    if (!(await rateLimit(db, `ai:audit:acct:h:${sess.accountId}`, profile.acctPerHour, 3600)) ||
        !(await rateLimit(db, `ai:audit:acct:d:${sess.accountId}`, profile.acctPerDay, 86400))) {
      res.status(429).json({ error: "You've reached the audit limit for now. Please try again later." });
      return;
    }
    const { data: acct } = await db.from("accounts").select("audits_used, paid_audits").eq("id", sess.accountId).maybeSingle();
    if (!acct || ((acct.audits_used || 0) >= AUDIT_QUOTA && (acct.paid_audits || 0) <= 0)) {
      res.status(402).json({ error: "Your free audit has been used. Purchase another audit for $5.", code: "AUDIT_PAYMENT_REQUIRED" });
      return;
    }
  }

  // Allowlist of fields forwarded to the API — prevents clients from
  // injecting arbitrary parameters through the proxy.
  const body = {
    model: MODEL,
    max_tokens: Math.min(Number(max_tokens) || 1000, profile.maxTokens),
    messages,
  };
  const allowedTools = profile.tools ? safeTools(tools) : undefined;
  if (allowedTools) body.tools = allowedTools;

  // Keep a safety margin below Vercel's 60s function ceiling. Without an
  // explicit timeout, Vercel can terminate the function at the platform
  // boundary and the browser only sees a generic network/fetch failure.
  const REQUEST_TIMEOUT_MS = 45_000;
  // The request id is echoed in a response header, so only accept a safe shape.
  const suppliedId = String(req.headers["x-uxnest-request-id"] || "");
  const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  const stage = String(req.headers["x-uxnest-stage"] || "audit").replace(/[^\w.-]/g, "").slice(0, 80) || "audit";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  res.setHeader("cache-control", "no-store");
  res.setHeader("x-uxnest-request-id", requestId);

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.setHeader("retry-after", retryAfter);

    let data;
    try {
      data = await upstream.json();
    } catch {
      data = { error: "The audit provider returned an unreadable response" };
    }

    if (!upstream.ok) {
      console.error(JSON.stringify({
        event: "audit_upstream_error",
        requestId,
        stage,
        purpose,
        status: upstream.status,
        durationMs: Date.now() - startedAt,
      }));
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    console.error(JSON.stringify({
      event: timedOut ? "audit_upstream_timeout" : "audit_upstream_network_error",
      requestId,
      stage,
      purpose,
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    }));

    if (timedOut) {
      res.status(504).json({
        error: "This audit step timed out before the AI service responded.",
        code: "UPSTREAM_TIMEOUT",
        retryable: true,
        requestId,
      });
      return;
    }

    res.status(502).json({
      error: "Couldn't reach the AI service for this audit step.",
      code: "UPSTREAM_NETWORK_ERROR",
      retryable: true,
      requestId,
    });
  } finally {
    clearTimeout(timer);
  }
}
