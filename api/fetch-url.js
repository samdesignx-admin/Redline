import { assertPublicUrl, safeFetchText } from "./_net.js";
import { requireDb, authenticate, rateLimit, clientIp } from "./_lib.js";

export const maxDuration = 120;

const MAX_HTML_BYTES = 1_500_000;
const DIRECT_TIMEOUT_MS = 8_000;
const RENDER_TIMEOUT_MS = 18_000;
const READER_TIMEOUT_MS = 10_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
const UNBLOCK_TIMEOUT_MS = 28_000;
const BLOCKED_PATTERNS = /(access denied|you don't have permission|forbidden|request blocked|bot detection|unusual traffic|security check|temporarily blocked|reference #\d+.*errors?\.|errors?\.edgesuite\.net|akamai reference|error reference number)/i;

// Per-account limits for this (paid-provider-backed) endpoint.
const FETCH_PER_ACCOUNT_HOUR = 20;
const FETCH_PER_ACCOUNT_DAY = 60;
const FETCH_PER_IP_HOUR = 40;
// Total time allowed for the screenshot-provider cascade of one page.
const VISUAL_BUDGET_MS = 45_000;
const EXTRA_PAGE_VISUAL_BUDGET_MS = 25_000;
const AUDIT_QUOTA = 1;

function cleanText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function matchAll(html, regex, limit) {
  const out = [];
  for (const match of html.matchAll(regex)) {
    const value = cleanText(match[1]);
    if (value) out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function extractLinks(html, baseUrl) {
  const out = [], seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], baseUrl); url.hash = "";
      if (url.origin !== new URL(baseUrl).origin || !/^https?:$/.test(url.protocol)) continue;
      if (!seen.has(url.toString())) { seen.add(url.toString()); out.push({ url: url.toString(), label: cleanText(match[2]) }); }
    } catch {}
  }
  return out;
}

