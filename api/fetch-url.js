import { lookup } from "node:dns/promises";
import net from "node:net";

export const maxDuration = 60;

const MAX_HTML_BYTES = 1_500_000;
const DIRECT_TIMEOUT_MS = 10_000;
const RENDER_TIMEOUT_MS = 25_000;
const READER_TIMEOUT_MS = 20_000;

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = String(address).toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public http and https URLs are supported.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Local addresses are not supported.");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private network addresses are not supported.");
    return url;
  }
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("This address does not resolve to a public website.");
  }
  return url;
}

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
    const text = cleanText(match[1]);
    if (text) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function extractLinks(html, baseUrl) {
  const out = [], seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      url.hash = "";
      if (url.origin !== new URL(baseUrl).origin || !/^https?:$/.test(url.protocol)) continue;
      if (!seen.has(url.toString())) {
        seen.add(url.toString());
        out.push({ url: url.toString(), label: cleanText(match[2]) });
      }
    } catch {}
  }
  return out;
}

function extractPage(html, url, rendered = false) {
  const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const meta = cleanText((html.match(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1]);
  const headings = matchAll(html, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi, 20);
  const buttons = [...new Set(matchAll(html, /<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 30))];
  const text = cleanText(html).slice(0, 10000);
  return { url, title, description: meta, headings, buttons, text, links: extractLinks(html, url), rendered };
}

function meaningful(page) {
  return page.text.length >= 250 || page.headings.length >= 2 || page.description.length >= 40 || page.buttons.length >= 3;
}


function accessBlocked(page) {
  const sample = [
    page?.title,
    page?.description,
    ...(Array.isArray(page?.headings) ? page.headings : []),
    page?.text,
  ].filter(Boolean).join(" ").toLowerCase().slice(0, 4000);

  return /(access denied|you don't have permission|forbidden|request blocked|bot detection|unusual traffic|security check|temporarily blocked|reference #\d+.*errors?\.|errors?\.edgesuite\.net)/i.test(sample);
}

function isAccessBlockError(message) {
  return /http (401|403|429|451)\b|access denied|forbidden|permission|request blocked|bot|security check|edgesuite/i.test(String(message || ""));
}

async function directFetch(target) {
  let current = (await assertPublicUrl(target)).toString();
  for (let i = 0; i < 5; i++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual", signal: controller.signal,
        headers: { "user-agent": "UXNest-AuditBot/1.0 (+https://uxnest.ai)", accept: "text/html,application/xhtml+xml" },
      });
    } finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website redirected without a destination.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Direct retrieval returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("The URL did not return an HTML page.");
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return extractPage(html, current, false);
  }
  throw new Error("Too many redirects.");
}

async function readerFetch(target) {
  // Final fallback for JS-heavy or bot-protected public sites. The target has
  // already passed SSRF validation, and the Reader service returns extracted
  // public page content rather than search snippets.
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READER_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        accept: "text/plain",
        "x-engine": "browser",
        "x-no-cache": "true",
      },
    });
    if (!response.ok) throw new Error(`Reader fallback returned HTTP ${response.status}.`);
    const markdown = (await response.text()).slice(0, MAX_HTML_BYTES);
    const text = cleanText(markdown).slice(0, 10000);
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const page = {
      url,
      title: heading,
      description: "",
      headings: heading ? [heading] : [],
      buttons: [],
      text,
      links: [],
      rendered: true,
      reader: true,
    };
    if (!meaningful(page)) throw new Error("Reader fallback returned too little readable public content.");
    return page;
  } finally {
    clearTimeout(timer);
  }
}

async function renderPage(target, wantScreenshot = false) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new Error("Browser rendering is not configured in this deployment.");
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL(process.env.BROWSERLESS_BASE_URL || "https://production-sfo.browserless.io/content");
  endpoint.searchParams.set("token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, waitForTimeout: 1500, bestAttempt: true }),
    });
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    if (!response.ok) throw new Error(`Browser renderer returned HTTP ${response.status}.`);
    const page = extractPage(html, url, true);
    let screenshot = null;
    if (wantScreenshot && meaningful(page)) {
      const shot = new URL(process.env.BROWSERLESS_BASE_URL || "https://production-sfo.browserless.io/content");
      shot.pathname = shot.pathname.replace(/\/content$/, "/screenshot");
      shot.searchParams.set("token", token);
      const shotResponse = await fetch(shot, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, waitForTimeout: 1000, bestAttempt: true, options: { fullPage: true, type: "jpeg", quality: 65 } }),
      });
      if (shotResponse.ok) {
        const bytes = Buffer.from(await shotResponse.arrayBuffer());
        if (bytes.length <= 3_500_000) screenshot = `data:image/jpeg;base64,${bytes.toString("base64")}`;
      }
    }
    return { page, screenshot };
  } finally { clearTimeout(timer); }
}


