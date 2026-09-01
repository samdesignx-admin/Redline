// Vercel serverless function: proxies audit requests to the Anthropic API.
//
// IMPORTANT: model calls routinely take 20-60s. Vercel's default function
// timeout is 10s, which kills the request mid-flight and surfaces to the
// browser as a network failure. maxDuration raises this (60s is the Hobby
// timeout ceiling on Vercel's free tier).
// The API key lives in the ANTHROPIC_API_KEY environment variable — never in
// frontend code. Includes a simple in-memory per-IP rate limit as a first
// line of defense (note: in-memory state resets per serverless instance, so
// for real protection add Upstash Redis or similar before going public).

export const maxDuration = 60;

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 60; // ~4-5 full audits per IP per hour
// The landing-page preview is unauthenticated, so it gets a tighter cap of
// its own: single short call, low token ceiling, few per hour per IP.
const MAX_PREVIEWS_PER_WINDOW = 30; // covers landing previews and support chat turns
const previewHits = new Map();
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  hits.set(ip, entry);
  return entry.count > MAX_REQUESTS_PER_WINDOW;
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

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    return;
  }

  // Preview and support-chat calls are small and unauthenticated. Identify
  // them by their low token ceiling and rate limit them separately.
  const isPreview = Number((req.body || {}).max_tokens) <= 700;
  if (isPreview) {
    const now = Date.now();
    const entry = previewHits.get(ip) || { count: 0, start: now };
    if (now - entry.start > WINDOW_MS) { entry.count = 0; entry.start = now; }
    entry.count++;
    previewHits.set(ip, entry);
    if (entry.count > MAX_PREVIEWS_PER_WINDOW) {
      res.status(429).json({ error: "You've used the free previews for now. Sign up for full audits, or try again later." });
      return;
    }
  }

  // Allowlist of fields forwarded to the API — prevents clients from
  // injecting arbitrary parameters through the proxy.
  const { model, max_tokens, messages, tools } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Bad request: messages required" });
    return;
  }
  const body = {
    model: typeof model === "string" ? model : "claude-sonnet-4-6",
    max_tokens: Math.min(Number(max_tokens) || 1000, 4096),
    messages,
  };
  if (Array.isArray(tools)) body.tools = tools;

  // Keep a safety margin below Vercel's 60s function ceiling. Without an
  // explicit timeout, Vercel can terminate the function at the platform
  // boundary and the browser only sees a generic network/fetch failure.
  const REQUEST_TIMEOUT_MS = 50_000;
  const requestId = req.headers["x-uxnest-request-id"] || crypto.randomUUID();
  const stage = String(req.headers["x-uxnest-stage"] || "audit").slice(0, 80);
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
