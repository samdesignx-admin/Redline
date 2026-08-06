// Vercel serverless function: proxies audit requests to the Anthropic API.
// The API key lives in the ANTHROPIC_API_KEY environment variable — never in
// frontend code. Includes a simple in-memory per-IP rate limit as a first
// line of defense (note: in-memory state resets per serverless instance, so
// for real protection add Upstash Redis or similar before going public).

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 60; // ~4-5 full audits per IP per hour
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

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    // Pass through status + retry-after so the frontend's backoff logic works
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.setHeader("retry-after", retryAfter);
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed" });
  }
}