function extractPage(html, url, rendered = false) {
  const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = cleanText((html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1]);
  const headings = matchAll(html, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi, 20);
  const buttons = [...new Set(matchAll(html, /<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 30))];
  const canonical = ((html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const robots = ((html.match(/<meta\b[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const ogTitle = ((html.match(/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const ogDescription = ((html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const ogImage = ((html.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const lang = ((html.match(/<html\b[^>]*lang\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const viewport = ((html.match(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "").trim();
  const h1s = matchAll(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 10);
  const structuredDataTypes = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { const json = JSON.parse(m[1]); const nodes = Array.isArray(json) ? json : [json]; return nodes.flatMap((node) => Array.isArray(node?.["@graph"]) ? node["@graph"] : [node]).map((node) => node?.["@type"]).flat().filter(Boolean); } catch { return []; } })
    .flat().map(String);
  const imageTags = [...html.matchAll(/<img\b([^>]*)>/gi)].slice(0, 200);
  const imagesMissingAlt = imageTags.filter((m) => !/\balt\s*=\s*["'][^"']*["']/i.test(m[1])).length;
  const text = cleanText(html).slice(0, 10000);
  return {
    url, title, description, headings, buttons, text, links: extractLinks(html, url), rendered,
    seo: {
      titleLength: title.length,
      descriptionLength: description.length,
      canonical,
      robots,
      ogTitle,
      ogDescription,
      ogImage: !!ogImage,
      lang,
      viewport: !!viewport,
      h1Count: h1s.length,
      h1s,
      structuredDataTypes: [...new Set(structuredDataTypes)].slice(0, 20),
      imageCount: imageTags.length,
      imagesMissingAlt,
    },
  };
}
function meaningful(page) {
  if (!page) return false;
  // A SPA shell can have a perfectly good meta description while exposing
  // almost no rendered page content to the audit crawler. Do not treat SEO
  // metadata alone as sufficient evidence. Require substantive visible text,
  // multiple headings/CTAs, or at least one H1 plus supporting body text.
  return (
    page.text.length >= 250 ||
    page.headings.length >= 2 ||
    page.buttons.length >= 3 ||
    (page.seo?.h1Count >= 1 && page.text.length >= 80)
  );
}

function accessBlocked(page) {
  const sample = [page?.title, page?.description, ...(page?.headings || []), page?.text].filter(Boolean).join(" ").slice(0, 5000);
  return BLOCKED_PATTERNS.test(sample);
}

function isAccessBlockError(message) {
  return /http (401|403|429|451)\b|access denied|forbidden|permission|request blocked|bot|security check|edgesuite|akamai/i.test(String(message || ""));
}

// Every connection (including each redirect hop) is validated at connect time
// by safeFetchText, so redirects to internal addresses and DNS rebinding are
// both refused.
async function directFetch(target) {
  const start = (await assertPublicUrl(target)).toString();
  const response = await safeFetchText(start, {
    maxRedirects: 5,
    timeoutMs: DIRECT_TIMEOUT_MS,
    maxBytes: MAX_HTML_BYTES,
    headers: { "user-agent": "UXNest-AuditBot/1.0 (+https://uxnest.ai)", accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`Direct retrieval returned HTTP ${response.status}.`);
  const type = String(response.headers["content-type"] || "");
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("The URL did not return an HTML page.");
  return extractPage(response.body.slice(0, MAX_HTML_BYTES), response.url, false);
}

async function readerFetch(target) {
  const url = (await assertPublicUrl(target)).toString();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), READER_TIMEOUT_MS);
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers: { accept: "text/plain", "x-engine": "browser", "x-no-cache": "true" } });
    if (!response.ok) throw new Error(`Reader fallback returned HTTP ${response.status}.`);
    const markdown = (await response.text()).slice(0, MAX_HTML_BYTES);
    const text = cleanText(markdown).slice(0, 10000);
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const page = { url, title: heading, description: "", headings: heading ? [heading] : [], buttons: [], text, links: [], rendered: true, reader: true };
    if (!meaningful(page)) throw new Error("Reader fallback returned too little readable public content.");
    if (accessBlocked(page)) throw new Error("Reader fallback returned an access-control page.");
    return page;
  } finally { clearTimeout(timer); }
}

function dataImage(bytes, type = "image/jpeg") {
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function captureScreenshot(target) {
  const token = process.env.BROWSERLESS_TOKEN; if (!token) throw new Error("Browserless is not configured.");
  const url = (await assertPublicUrl(target)).toString();
  const shot = new URL(process.env.BROWSERLESS_BASE_URL || "https://production-sfo.browserless.io/content");
  shot.pathname = shot.pathname.replace(/\/content$/, "/screenshot");
  shot.searchParams.set("token", token);
  shot.searchParams.set("stealth", "true");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    // Use a stable viewport capture for visual evidence and pin mapping.
    // Full-page stitching can produce distorted/lazy-loaded strips on long pages,
    // and the report's pin coordinates are meaningful only against a stable viewport.
    const response = await fetch(shot, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify({
        url,
        waitForTimeout: 4000,
        bestAttempt: true,
        scrollPage: false,
        gotoOptions: { waitUntil: "networkidle2", timeout: 20000 },
        options: { fullPage: false, captureBeyondViewport: false, type: "png", waitForImages: true },
      }),
    });
    if (!response.ok) throw new Error(`Browserless screenshot returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 5_500_000) throw new Error("Browserless screenshot was empty or too large.");
    return dataImage(bytes, "image/png");
  } finally { clearTimeout(timer); }
}

async function captureBrowserQL(target) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("Browserless is not configured.");
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://production-sfo.browserless.io/stealth/bql");
  endpoint.searchParams.set("token", token);
  endpoint.searchParams.set("emulationOs", "windows");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  const query = `mutation UXNestProtectedAudit {
    goto(url: "${url.replace(/\\/g, "\\\\").replace(/"/g, '\\\"')}", waitUntil: networkIdle, timeout: 20000) {
      status
    }
    solve(wait: true, timeout: 12000) {
      found
      solved
      time
    }
    waitForTimeout(time: 1500) {
      time
    }
    screenshot(type: png, fullPage: false, waitForImages: true, timeout: 10000) {
      base64
    }
  }`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify({ query, variables: {}, operationName: "UXNestProtectedAudit" }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Browserless BrowserQL returned HTTP ${response.status}.`);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error("Browserless BrowserQL returned invalid JSON."); }
    // BrowserQL can return HTTP 200 with per-step GraphQL errors while later
    // top-level fields still succeed. Prefer valid screenshot evidence over a
    // failure reported by an earlier navigation/solve/wait step.
    const data = payload?.data || {};
    const b64 = typeof data?.screenshot?.base64 === "string" ? data.screenshot.base64.replace(/^data:image\/[^;]+;base64,/i, "") : "";
    if (b64) {
      const bytes = Buffer.from(b64, "base64");
      if (!bytes.length || bytes.length > 5_500_000) throw new Error("Browserless BrowserQL screenshot was empty or too large.");
      return `data:image/png;base64,${b64}`;
    }
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      const first = payload.errors[0] || {};
      const message = String(first?.message || "query failed").slice(0, 240);
      const path = Array.isArray(first?.path) ? ` [${first.path.join(".")}]` : "";
      throw new Error("Browserless BrowserQL error" + path + ": " + message);
    }
    throw new Error("Browserless BrowserQL returned no screenshot.");
  } finally {
    clearTimeout(timer);
  }
}

async function captureSmartScrape(target) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("Browserless is not configured.");
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://production-sfo.browserless.io/smart-scrape");
  endpoint.searchParams.set("token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify({ url, formats: ["html", "rawText", "links", "screenshot"], waitFor: 2500 }),
    });
    if (!response.ok) throw new Error(`Browserless Smart Scrape returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload?.ok === false) throw new Error(String(payload?.message || "Browserless Smart Scrape failed."));
    const b64 = typeof payload?.screenshot === "string" ? payload.screenshot.replace(/^data:image\/[^;]+;base64,/i, "") : "";
    let screenshot = null;
    if (b64) {
      const bytes = Buffer.from(b64, "base64");
      if (!bytes.length || bytes.length > 5_500_000) throw new Error("Browserless Smart Scrape screenshot was empty or too large.");
      screenshot = `data:image/png;base64,${b64}`;
    }
    const html = typeof payload?.content === "string" ? payload.content.slice(0, MAX_HTML_BYTES) : "";
    const rawText = typeof payload?.rawText === "string" ? payload.rawText.slice(0, 10000) : "";
    const links = Array.isArray(payload?.links) ? payload.links.slice(0, 30) : [];
    if (!screenshot && !html && !rawText) throw new Error("Browserless Smart Scrape returned no usable page evidence.");
    return { screenshot, html, rawText, links, statusCode: Number(payload?.statusCode) || null, strategy: payload?.strategy || null };
  } finally { clearTimeout(timer); }
}

async function captureScreenshotOne(target) {
  const token = process.env.SCREENSHOTONE_API_KEY; if (!token) throw new Error("ScreenshotOne is not configured.");
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://api.screenshotone.com/take");
  endpoint.searchParams.set("access_key", token); endpoint.searchParams.set("url", url); endpoint.searchParams.set("full_page", "true"); endpoint.searchParams.set("format", "jpg"); endpoint.searchParams.set("image_quality", "70");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { signal: controller.signal }); if (!response.ok) throw new Error(`ScreenshotOne returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length || bytes.length > 4_500_000) throw new Error("ScreenshotOne screenshot was empty or too large.");
    return dataImage(bytes);
  } finally { clearTimeout(timer); }
}

async function capturePageSpeed(target) {
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed"); endpoint.searchParams.set("url", url); endpoint.searchParams.set("strategy", "desktop"); endpoint.searchParams.set("category", "PERFORMANCE"); endpoint.searchParams.set("locale", "en");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: controller.signal }); if (!response.ok) throw new Error(`Google render fallback returned HTTP ${response.status}.`);
    const payload = await response.json(); const lighthouse = payload?.lighthouseResult || {}; const requests = lighthouse?.audits?.["network-requests"]?.details?.items || [];
    const blockedRequest = requests.some((item) => Number(item.statusCode) >= 400 && Number(item.statusCode) < 500 && /text\/html|document/i.test(`${item.mimeType || ""} ${item.resourceType || ""}`));
    if (blockedRequest) throw new Error("Google rendered an access-control response for the main document.");
    const data = lighthouse?.audits?.["final-screenshot"]?.details?.data; if (typeof data !== "string" || !data.startsWith("data:image/")) throw new Error("Google render fallback returned no final-page screenshot.");
    const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64"); if (!bytes.length || bytes.length > 4_500_000) throw new Error("Google final-page screenshot was empty or too large.");
    return data;
  } finally { clearTimeout(timer); }
}

async function captureMicrolink(target) {
  const url = (await assertPublicUrl(target)).toString(); const endpoint = new URL("https://api.microlink.io/");
  endpoint.searchParams.set("url", url); endpoint.searchParams.set("screenshot", "true"); endpoint.searchParams.set("screenshot.fullPage", "true"); endpoint.searchParams.set("screenshot.type", "jpeg"); endpoint.searchParams.set("meta", "true");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const headers = { accept: "application/json" }; if (process.env.MICROLINK_API_KEY) headers["x-api-key"] = process.env.MICROLINK_API_KEY;
    const response = await fetch(endpoint, { headers, signal: controller.signal }); if (!response.ok) throw new Error(`Microlink returned HTTP ${response.status}.`);
    const payload = await response.json(); const meta = payload?.data || {};
    if (Number(meta.statusCode) >= 400 || BLOCKED_PATTERNS.test(`${meta.title || ""} ${meta.description || ""} ${meta.url || ""}`)) throw new Error("Microlink rendered an access-control page.");
    const assetUrl = meta?.screenshot?.url; if (!assetUrl || !/^https:\/\//i.test(assetUrl)) throw new Error("Microlink returned no screenshot asset.");
    await assertPublicUrl(assetUrl);
    const imageResponse = await fetch(assetUrl, { signal: controller.signal }); if (!imageResponse.ok) throw new Error(`Microlink screenshot asset returned HTTP ${imageResponse.status}.`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer()); if (!bytes.length || bytes.length > 4_500_000) throw new Error("Microlink screenshot was empty or too large.");
    const type = /image\/(png|webp|jpeg)/i.test(imageResponse.headers.get("content-type") || "") ? imageResponse.headers.get("content-type").split(";")[0] : "image/jpeg";
    return dataImage(bytes, type);
  } finally { clearTimeout(timer); }
}

async function captureVisualFallback(target, { budgetMs = VISUAL_BUDGET_MS } = {}) {
  const diagnostics = [];
  const providers = [
    ["browserless-browserql-stealth", () => captureBrowserQL(target)],
    ["browserless-smart-scrape", () => captureSmartScrape(target)],
    ["browserless", () => captureScreenshot(target)],
    ["screenshotone", () => captureScreenshotOne(target)],
    ["microlink", () => captureMicrolink(target)],
    ["google-render-fallback", () => capturePageSpeed(target)],
  ];
  // Providers are paid third-party services, so try them one at a time in
  // priority order and stop at the first that returns evidence (the previous
  // version fired all six on every request and paid for every one). The
  // overall time budget keeps the cascade inside the function's time limit:
  // once it is spent, the remaining providers are skipped.
  const deadline = Date.now() + budgetMs;
  for (const [name, provider] of providers) {
    if (Date.now() >= deadline) { diagnostics.push(`${name}: skipped (time budget used)`); continue; }
    try {
      const value = await provider();
      if (!value) continue;
      if (typeof value === "string") return { screenshot: value, page: null, provider: name, diagnostics };
      return {
        screenshot: value.screenshot || null,
        page: value.html ? { html: value.html, rawText: value.rawText || "", links: value.links || [], statusCode: value.statusCode, strategy: value.strategy } : null,
        provider: name,
        diagnostics,
      };
    } catch (reason) {
      diagnostics.push(name + ": " + (reason instanceof Error ? reason.message : "capture failed"));
    }
  }
  return { screenshot: null, page: null, provider: null, diagnostics };
}

async function renderPage(target, wantScreenshot = true) {
  const token = process.env.BROWSERLESS_TOKEN; if (!token) throw new Error("Browser rendering is not configured in this deployment.");
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL(process.env.BROWSERLESS_BASE_URL || "https://production-sfo.browserless.io/content"); endpoint.searchParams.set("token", token);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ url, waitForTimeout: 2500, bestAttempt: true, gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } }) });
    const html = (await response.text()).slice(0, MAX_HTML_BYTES); if (!response.ok) throw new Error(`Browser renderer returned HTTP ${response.status}.`);
    const page = extractPage(html, url, true); const blocked = accessBlocked(page); let screenshot = null;
    if (wantScreenshot) {
      try { screenshot = await captureScreenshot(url); } catch {}
    }
    if (blocked) throw Object.assign(new Error("Browser renderer returned an access-control page."), { screenshot });
    return { page, screenshot };
  } finally { clearTimeout(timer); }
}