async function captureMicrolinkScreenshot(target) {
  // Independent browser network fallback. This is intentionally server-side so
  // the visual capture can be converted to a bounded data URL for the existing
  // Claude vision + PDF pipeline. Microlink accepts unauthenticated test
  // traffic, while production deployments can provide MICROLINK_API_KEY.
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://api.microlink.io/");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("screenshot", "true");
  endpoint.searchParams.set("screenshot.fullPage", "true");
  endpoint.searchParams.set("screenshot.type", "jpeg");
  endpoint.searchParams.set("meta", "false");
  endpoint.searchParams.set("filter", "screenshot");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22_000);
  try {
    const headers = { accept: "application/json" };
    if (process.env.MICROLINK_API_KEY) headers["x-api-key"] = process.env.MICROLINK_API_KEY;
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`Visual browser fallback returned HTTP ${response.status}.`);
    const payload = await response.json();
    const assetUrl = payload?.data?.screenshot?.url;
    if (!assetUrl || !/^https:\/\//i.test(assetUrl)) throw new Error("Visual browser fallback returned no screenshot asset.");
    const imageResponse = await fetch(assetUrl, { signal: controller.signal });
    if (!imageResponse.ok) throw new Error(`Screenshot asset returned HTTP ${imageResponse.status}.`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (!bytes.length || bytes.length > 3_500_000) throw new Error("Visual screenshot was empty or too large.");
    const type = /image\/(png|webp|jpeg)/i.test(imageResponse.headers.get("content-type") || "")
      ? imageResponse.headers.get("content-type").split(";")[0]
      : "image/jpeg";
    return `data:${type};base64,${bytes.toString("base64")}`;
  } finally {
    clearTimeout(timer);
  }
}


