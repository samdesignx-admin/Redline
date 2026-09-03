import { lookup } from "node:dns/promises";
import net from "node:net";

export const maxDuration = 30;

const MAX_PAGES = 3;
const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1_500_000;

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
      a >= 224;
  }
  const v = address.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") ||
    v.startsWith("fe80") || v === "::";
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are supported.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not supported.");
  const host = url.hostname.replace(/^[|]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Local addresses are not supported.");
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Private network addresses are not supported.");
  if (!net.isIP(host)) {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
      throw new Error("This address does not resolve to a public website.");
    }
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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchAll(html, regex, limit = 20) {
  const out = [];
  for (const match of html.matchAll(regex)) {
    const text = cleanText(match[1]);
    if (text) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].trim();
    const label = cleanText(match[2]);
    try {
      const url = new URL(href, baseUrl);
      url.hash = "";
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== new URL(baseUrl).origin) continue;
      const key = url.toString();
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ url: key, label });
      }
    } catch {}
  }
  return links;
}

function extractPage(html, finalUrl) {
  const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const meta = (html.match(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*content\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  const headings = matchAll(html, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi, 18);
  const buttons = matchAll(html, /<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 24);
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].slice(0, 6).map((m) => {
    const inputs = [...m[1].matchAll(/<(?:input|textarea|select)\b[^>]*(?:name|type|placeholder)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((x) => x[1]).slice(0, 10);
    return inputs.join(", ");
  }).filter(Boolean);
  const text = cleanText(html).slice(0, 9000);
  return {
    url: finalUrl,
    title,
    description: cleanText(meta),
    headings,
    buttons: [...new Set(buttons)].slice(0, 20),
    forms,
    text,
    links: extractLinks(html, finalUrl),
  };
}

async function fetchPublicPage(value) {
  let current = (await assertPublicUrl(value)).toString();
  for (let redirect = 0; redirect < 5; redirect++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "UXNest-AuditBot/1.0 (+https://uxnest.ai)",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website redirected without a destination.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("The URL did not return an HTML page.");
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const page = extractPage(html, current);

    // Modern SPA shells often contain almost no readable body text because the
    // browser renders the application client-side. Do not reject a live page
    // solely because its server HTML is sparse. We can still preserve verified
    // metadata/navigation evidence, but require at least some independently
    // useful signal before calling it a retrievable page.
    const hasStructuredEvidence = Boolean(
      page.title ||
      page.description ||
      page.headings.length ||
      page.buttons.length ||
      page.links.length
    );
    if (page.text.length < 80 && !hasStructuredEvidence) {
      throw new Error("The page returned too little readable public content.");
    }
    return page;
  }
  throw new Error("Too many redirects.");
}

function buildDossier(pages) {
  return pages.map((page, index) => [
    `PAGE ${index + 1}: ${page.url}`,
    page.title && `TITLE: ${page.title}`,
    page.description && `DESCRIPTION: ${page.description}`,
    page.headings.length && `HEADINGS: ${page.headings.join(" | ")}`,
    page.buttons.length && `LINKS/CTAS: ${page.buttons.join(" | ")}`,
    page.forms.length && `FORMS: ${page.forms.join(" | ")}`,
    `CONTENT: ${page.text.slice(0, 3000)}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const rawUrl = String(req.body?.url || "").trim();
  const requestedLimit = Math.min(Math.max(Number(req.body?.navLimit) || 2, 0), MAX_PAGES - 1);
  if (!rawUrl) return res.status(400).json({ error: "A URL is required." });

  try {
    const homepage = await fetchPublicPage(rawUrl);
    const pages = [homepage];
    const candidates = homepage.links
      .filter((link) => link.label && !/^(privacy|terms|cookies?|login|sign in)$/i.test(link.label))
      .slice(0, requestedLimit);

    for (const candidate of candidates) {
      try {
        const page = await fetchPublicPage(candidate.url);
        if (!pages.some((p) => p.url === page.url)) pages.push(page);
      } catch {
        // A secondary page failing should not invalidate a successfully fetched homepage.
      }
    }

    const dossier = buildDossier(pages);
    const meaningfulPage = pages.some((page) =>
      page.text.length >= 250 ||
      page.headings.length >= 2 ||
      page.description.length >= 40 ||
      page.buttons.length >= 3
    );
    if (!meaningfulPage) {
      return res.status(422).json({
        code: "AUDIT_INSUFFICIENT_EVIDENCE",
        evidenceStatus: "INSUFFICIENT",
        reason: "The website is reachable, but its server HTML is an almost-empty client-rendered application shell. UXNest needs browser-rendered content or screenshots to audit the actual interface reliably.",
        pages: pages.map((page) => page.url),
      });
    }
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      evidenceStatus: "SUFFICIENT",
      pages: pages.map((page) => page.url),
      dossier,
    });
  } catch (error) {
    return res.status(422).json({
      code: "AUDIT_INSUFFICIENT_EVIDENCE",
      evidenceStatus: "INSUFFICIENT",
      reason: error instanceof Error ? error.message : "UXNest could not retrieve enough public content.",
      pages: [],
    });
  }
}