async function unblockFetch(target, wantScreenshot = true) {
  const token = process.env.BROWSERLESS_TOKEN; if (!token) throw new Error("Browserless is not configured.");
  const url = (await assertPublicUrl(target)).toString(); const endpoint = new URL("https://production-sfo.browserless.io/unblock");
  endpoint.searchParams.set("token", token); endpoint.searchParams.set("proxy", process.env.BROWSERLESS_PROXY || "residential"); endpoint.searchParams.set("proxyCountry", process.env.BROWSERLESS_PROXY_COUNTRY || "us"); endpoint.searchParams.set("proxySticky", "true");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), UNBLOCK_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "cache-control": "no-cache" }, body: JSON.stringify({ url, content: true, cookies: false, screenshot: wantScreenshot, browserWSEndpoint: false, ttl: 60000, waitForTimeout: 5000, bestAttempt: true }) });
    const raw = await response.text(); if (!response.ok) throw new Error(`Browserless unblock returned HTTP ${response.status}.`);
    let payload; try { payload = JSON.parse(raw); } catch { throw new Error("Browserless unblock returned invalid JSON."); }
    const html = String(payload?.content || "").slice(0, MAX_HTML_BYTES); if (!html) throw new Error("Browserless unblock returned no page content.");
    const page = extractPage(html, url, true); let screenshot = null;
    if (typeof payload?.screenshot === "string" && payload.screenshot) {
      const b64 = payload.screenshot.replace(/^data:image\/[^;]+;base64,/i, ""); const bytes = Buffer.from(b64, "base64");
      if (bytes.length > 0 && bytes.length <= 4_500_000) screenshot = `data:image/jpeg;base64,${b64}`;
    }
    if (!meaningful(page)) throw Object.assign(new Error("Browserless unblock returned too little page content."), { screenshot });
    if (accessBlocked(page)) throw Object.assign(new Error("Browserless unblock still returned an access-control page."), { screenshot });
    return { page, screenshot };
  } finally { clearTimeout(timer); }
}