async function capturePageSpeedScreenshot(target) {
  // Google renders pages from a different network and exposes a final-page
  // screenshot in Lighthouse artifacts. This gives URL audits one more
  // independent visual route when commercial browser networks hit an Akamai
  // or bot-management interstitial.
  const url = (await assertPublicUrl(target)).toString();
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "desktop");
  endpoint.searchParams.set("category", "PERFORMANCE");
  endpoint.searchParams.set("locale", "en");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google render fallback returned HTTP ${response.status}.`);
    const payload = await response.json();
    const data = payload?.lighthouseResult?.audits?.["final-screenshot"]?.details?.data;
    if (typeof data !== "string" || !data.startsWith("data:image/")) {
      throw new Error("Google render fallback returned no final-page screenshot.");
    }
    const base64 = data.slice(data.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 4_500_000) throw new Error("Google final-page screenshot was empty or too large.");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function captureVisualFallback(target) {
  // Prefer the configured Browserless account. If that environment is blocked
  // or not configured, use an independent real-browser capture network.
  const diagnostics = [];
  try {
    const screenshot = await captureScreenshot(target);
    if (screenshot) return { screenshot, provider: "browserless", diagnostics };
    diagnostics.push("Configured browser screenshot returned no image.");
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : "Configured browser screenshot failed.");
  }
  try {
    const screenshot = await captureMicrolinkScreenshot(target);
    if (screenshot) return { screenshot, provider: "visual-browser-fallback", diagnostics };
    diagnostics.push("Visual browser fallback returned no image.");
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : "Visual browser fallback failed.");
  }
  try {
    const screenshot = await capturePageSpeedScreenshot(target);
    if (screenshot) return { screenshot, provider: "google-render-fallback", diagnostics };
    diagnostics.push("Google render fallback returned no image.");
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : "Google render fallback failed.");
  }
  return { screenshot: null, provider: null, diagnostics };
}

async function captureScreenshot(target) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) return null;
  const url = (await assertPublicUrl(target)).toString();
  const shot = new URL(process.env.BROWSERLESS_BASE_URL || "https://production-sfo.browserless.io/content");
  shot.pathname = shot.pathname.replace(/\/content$/, "/screenshot");
  shot.searchParams.set("token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(shot, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        waitForTimeout: 1000,
        bestAttempt: true,
        options: { fullPage: true, type: "jpeg", quality: 60 },
      }),
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 3_500_000) return null;
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function dossier(pages) {
  return pages.map((p, i) => [
    `PAGE ${i + 1}: ${p.url}`,
    p.title && `TITLE: ${p.title}`,
    p.description && `DESCRIPTION: ${p.description}`,
    p.headings.length && `HEADINGS: ${p.headings.join(" | ")}`,
    p.buttons.length && `LINKS/CTAS: ${p.buttons.join(" | ")}`,
    `CONTENT: ${p.text.slice(0, 3500)}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rawUrl = String(req.body?.url || "").trim();
  if (!rawUrl) return res.status(400).json({ error: "A URL is required." });

  try {
    const normalized = (await assertPublicUrl(rawUrl)).toString();
    let homepage;
    let screenshot = null;
    let rendering = "direct-html";
    let directError = null;

    try { homepage = await directFetch(normalized); }
    catch (error) { directError = error instanceof Error ? error.message : "Direct retrieval failed."; }

    // Critical: a blocked direct fetch (Cloudflare/WAF), sparse SPA shell, or
    // non-meaningful HTML uses browser rendering first, then a reader fallback.
    let renderError = null;
    if (!homepage || !meaningful(homepage) || accessBlocked(homepage)) {
      try {
        const rendered = await renderPage(normalized, true);
        homepage = rendered.page;
        screenshot = rendered.screenshot;
        rendering = "browser-rendered";
      } catch (error) {
        renderError = error instanceof Error ? error.message : "Browser rendering failed.";
      }
    }

    // Some highly dynamic or bot-protected sites still expose an almost-empty
    // DOM to generic renderers. Reader is a last-resort content extractor so a
    // live public URL can still be audited when its readable content is there.
    let readerError = null;
    if (!homepage || !meaningful(homepage) || accessBlocked(homepage)) {
      try {
        homepage = await readerFetch(normalized);
        rendering = "reader-fallback";
      } catch (error) {
        readerError = error instanceof Error ? error.message : "Reader fallback failed.";
      }
    }

    if (!homepage || !meaningful(homepage) || accessBlocked(homepage)) {
      const attempts = [
        directError && `Direct retrieval: ${directError}`,
        renderError && `Browser fallback: ${renderError}`,
        readerError && `Reader fallback: ${readerError}`,
      ].filter(Boolean).join(" ");
      const blocked = [directError, renderError, readerError].some(isAccessBlockError) || accessBlocked(homepage);

      // Environment access failure is not a UX failure. Before giving up,
      // attempt an independent browser screenshot. A successful visual capture
      // is enough to run a screenshot-based UX audit without pretending we
      // recovered structured website content.
      if (blocked) {
        const visual = await captureVisualFallback(normalized);
        if (visual.screenshot) {
          return res.status(200).json({
            code: "AUDIT_VISUAL_EVIDENCE",
            evidenceStatus: "VISUAL_ONLY",
            rendering: visual.provider,
            reason: "Text retrieval was blocked, but UXNest captured the rendered public page through an independent browser environment.",
            pages: [normalized],
            dossier: "",
            screenshot: visual.screenshot,
            screenshots: [{ url: normalized, screenshot: visual.screenshot }],
            diagnostics: [attempts, ...visual.diagnostics].filter(Boolean).join(" "),
          });
        }
      }

      return res.status(422).json({
        code: blocked ? "AUDIT_ENVIRONMENT_BLOCKED" : "AUDIT_INSUFFICIENT_EVIDENCE",
        evidenceStatus: blocked ? "BLOCKED" : "INSUFFICIENT",
        reason: blocked
          ? "The website blocked UXNest's audit environment. This does not establish that the website is inaccessible to normal visitors."
          : (attempts || "The website was reachable but did not expose enough rendered public content for a reliable audit."),
        pages: homepage && !accessBlocked(homepage) ? [homepage.url] : [],
        diagnostics: attempts || undefined,
      });
    }

    const pages = [homepage];
    // One internal page is a useful supplement, but it must never block the audit.
    for (const link of homepage.links.filter((l) => l.label && !/^(privacy|terms|cookies?|login|sign in)$/i.test(l.label)).slice(0, 2)) {
      try {
        const page = await directFetch(link.url);
        if (meaningful(page) && !pages.some((p) => p.url === page.url)) pages.push(page);
      } catch {}
    }

    // Capture a visual record for every page included in the audit. This is
    // best-effort only: screenshot failures must never invalidate usable text
    // evidence. Run the small set in parallel to stay within the function budget.
    const captured = await Promise.all(pages.slice(0, 3).map(async (page, index) => {
      const image = index === 0 && screenshot ? screenshot : await captureScreenshot(page.url);
      return image ? { url: page.url, screenshot: image } : null;
    }));
    const screenshots = captured.filter(Boolean);
    const primaryScreenshot = screenshots[0]?.screenshot || screenshot || null;

    return res.status(200).json({
      evidenceStatus: "SUFFICIENT",
      rendering,
      pages: pages.map((p) => p.url),
      dossier: dossier(pages),
      screenshot: primaryScreenshot,
      screenshots,
    });
  } catch (error) {
    return res.status(422).json({
      code: "AUDIT_INSUFFICIENT_EVIDENCE",
      evidenceStatus: "INSUFFICIENT",
      reason: error instanceof Error ? error.message : "UXNest could not retrieve the website.",
      pages: [],
    });
  }
}