async function fetchSeoInfrastructure(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const result = {
    robots: { status: null, exists: false, sitemapUrls: [], content: "" },
    sitemap: { status: null, exists: false, validXml: false, urls: [], location: null },
  };
  // robots.txt can name any Sitemap URL, so these requests are as untrusted as
  // the page itself and go through the same connect-time guard.
  async function fetchResource(url, accept) {
    const response = await safeFetchText(url, {
      maxRedirects: 3,
      timeoutMs: 8000,
      maxBytes: 500_000,
      headers: { "user-agent": "UXNest-AuditBot/1.0 (+https://uxnest.ai)", accept },
    });
    return { status: response.status, ok: response.ok, text: response.body };
  }
  try {
    const response = await fetchResource(new URL("/robots.txt", origin).toString(), "text/plain,*/*;q=0.8");
    result.robots.status = response.status;
    result.robots.exists = response.ok;
    result.robots.content = response.ok ? response.text : "";
    if (response.ok) {
      result.robots.sitemapUrls = [...response.text.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)]
        .map((m) => m[1].trim()).filter(Boolean).slice(0, 5);
    }
  } catch {}
  const candidates = [...result.robots.sitemapUrls, new URL("/sitemap.xml", origin).toString()]
    .filter((url, i, arr) => arr.indexOf(url) === i).slice(0, 5);
  for (const sitemapUrl of candidates) {
    try {
      const response = await fetchResource(sitemapUrl, "application/xml,text/xml,text/plain,*/*;q=0.8");
      if (!response.ok || !/<\?xml|<urlset\b|<sitemapindex\b/i.test(response.text)) continue;
      result.sitemap = {
        status: response.status,
        exists: true,
        validXml: /<urlset\b|<sitemapindex\b/i.test(response.text),
        urls: [...response.text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
          .map((m) => m[1].trim()).filter(Boolean).slice(0, 500),
        location: sitemapUrl,
      };
      break;
    } catch {}
  }
  if (result.sitemap.status == null) result.sitemap.status = 404;
  return result;
}

function dossier(pages, infrastructure = null, targetKeywords = []) {
  const pageDossier = pages.map((p, i) => [
    `PAGE ${i + 1}: ${p.url}`,
    p.title && `TITLE: ${p.title}`,
    p.description && `DESCRIPTION: ${p.description}`,
    p.headings.length && `HEADINGS: ${p.headings.join(" | ")}`,
    p.buttons.length && `LINKS/CTAS: ${p.buttons.join(" | ")}`,
    p.seo && [
      `SEO: titleLength=${p.seo.titleLength}; descriptionLength=${p.seo.descriptionLength}; h1Count=${p.seo.h1Count}; canonical=${p.seo.canonical || "missing"}; robots=${p.seo.robots || "not specified"}; lang=${p.seo.lang || "not specified"}; viewport=${p.seo.viewport ? "present" : "missing"}; structuredData=${p.seo.structuredDataTypes.join(", ") || "none"}; og:title=${p.seo.ogTitle ? "present" : "missing"}; og:description=${p.seo.ogDescription ? "present" : "missing"}; og:image=${p.seo.ogImage ? "present" : "missing"}; images=${p.seo.imageCount}; imagesMissingAlt=${p.seo.imagesMissingAlt}`,
      p.seo.h1s.length ? `H1 TEXT: ${p.seo.h1s.join(" | ")}` : "H1 TEXT: none",
    ].join("\n"),
    `CONTENT: ${p.text.slice(0, 3500)}`,
  ].filter(Boolean).join("\n\n")).join("\n\n");
  const infra = infrastructure ? [
    "SITE SEO INFRASTRUCTURE:",
    `robots.txt: ${infrastructure.robots.exists ? `present (HTTP ${infrastructure.robots.status})` : `not found (HTTP ${infrastructure.robots.status || "unknown"})`}`,
    `robots.txt sitemap references: ${infrastructure.robots.sitemapUrls.join(" | ") || "none"}`,
    `sitemap: ${infrastructure.sitemap.exists ? `present at ${infrastructure.sitemap.location} (HTTP ${infrastructure.sitemap.status}); XML=${infrastructure.sitemap.validXml ? "valid-looking" : "not verified"}; URLs sampled=${infrastructure.sitemap.urls.length}` : "not found"}`,
    targetKeywords.length ? `TARGET KEYWORDS: ${targetKeywords.join(" | ")}` : "TARGET KEYWORDS: not provided; do not make keyword-specific ranking claims.",
  ].join("\n") : "";
  return [pageDossier, infra].filter(Boolean).join("\n\n");
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rawUrl = String(req.body?.url || "").trim(); if (!rawUrl) return res.status(400).json({ error: "A URL is required." });
  if (rawUrl.length > 2048) return res.status(400).json({ error: "That URL is too long." });

  // This endpoint fans out to paid third-party services, so it is only for
  // signed-in accounts that still have an audit available, and it is rate
  // limited per account and per IP.
  const db = requireDb(res); if (!db) return;
  const sess = await authenticate(db, req.body?.token);
  if (!sess) return res.status(401).json({ error: "Please log in again." });
  if (!(await rateLimit(db, `fetchurl:ip:${clientIp(req)}`, FETCH_PER_IP_HOUR, 3600))) return res.status(429).json({ error: "Too many requests. Please try again later." });
  if (!(await rateLimit(db, `fetchurl:acct:h:${sess.accountId}`, FETCH_PER_ACCOUNT_HOUR, 3600)) || !(await rateLimit(db, `fetchurl:acct:d:${sess.accountId}`, FETCH_PER_ACCOUNT_DAY, 86400))) {
    return res.status(429).json({ error: "You've reached the hourly limit for website audits. Please try again later." });
  }
  const { data: acct } = await db.from("accounts").select("audits_used, paid_audits").eq("id", sess.accountId).maybeSingle();
  if (!acct || ((acct.audits_used || 0) >= AUDIT_QUOTA && (acct.paid_audits || 0) <= 0)) {
    return res.status(402).json({ error: "Your free audit has been used. Purchase another audit for $5.", code: "AUDIT_PAYMENT_REQUIRED" });
  }
  try {
    const normalized = (await assertPublicUrl(rawUrl)).toString();
    const targetKeywords = String(req.body?.targetKeywords || "")
      .split(",").map((value) => value.trim()).filter(Boolean).slice(0, 8);
    // Acquire page evidence with the cheapest/fastest paths first. The previous
    // visual-first order could spend most of Vercel's 60s function budget on
    // Browserless before ever trying a normal HTTP fetch.
    let homepage = null, screenshot = null, rendering = "direct", directError = null, renderError = null, readerError = null, unblockError = null;
    const visualDiagnostics = [];

    // 1) Normal public HTTP retrieval.
    try {
      homepage = await directFetch(normalized);
      if (accessBlocked(homepage)) {
        directError = "Direct retrieval returned an access-control page.";
        homepage = null;
      }
    } catch (error) {
      directError = error instanceof Error ? error.message : "Direct retrieval failed.";
    }

    // 2) Reader fallback can bypass some crawler/WAF differences without
    // requiring a browser service.
    if (!homepage || !meaningful(homepage)) {
      try {
        homepage = await readerFetch(normalized);
        rendering = "reader-fallback";
      } catch (error) {
        readerError = error instanceof Error ? error.message : "Reader fallback failed.";
      }
    }

    // 3) Only use Browserless when ordinary retrieval is blocked. Its Unblock
    // API can return both rendered HTML and a full-page screenshot in one call,
    // so don't spend another request re-capturing the same page.
    if (!homepage || !meaningful(homepage)) {
      try {
        const unblocked = await unblockFetch(normalized, true);
        homepage = unblocked.page;
        screenshot = unblocked.screenshot;
        rendering = "browserless-unblock";
      } catch (error) {
        unblockError = error instanceof Error ? error.message : "Browserless unblock failed.";
        if (error?.screenshot) screenshot = error.screenshot;
      }
    }

    // 4) If Browserless returned content but no screenshot, or if it was
    // unavailable, try independent visual providers.
    if (!screenshot) {
      const visual = await captureVisualFallback(normalized);
      if (visual.screenshot) {
        screenshot = visual.screenshot;
        rendering = visual.provider || rendering;
      }
      if (!homepage && visual.page?.html) {
        try {
          const renderedPage = extractPage(visual.page.html, normalized, true);
          if (meaningful(renderedPage) && !accessBlocked(renderedPage)) {
            homepage = renderedPage;
            rendering = visual.provider ? `${visual.provider}-html` : "browser-rendered";
          }
        } catch {}
      }
      if (!homepage && visual.page?.rawText && meaningful({ text: visual.page.rawText, headings: [], buttons: [], seo: {} })) {
        homepage = {
          url: normalized,
          title: "",
          description: "",
          headings: [],
          buttons: [],
          text: cleanText(visual.page.rawText).slice(0, 10000),
          links: (visual.page.links || []).map((url) => ({ url, label: "" })),
          rendered: true,
          seo: {
            titleLength: 0, descriptionLength: 0, canonical: "", robots: "", ogTitle: "", ogDescription: "",
            ogImage: false, lang: "", viewport: false, h1Count: 0, h1s: [], structuredDataTypes: [], imageCount: 0, imagesMissingAlt: 0,
          },
        };
        rendering = visual.provider ? `${visual.provider}-text` : "browser-rendered";
      }
      visualDiagnostics.push(...visual.diagnostics);
    }

    // 5) Browser-rendered HTML is a final content fallback when available.
    if (!homepage || !meaningful(homepage)) {
      try {
        const rendered = await renderPage(normalized, true);
        homepage = rendered.page;
        screenshot = rendered.screenshot || screenshot;
        rendering = "browser-rendered";
      } catch (error) {
        renderError = error instanceof Error ? error.message : "Browser rendering failed.";
        if (error?.screenshot && !screenshot) screenshot = error.screenshot;
      }
    }

    // SEO infrastructure is supplementary and must never block a valid audit.
    // Start SEO infrastructure in parallel, but do not make a visual-only
    // audit wait for robots/sitemap requests to finish.
    const seoPromise = fetchSeoInfrastructure(normalized).catch(() => null);

    // If the screenshot exists, it is usable visual evidence even when HTML is blocked.
    if (screenshot && (!homepage || !meaningful(homepage) || accessBlocked(homepage))) {
      const attempts = [directError && `Direct retrieval: ${directError}`, renderError && `Browser fallback: ${renderError}`, unblockError && `Browserless unblock: ${unblockError}`, readerError && `Reader fallback: ${readerError}`].filter(Boolean).join(" ");
      return res.status(200).json({
        code: "AUDIT_VISUAL_EVIDENCE",
        evidenceStatus: "VISUAL_ONLY",
        rendering,
        reason: "UXNest captured a rendered screenshot of the public page. Text retrieval was blocked or unavailable, so the screenshot is the primary audit artifact.",
        pages: [normalized],
        dossier: "",
        screenshot,
        screenshots: [{ url: normalized, screenshot }],
        diagnostics: [attempts, ...visualDiagnostics].filter(Boolean).join(" "),
      });
    }

    if (!homepage || !meaningful(homepage) || accessBlocked(homepage)) {
      const attempts = [directError && `Direct retrieval: ${directError}`, renderError && `Browser fallback: ${renderError}`, unblockError && `Browserless unblock: ${unblockError}`, readerError && `Reader fallback: ${readerError}`].filter(Boolean).join(" ");
      const diagnostics = [attempts, ...visualDiagnostics].filter(Boolean).join(" ");
      console.error("[UXNest] audit blocked", { url: normalized, diagnostics });
      return res.status(422).json({ code: "AUDIT_ENVIRONMENT_BLOCKED", evidenceStatus: "BLOCKED", reason: "The website could not be retrieved and no trustworthy rendered screenshot was captured.", pages: [], diagnostics });
    }

    const pages = [homepage];
    for (const link of homepage.links.filter((l) => l.label && !/^(privacy|terms|cookies?|login|sign in)$/i.test(l.label)).slice(0, 2)) {
      try { const page = await directFetch(link.url); if (meaningful(page) && !accessBlocked(page) && !pages.some((p) => p.url === page.url)) pages.push(page); } catch {}
    }
    const captured = await Promise.all(pages.slice(0, 3).map(async (page, index) => {
      const image = index === 0 && screenshot ? screenshot : await captureVisualFallback(page.url, { budgetMs: EXTRA_PAGE_VISUAL_BUDGET_MS }).then((v) => v.screenshot).catch(() => null);
      return image ? { url: page.url, screenshot: image } : null;
    }));
    const screenshots = captured.filter(Boolean); const primaryScreenshot = screenshots[0]?.screenshot || screenshot || null;
    const seoInfrastructure = await Promise.race([
      seoPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return res.status(200).json({ evidenceStatus: "SUFFICIENT", rendering, pages: pages.map((p) => p.url), dossier: dossier(pages, seoInfrastructure, targetKeywords), screenshot: primaryScreenshot, screenshots, seoInfrastructure });
  } catch (error) {
    return res.status(422).json({ code: "AUDIT_INSUFFICIENT_EVIDENCE", evidenceStatus: "INSUFFICIENT", reason: error instanceof Error ? error.message : "UXNest could not retrieve the website.", pages: [] });
  }
}