import { useState, useEffect, useCallback, useRef } from "react";
import AdminPage from "./AdminPage.jsx";
import SupportChat from "./SupportChat.jsx";
import { stripDashLines, parseIssues, parseNumberedList, parseDashList, parseSummary, parseTop10, parseScorecard, normalizeReportText, parseReport, buildPlainTextSummary } from "./utils/reportParser.js";
import {
  Squiggle,
  SeverityBadge,
  IssueCard,
  ScoreBar,
  SectionIntro,
  EmptyIssueState,
  Section,
  ListBlock,
  Modal,
} from "./components/ui/AuditAtoms.jsx";
import { C, FONT_IMPORT, SEVERITY_STYLES, SITE_URL, SCREEN_LIMIT, NAV_LIMIT, AUDIT_QUOTA, QUOTA_MESSAGE } from "./config/index.js";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  Upload, Image as ImageIcon, X, Sparkles, Loader2, RefreshCw, Copy, Check,
  AlertTriangle, AlertCircle, Info, ShieldCheck, Eye, Gauge, Trophy,
  Zap, FileText, Stamp, Navigation as NavIcon, Palette,
  Accessibility as A11yIcon, TrendingUp, Brain, Rocket,
  Mail, Download, History as HistoryIcon, Link2, ShieldAlert,
  ScrollText, LogIn, LogOut, UserPlus, Lock, Globe, Lightbulb, ArrowLeft, EyeOff,
  FileType2, Search, Trash2, ArrowRight, Users, BarChart3, MessageSquare, TestTube2, ClipboardList, Plus, Menu,
} from "lucide-react";

/* ----------------------------------------------------------------------- */
/* Warm "paper & red ink" theme tokens                                     */
/* ----------------------------------------------------------------------- */

/* ----------------------------------------------------------------------- */
/* Brand-adaptive report theme                                              */
/* ----------------------------------------------------------------------- */
const REPORT_THEME_FALLBACK = {
  mode: "brand-adaptive", confidence: "fallback", isDark: false,
  primary: "#176B5B", accent: "#C58A3A", background: "#FCFBF8", surface: "#FFFFFF",
  text: "#18211F", textDim: "#52605C", muted: "#77827E", border: "#E7E1D8", soft: "#EEF6F3",
  coverStart: "#12302B", coverEnd: "#24584D", radius: 14, personality: "corporate", titleScale: 1, titleWeight: 800, letterSpacing: "-0.8pt", cardShadow: "0 1.5mm 5mm rgba(0,0,0,.055)", ornament: "grid", density: "structured", descriptor: "UXNEST SYSTEM",
};
const clampTheme = (n, min, max) => Math.min(max, Math.max(min, n));
const themeHex = (n) => clampTheme(Math.round(n), 0, 255).toString(16).padStart(2, "0");
const rgbHex = (r, g, b) => "#" + themeHex(r) + themeHex(g) + themeHex(b);
function rgbToThemeHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) { const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6; }
  return [h * 360, s * 100, l * 100];
}
function themeHslHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const q = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return rgbHex(255 * (q[0] + m), 255 * (q[1] + m), 255 * (q[2] + m));
}
function classifyVisualPersonality({ avgLum, avgSat, paletteDiversity, edgeDensity, dominantHue }) {
  if (avgSat >= 56 && paletteDiversity >= 7 && avgLum >= .42) return "playful";
  if (avgSat >= 52 && edgeDensity >= .11) return "bold";
  if (avgSat <= 28 && avgLum <= .56 && paletteDiversity <= 6) return "luxury";
  if (edgeDensity <= .085 && avgLum >= .55 && paletteDiversity <= 7) return "minimal";
  if (edgeDensity <= .115 && avgLum >= .5 && avgSat >= 24) return "rounded";
  return "corporate";
}

function personalityTokens(personality) {
  const map = {
    minimal: { radius: 5, titleScale: .96, titleWeight: 700, letterSpacing: "-1.1pt", cardShadow: "none", ornament: "line", density: "airy", descriptor: "MINIMAL SYSTEM" },
    bold: { radius: 6, titleScale: 1.14, titleWeight: 850, letterSpacing: "-1.7pt", cardShadow: "0 2.5mm 7mm rgba(0,0,0,.10)", ornament: "block", density: "assertive", descriptor: "BOLD SYSTEM" },
    playful: { radius: 22, titleScale: 1.05, titleWeight: 800, letterSpacing: "-1.2pt", cardShadow: "0 2mm 7mm rgba(0,0,0,.08)", ornament: "bubble", density: "expressive", descriptor: "PLAYFUL SYSTEM" },
    luxury: { radius: 3, titleScale: 1.0, titleWeight: 650, letterSpacing: ".15pt", cardShadow: "0 1.5mm 5mm rgba(0,0,0,.07)", ornament: "frame", density: "editorial", descriptor: "LUXURY SYSTEM" },
    rounded: { radius: 28, titleScale: 1.0, titleWeight: 750, letterSpacing: "-1.1pt", cardShadow: "0 2.5mm 8mm rgba(0,0,0,.07)", ornament: "blob", density: "soft", descriptor: "SOFT-ROUNDED SYSTEM" },
    corporate: { radius: 9, titleScale: 1.0, titleWeight: 800, letterSpacing: "-.8pt", cardShadow: "0 1.5mm 5mm rgba(0,0,0,.055)", ornament: "grid", density: "structured", descriptor: "CORPORATE SYSTEM" },
  };
  return map[personality] || map.corporate;
}

function extractBrandTheme(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof window === "undefined") return resolve({ ...REPORT_THEME_FALLBACK });
    const img = new Image();
    img.onload = () => {
      try {
        const max = 120, scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale)), h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h);
        const image = ctx.getImageData(0, 0, w, h), px = image.data;
        const hueBins = Array.from({ length: 36 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
        const paletteBins = new Set();
        let lum = 0, satTotal = 0, count = 0, chromatic = 0, edgeSum = 0, edgeCount = 0;
        const gray = new Float32Array(w * h);

        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
          gray[y * w + x] = a < 200 ? 255 : (.2126 * r + .7152 * g + .0722 * b);
        }

        for (let i = 0; i < px.length; i += 16) {
          const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]; if (a < 200) continue;
          const l = (.2126 * r + .7152 * g + .0722 * b) / 255; lum += l; count++;
          const [hue, sat, light] = rgbToThemeHsl(r, g, b); satTotal += sat;
          paletteBins.add(Math.floor(r / 64) + "-" + Math.floor(g / 64) + "-" + Math.floor(b / 64));
          if (sat >= 20 && light >= 12 && light <= 90) {
            chromatic++;
            const weight = (sat / 100) * (.5 + Math.abs(light - 50) / 100), bin = hueBins[Math.floor(hue / 10) % 36];
            bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
          }
        }
        for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
          const c = gray[y * w + x], gx = Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1]), gy = Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
          if (c < 250 || gx + gy > 0) { edgeSum += Math.min(1, (gx + gy) / 120); edgeCount++; }
        }

        const best = hueBins.reduce((a, b) => b.weight > a.weight ? b : a, hueBins[0]);
        if (!count) return resolve({ ...REPORT_THEME_FALLBACK });
        const avgLum = lum / count, avgSat = satTotal / count, paletteDiversity = paletteBins.size;
        const edgeDensity = edgeCount ? edgeSum / edgeCount : 0;
        const fallbackHue = 164;
        const [hue, sat] = best.weight ? rgbToThemeHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight) : [fallbackHue, 42, 50];
        const personality = classifyVisualPersonality({ avgLum, avgSat, paletteDiversity, edgeDensity, dominantHue: hue });
        const tokens = personalityTokens(personality);
        const isDark = avgLum < .42;

        resolve({
          mode: "brand-adaptive", confidence: best.weight ? "image" : "fallback", isDark, personality,
          ...tokens,
          metrics: { avgLum: Number(avgLum.toFixed(3)), avgSat: Math.round(avgSat), paletteDiversity, edgeDensity: Number(edgeDensity.toFixed(3)), chromaticShare: Number((chromatic / count).toFixed(3)) },
          primary: themeHslHex(hue, clampTheme(Math.max(sat, 48), 48, 86), isDark ? 62 : 38),
          accent: themeHslHex(hue + (personality === "playful" ? 42 : 28), clampTheme(Math.max(sat * .85, 42), 42, 78), isDark ? 68 : 46),
          background: isDark ? themeHslHex(hue, 18, personality === "luxury" ? 8 : 10) : themeHslHex(hue, personality === "minimal" ? 10 : 18, personality === "luxury" ? 95 : 97),
          surface: isDark ? themeHslHex(hue, 14, 15) : "#FFFFFF",
          text: isDark ? "#F5F7F6" : "#18211F", textDim: isDark ? "#C4CDC9" : "#52605C", muted: isDark ? "#93A09B" : "#77827E",
          border: isDark ? themeHslHex(hue, 12, 24) : themeHslHex(hue, 16, 88), soft: isDark ? themeHslHex(hue, 28, 18) : themeHslHex(hue, personality === "minimal" ? 28 : 45, 94),
          coverStart: isDark ? themeHslHex(hue, 38, personality === "luxury" ? 7 : 10) : themeHslHex(hue, personality === "luxury" ? 24 : 48, personality === "minimal" ? 16 : 18),
          coverEnd: isDark ? themeHslHex(hue + 16, 42, 18) : themeHslHex(hue + 12, personality === "playful" ? 65 : 55, personality === "minimal" ? 26 : 28),
        });
      } catch { resolve({ ...REPORT_THEME_FALLBACK }); }
    };
    img.onerror = () => resolve({ ...REPORT_THEME_FALLBACK }); img.src = dataUrl;
  });
}

/* ----------------------------------------------------------------------- */
/* Plan limits                                                              */
/* ----------------------------------------------------------------------- */
function screenLimitFor() {
  return SCREEN_LIMIT;
}
function navLimitFor() {
  // Fast Audit intentionally samples the homepage plus at most two key pages.
  // This keeps exploration bounded and predictable for beta users.
  return Math.min(NAV_LIMIT, 2);
}

/* ----------------------------------------------------------------------- */
/* Prompts                                                                  */
/* ----------------------------------------------------------------------- */
const SHARED_RULES = `For every issue identified:
1. Explain why it is a problem.
2. Describe the impact on users.
3. Provide a recommendation.
4. Estimate severity.

Severity levels: Critical, High, Medium, Low.

Be direct, professional, and specific. Avoid generic statements. Always focus on improving user outcomes and business outcomes.

BREVITY IS MANDATORY: "Why it matters" max 35 words. "Recommendation" max 30 words. Output exactly the minimum issue count requested per section — no more. No introductions before sections, no summaries after them.

Output ONLY the sections listed below — no other sections, no preamble, no closing commentary, no code fences, no markdown bold/asterisks around labels. Use these exact section headers and labels.

The issue block format, where required, is exactly:
Issue: <short title>
Severity: <Critical|High|Medium|Low>
Why it matters: <explanation>
Recommendation: <actionable fix>
(repeated for each issue)`;

/* The report is generated as 4 parallel batches to keep wall-clock time low.
   Each batch independently analyzes the same input and writes only its
   assigned sections; outputs are concatenated in this order. */
const REPORT_BATCHES = [
  `# Executive Summary
2-3 sentence summary of overall UX quality (max 60 words).
Overall UX Score: X/100
Overall Assessment: [one of: Excellent, Good, Average, Poor]
Top Strengths:
1.
2.
3.
Top Concerns:
1.
2.
3.
(Each strength/concern max 12 words.)`,

  `# Usability Analysis
Evaluate Navigation, Discoverability, Learnability, User Control, Error Prevention.
Use the issue block format, exactly 3 issues.

# Visual Design Analysis
Evaluate Layout, Alignment, Spacing, Typography, Color Usage, Consistency.
Use the issue block format, exactly 3 issues.`,

  `# Accessibility Review
Evaluate Contrast, Readability, Touch Targets, Screen Reader Friendliness, Keyboard Accessibility.
Use the issue block format, exactly 3 issues.

# Trust & Credibility Review
Evaluate Professional appearance, Transparency, Security signals, User confidence.
Use the issue block format, exactly 2 issues.`,

  `# Conversion Optimization Review
Evaluate Calls to Action, Friction Points, User Motivation, Form Complexity, Decision Making.
Use the issue block format, exactly 2 issues.

# Cognitive Load Assessment
Evaluate Information Density, Mental Effort, Decision Fatigue, Content Clarity.
Use the issue block format, exactly 2 issues.`,

  `# AI Recommendations
Strategic narrative synthesizing the most important patterns into prioritized direction for a product/design leader (4-5 sentences, max 110 words).

# Quick Wins
Dash-bulleted list of improvements completable in under one day. Exactly 5 items, max 15 words each.

# Strategic Improvements
Dash-bulleted list of larger improvements requiring real design effort. Exactly 4 items, max 15 words each.`,

  `# Top 10 UX Improvements
Rank from highest impact to lowest. Output exactly 10 numbered entries in this shape:
1. Recommendation: <max 18 words>
Expected User Benefit: <max 12 words>
Expected Business Benefit: <max 12 words>
(continue 2 through 10 in the same shape)

# Final Scorecard
Usability: XX/100
Accessibility: XX/100
Visual Design: XX/100
Trust: XX/100
Conversion: XX/100
Overall UX Score: XX/100
Final Verdict: <Approve or Do Not Approve, then why in 2-3 sentences, max 60 words>`,
];

function buildFilesBatchPrompt(batchSections) {
  return `You are a Senior UX Design Director with 20 years of experience reviewing digital products across banking, fintech, healthcare, SaaS, ecommerce, and mobile applications.

Perform a professional UX audit of the attached screenshot(s) and/or document(s). Do not merely describe the screen — analyze the experience as a UX expert.

Evaluate using Nielsen's 10 Usability Heuristics, Accessibility Best Practices (WCAG), Conversion Optimization Principles, Cognitive Load Reduction, Visual Hierarchy Principles, User Trust & Credibility Principles, and Mobile/Responsive UX Best Practices.

${SHARED_RULES}

Sections to write:

${batchSections}

Begin now.`;
}

function buildPreviewPrompt(url) {
  return `You are a Senior UX Design Director. Use web search to open ${url} once and skim it. Be fast — a single fetch is enough.

Then output ONLY this, with no preamble and no extra sections:

SCORE: <0-100 integer>
ASSESSMENT: <one of: Excellent, Good, Average, Poor>
SUMMARY: <one sentence, max 25 words, on the overall UX quality>
ISSUE: <short title> | <severity: Critical|High|Medium|Low> | <one sentence on why it matters, max 20 words>
ISSUE: <short title> | <severity> | <why it matters>
ISSUE: <short title> | <severity> | <why it matters>

Exactly three ISSUE lines, ranked by impact. Be specific to this page, not generic.`;
}

function parsePreview(raw) {
  const t = (raw || "").replace(/\r\n/g, "\n");
  const scoreM = t.match(/SCORE:\s*(\d+)/i);
  const assessM = t.match(/ASSESSMENT:\s*(Excellent|Good|Average|Poor)/i);
  const sumM = t.match(/SUMMARY:\s*(.+)/i);
  const issues = [...t.matchAll(/ISSUE:\s*([^|\n]+)\|([^|\n]+)\|([^\n]+)/gi)].map((m) => ({
    title: m[1].trim(),
    severity: severityFor(m[2]),
    why: m[3].trim(),
  }));
  return {
    score: scoreM ? Number(scoreM[1]) : null,
    assessment: assessM ? assessM[1] : null,
    summary: sumM ? sumM[1].trim() : "",
    issues: issues.slice(0, 3),
  };
}

const EXPLORATION_PROMPT = (url, navLimit) => `Use your web search/fetch capability to explore ${url} and up to ${navLimit} of its most important main-navigation destinations. SPEED IS THE PRIORITY: open the homepage and at most two additional pages total. Do not retry failed pages. Do not follow secondary links. Stop exploring once you have enough information to describe the core experience.

First, output a line listing every page URL you successfully opened, in this exact format:
PAGES AUDITED: <url1> | <url2> | <url3>

Then output exactly one evidence status line:
EVIDENCE STATUS: <SUFFICIENT or INSUFFICIENT>
EVIDENCE REASON: <brief factual reason>

Mark EVIDENCE STATUS as INSUFFICIENT if you could not successfully open at least one page with meaningful public content. Do not treat search snippets, guesses, DNS results, robots.txt, or an inability to access the site as evidence of the site's UX.

If evidence is sufficient, write a factual SITE OBSERVATION DOSSIER (plain text, max ~450 words) recording only what you directly observed: overall purpose, navigation structure and labels, page hierarchy, key content per page, calls-to-action and their wording/placement, forms and their fields, trust/security signals (or absence), footer contents, and anything notable about content density or clarity. Be telegraphic — dense factual notes, not prose. Do not analyze, score, or recommend. Do not fabricate visual details you cannot verify from fetched content.

If evidence is insufficient, do not invent a dossier and do not analyze the website. Briefly state only what access failed and why, if known.`;

function buildUrlBatchPrompt(url, dossier, batchSections) {
  return `You are a Senior UX Design Director with 20 years of experience reviewing digital products across banking, fintech, healthcare, SaaS, ecommerce, and mobile applications.

You are auditing the website ${url}. Below is a factual observation dossier gathered from the live site's content and structure. Base your audit on it. Because it reflects content/structure rather than pixels, do not fabricate claims about exact colors, spacing, or pixel alignment; where something can't be assessed without a visual screenshot, say so inside that issue's "Why it matters" rather than guessing.

--- SITE OBSERVATION DOSSIER ---
${dossier}
--- END DOSSIER ---

${SHARED_RULES}

Sections to write:

${batchSections}

Begin now for ${url}.`;
}

/* ----------------------------------------------------------------------- */
/* Visual evidence mapping                                                  */
/* ----------------------------------------------------------------------- */

// Visual evidence is intentionally a separate pass: the main audit remains
// grounded in retrieved content, while this pass only maps findings that are
// actually visible in the rendered screenshot. Coordinates are normalized so
// they remain responsive in the report and PDF.
function buildVisualEvidencePrompt(issues) {
  const list = issues.map((issue, i) => `Finding ${i + 1}: [${issue.section}] ${issue.title} — ${issue.why}`).join("\n");
  return `You are mapping UX findings to a screenshot of the audited website.

Only annotate a finding when the screenshot itself visibly supports it. Do not invent locations for hidden pages, source code, accessibility internals, or facts you cannot see.

Return JSON only. Do not use markdown or commentary. Use this exact schema:
[
  {
    "findingIndex": 1,
    "cx": 0,
    "cy": 0,
    "radius": 0,
    "explanation": "What is visible at this exact point and why it supports Finding 1, max 28 words"
  }
]

Coordinates are percentages of the full screenshot. cx/cy are the focal point. radius is the radius as a percentage of screenshot width. Use a tight marker: normally radius 3–6, never more than 8. The goal is to point precisely at the relevant UI element, not circle an entire section. Keep all values between 0 and 100. Return at most 6 objects, or [] if nothing can be located confidently. Prefer clearly visible, high-impact findings.

FINDINGS:
${list}`;
}

function parseVisualEvidence(raw, issues) {
  const text = String(raw || "").trim();
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const data = JSON.parse(match[0]);
    if (!Array.isArray(data)) return [];
    return data.map((item, index) => {
      const findingIndex = Math.round(Number(item?.findingIndex));
      const issue = issues[findingIndex - 1];
      if (!issue) return null;
      const clamp = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
      };
      const hasFocalPoint = Number.isFinite(Number(item?.cx)) && Number.isFinite(Number(item?.cy));
      let cx;
      let cy;
      let radius;
      if (hasFocalPoint) {
        cx = clamp(item.cx, 50);
        cy = clamp(item.cy, 50);
        radius = Math.max(3, Math.min(8, clamp(item.radius, 5)));
      } else {
        // Backward compatibility with earlier x/y/w/h responses. Convert the
        // broad box into a deliberately tight focal marker.
        const x = clamp(item.x, 0), y = clamp(item.y, 0);
        const w = Math.max(2, Math.min(100 - x, clamp(item.w, 12)));
        const h = Math.max(2, Math.min(100 - y, clamp(item.h, 8)));
        cx = Math.max(3, Math.min(97, x + w / 2));
        cy = Math.max(3, Math.min(97, y + h / 2));
        radius = Math.max(3, Math.min(7, Math.min(w, h) / 2));
      }
      const explanation = String(item.explanation || "").trim().slice(0, 220);
      if (!explanation) return null;
      return { id: `F-${findingIndex}-${index}`, findingIndex, issueTitle: issue.title, cx, cy, radius, explanation };
    }).filter(Boolean).slice(0, 6);
  } catch {
    return [];
  }
}

async function compressScreenshotForVision(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return dataUrl;
  if (typeof document === "undefined" || typeof Image === "undefined") return dataUrl;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const maxWidth = 1600;
        const maxHeight = 1800;
        const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

/* ----------------------------------------------------------------------- */
/* Parsing                                                                  */
/* ----------------------------------------------------------------------- */


/* ----------------------------------------------------------------------- */
/* Storage / lightweight accounts                                          */
/* ----------------------------------------------------------------------- */
/* Hashing: crypto.subtle needs a secure context and isn't guaranteed inside
   every iframe. Fall back to a pure-JS FNV-1a variant so auth never breaks.
   (Fine for a demo gate; a real deployment uses server-side bcrypt/argon2.) */
function fnv1aHex(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0; h2 = Math.imul(h2 ^ (h2 >>> 15), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

async function sha256Hex(text) {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
      const enc = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fall through to JS fallback */
  }
  return fnv1aHex(text);
}

/* Storage layer, in order of preference:
   1. localStorage — persists across sessions on a real domain. This is the
      normal path for the deployed site.
   2. window.storage — the Claude artifact sandbox API, used when the app runs
      inside a preview where localStorage is unavailable.
   3. In-memory Map — last resort so the app still works for one session
      (private browsing with storage blocked, etc.).
   Note: this is still per-browser storage. Accounts do not sync across
   devices, and clearing site data removes them. A real backend is required
   for cross-device accounts. */
const memoryStore = new Map();
let storageDegraded = false;

function localStorageWorks() {
  try {
    const k = "__uxnest_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const HAS_LOCAL = typeof window !== "undefined" && localStorageWorks();

async function kvGet(key) {
  if (HAS_LOCAL) {
    try {
      return window.localStorage.getItem(key);
    } catch { /* fall through */ }
  }
  if (typeof window !== "undefined" && window.storage) {
    try {
      const res = await window.storage.get(key, true);
      return res ? res.value : null;
    } catch {
      return memoryStore.has(key) ? memoryStore.get(key) : null;
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

async function kvSet(key, value) {
  memoryStore.set(key, value);
  if (HAS_LOCAL) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      storageDegraded = true;
    }
  }
  if (typeof window !== "undefined" && window.storage) {
    try {
      await window.storage.set(key, value, true);
      return true;
    } catch {
      storageDegraded = true;
      return false;
    }
  }
  if (!HAS_LOCAL) storageDegraded = true;
  return HAS_LOCAL && !storageDegraded;
}



/* ---------------------------------------------------------------- */
/* Server API (Postgres via serverless functions)                     */
/* ---------------------------------------------------------------- */
const SESSION_KEY = "uxnest:token";

function getToken() {
  try { return window.localStorage.getItem(SESSION_KEY) || ""; } catch { return ""; }
}
function setToken(t) {
  try { t ? window.localStorage.setItem(SESSION_KEY, t) : window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON response */ }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const api = {
  session: (token) => apiPost("/api/account", { action: "session", token }),
  signup: (payload) => apiPost("/api/account", { action: "signup", ...payload }),
  login: (email, password) => apiPost("/api/account", { action: "login", email, password }),
  google: (credential) => apiPost("/api/account", { action: "google", credential }),
  listAudits: () => apiPost("/api/audits", { action: "list", token: getToken() }),
  quota: () => apiPost("/api/audits", { action: "quota", token: getToken() }),
  saveAudit: (audit) => apiPost("/api/audits", { action: "create", token: getToken(), audit }),
  deleteAudit: (id) => apiPost("/api/audits", { action: "delete", token: getToken(), id }),
};



/* ----------------------------------------------------------------------- */
/* Disclaimer modal                                                        */
/* ----------------------------------------------------------------------- */
function DisclaimerModal({ onAccept, onCancel }) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal onClose={onCancel} maxWidth={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <ShieldAlert size={19} color={C.gold} />
        <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, color: C.text }}>Before you run this</h3>
      </div>
      <p style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.6, margin: "0 0 10px 0" }}>
        UXNest's findings are generated by an AI model, not a certified human auditor. They're a strong
        starting point for design discussion — not a substitute for professional accessibility testing,
        legal/compliance review, or licensed UX research. Scores and severities are estimates and can be wrong.
      </p>
      <p style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.6, margin: "0 0 16px 0" }}>
        Don't upload screenshots containing other people's private or sensitive data unless you have the right
        to do so. See our <strong>Disclaimer</strong> and <strong>Terms</strong> in the footer for full detail.
      </p>
      <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: C.text, marginBottom: 16, cursor: "pointer" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
        I understand this is AI-generated analysis and not certified or legal advice.
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "11px 0", borderRadius: 9, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 13.5, cursor: "pointer" }}>
          Cancel
        </button>
        <button
          disabled={!checked}
          onClick={onAccept}
          style={{ flex: 1, padding: "11px 0", borderRadius: 9, border: "none", background: checked ? C.now : C.surfaceAlt, color: checked ? C.dark : C.muted, borderRadius: 999, fontWeight: 600, fontSize: 13.5, cursor: checked ? "pointer" : "not-allowed" }}
        >
          Agree & continue
        </button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------------- */
/* Auth modal                                                               */
/* ----------------------------------------------------------------------- */
function GoogleButton({ onCredential, disabled }) {
  const ref = useRef(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.google || !ref.current) return;
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => onCredential(resp && resp.credential),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "outline", size: "large", width: 320, text: "continue_with",
        });
        setReady(true);
      } catch { /* rendering failed; fall back to email form */ }
    };
    if (window.google) { init(); return () => { cancelled = true; }; }
    const sc = document.createElement("script");
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.defer = true;
    sc.onload = init;
    document.head.appendChild(sc);
    return () => { cancelled = true; };
  }, [clientId, onCredential]);

  if (!clientId) return null;
  return (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.6 : 1 }}>
      <div ref={ref} style={{ display: "flex", justifyContent: "center" }} />
      {ready && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 0" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ fontSize: 11, color: C.muted }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>
      )}
    </div>
  );
}

/* Decode the display fields from a Google ID token payload. The signature is
   NOT verified here — that requires a server. Until the backend exists, treat
   Google sign-in as convenience, not proof of identity. */
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function AuthModal({ onClose, onAuth, reason, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [company, setCompany] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState("form");       // form | verify
  const [code, setCode] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const onGoogle = useCallback(async (credential) => {
    if (!credential) return;
    setLoading(true);
    setError(null);
    try {
      const { account, token } = await api.google(credential);
      setToken(token);
      onAuth({ email: account.email, name: account.name, plan: account.plan, id: account.id, auditsUsed: account.auditsUsed });
    } catch (e) {
      setError(e.message || "Google sign-in failed.");
    } finally {
      setLoading(false);
    }
  }, [onAuth]);

  const sendCode = async (targetEmail) => {
    const r = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "send", email: targetEmail }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "Couldn't send the verification email.");
    return body.token;
  };

  const resend = async () => {
    setError(null);
    setLoading(true);
    try {
      const t = await sendCode(email.trim().toLowerCase());
      setVerifyToken(t);
      setResendIn(30);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  /* Second step of signup: confirm the emailed code, then create the account. */
  const confirmCode = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const r = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify", email: cleanEmail, code: code.trim(), token: verifyToken }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.verified) throw new Error(body.error || "Verification failed.");

      const { account, token } = await api.signup({
        email: cleanEmail,
        password,
        name: name.trim(),
        company: company.trim(),
        mobile: mobile.trim(),
        emailVerified: true,
      });
      setToken(token);
      onAuth({ email: account.email, name: account.name, plan: account.plan, id: account.id, auditsUsed: account.auditsUsed });
    } catch (e) {
      setError(e.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "signup") {
      if (name.trim().length < 2) { setError("Enter your name."); return; }
      const digits = mobile.replace(/[^0-9]/g, "");
      if (digits.length > 0 && digits.length < 7) { setError("That mobile number looks too short — leave it blank to skip."); return; }
      if (company.trim().length < 2) { setError("Enter your company (or 'Independent')."); return; }
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        // Send a verification code; the account is created only after the
        // code is confirmed, so unverified addresses never become accounts.
        try {
          const t = await sendCode(cleanEmail);
          setVerifyToken(t);
          setResendIn(30);
          setStep("verify");
        } catch (err) {
          setError(err.message);
        }
        setLoading(false);
        return;
      } else {
        const { account, token } = await api.login(cleanEmail, password);
        setToken(token);
        onAuth({ email: account.email, name: account.name, plan: account.plan, id: account.id, auditsUsed: account.auditsUsed });
      }
    } catch (e) {
      setError(`Couldn't complete that: ${(e && e.message) || "unknown error"}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Lock size={18} color={C.gold} />
        <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 19, color: C.text }}>
          {mode === "login" ? "Log in" : "Create your account"}
        </h3>
      </div>
      {reason && <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 14px 0" }}>{reason}</p>}
      {!reason && <div style={{ marginBottom: 14 }} />}

      {step === "verify" ? (
        <div>
          <p style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, margin: "0 0 14px" }}>
            We sent a 6-digit code to <strong style={{ color: C.text }}>{email.trim().toLowerCase()}</strong>. Enter it below to finish creating your account.
          </p>
          <input
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ ...inputStyle, textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: 700 }}
          />
          {error && <div style={{ marginTop: 10, fontSize: 12.5, color: C.critical }}>{error}</div>}
          <button
            onClick={confirmCode}
            disabled={loading}
            style={{ width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 999, border: "none", background: C.now, color: C.dark, fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />}
            Verify & create account
          </button>
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: C.muted }}>
            {resendIn > 0 ? (
              <>Didn't get it? Resend in {resendIn}s</>
            ) : (
              <>Didn't get it? <button onClick={resend} style={linkBtnStyle}>Resend code</button></>
            )}
            <div style={{ marginTop: 6 }}>
              <button onClick={() => { setStep("form"); setError(null); setCode(""); }} style={linkBtnStyle}>Change details</button>
            </div>
          </div>
        </div>
      ) : (
      <>
      <GoogleButton onCredential={onGoogle} disabled={loading} />

      {mode === "signup" && (
        <>
          <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
        </>
      )}
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, marginTop: mode === "signup" ? 10 : 0 }} />
      {mode === "signup" && (
        <input type="tel" placeholder="Mobile number (optional)" value={mobile} onChange={(e) => setMobile(e.target.value)} style={{ ...inputStyle, marginTop: 10 }} />
      )}
      <div style={{ position: "relative", marginTop: 10 }}>
        <input
          type={showPassword ? "text" : "password"}
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, paddingRight: 46 }}
        />
        <button
          type="button"
          onClick={() => setShowPassword((visible) => !visible)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          title={showPassword ? "Hide password" : "Show password"}
          style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: C.muted, cursor: "pointer", borderRadius: 7 }}
        >
          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>

      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: C.critical }}>{error}</div>}

      <button
        onClick={submit}
        disabled={loading}
        style={{
          width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 999, border: "none",
          background: C.now, color: C.dark, fontWeight: 700, fontSize: 14, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : mode === "login" ? <LogIn size={15} /> : <UserPlus size={15} />}
        {mode === "login" ? "Log in" : "Create account"}
      </button>

      <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: C.muted }}>
        {mode === "login" ? (
          <>New here? <button onClick={() => { setMode("signup"); setError(null); }} style={linkBtnStyle}>Create an account</button></>
        ) : (
          <>Already have one? <button onClick={() => { setMode("login"); setError(null); }} style={linkBtnStyle}>Log in</button></>
        )}
      </div>

      </>
      )}

      <p style={{ fontSize: 11, color: C.muted, marginTop: 14, lineHeight: 1.5, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 10 }}>
        Early access: accounts are stored in your browser and passwords are hashed. There's no password
        recovery yet, so please use a unique password.
      </p>
    </Modal>
  );
}

const inputStyle = {
  width: "100%", padding: "11px 13px", borderRadius: 9, border: `1px solid ${C.border}`,
  background: C.raised, color: C.text, fontSize: 13.5, fontFamily: "'Inter', sans-serif", outline: "none",
};
const linkBtnStyle = { background: "none", border: "none", color: C.gold, fontWeight: 600, cursor: "pointer", fontSize: 12.5, padding: 0 };

/* ----------------------------------------------------------------------- */
/* Legal pages                                                              */
/* ----------------------------------------------------------------------- */
const LEGAL_CONTENT = {
  terms: {
    title: "Terms of Service",
    body: `Placeholder template — have this reviewed by a lawyer before real use.

By using UXNest, you agree this tool provides AI-generated UX analysis for informational purposes only. It is not professional design, legal, accessibility-certification, or compliance advice, and UXNest's creators accept no liability for decisions made based on its output.

You're responsible for the content you upload, including screenshots, PDFs, and URLs. Don't upload material you don't have the right to share, including other people's private data.

Accounts are provided as-is for this prototype, without uptime or data-retention guarantees. We may change or discontinue features at any time.`,
  },
  privacy: {
    title: "Privacy Policy",
    body: `Placeholder template — have this reviewed by a lawyer before real use.

UXNest stores your name, email, company and (optionally) mobile number, along with the audits you run, in a private Postgres database. Passwords are never stored — only a scrypt hash. Your data is used to operate your account and is not sold.

Uploaded screenshots and PDFs are sent to Claude (via Anthropic's API) to generate your report and are not separately stored by UXNest. Website reviews fetch publicly available page content.

Don't treat this prototype as suitable for storing sensitive personal data about yourself or others.`,
  },
  disclaimer: {
    title: "Disclaimer",
    body: `UXNest produces AI-generated UX commentary. It is not a certified accessibility audit (WCAG conformance still requires manual and assistive-technology testing), not legal advice, and not a guarantee of business outcomes.

Severity ratings, scores, and recommendations are estimates based on a language model's interpretation of what was uploaded or fetched — they can be incomplete, outdated, or simply wrong. Always validate critical or legal-risk findings (e.g., accessibility compliance, security, regulated-industry disclosures) with a qualified professional before acting on them.

Website reviews are based on fetched page content, not a true visual screenshot, and may miss purely visual issues.`,
  },
};

function LegalPage({ pageKey, onBack }) {
  const page = LEGAL_CONTENT[pageKey];
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 4px 60px" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", marginBottom: 18, padding: 0 }}>
        <ArrowLeft size={14} /> Back
      </button>
      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, color: C.text, marginBottom: 14 }}>{page.title}</h2>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        {page.body.split("\n\n").map((p, i) => (
          <p key={i} style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.65, margin: i === 0 ? "0 0 12px 0" : "0 0 12px 0", fontStyle: i === 0 ? "italic" : "normal" }}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

function Footer({ onOpenLegal }) {
  return (
    <div style={{ maxWidth: 720, margin: "30px auto 0", textAlign: "center", padding: "16px 10px 0", borderTop: `1px solid ${C.borderSoft}` }}>
      <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: "0 0 8px 0" }}>
        UXNest gives AI-generated UX analysis. It does not replace a certified accessibility audit, legal review, or professional UX research.
      </p>
      <div style={{ display: "flex", justifyContent: "center", gap: 14 }}>
        {["terms", "privacy", "disclaimer"].map((k) => (
          <button key={k} onClick={() => onOpenLegal(k)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
            {LEGAL_CONTENT[k].title}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Upload / URL screens                                                    */
/* ----------------------------------------------------------------------- */
function ModeTabs({ mode, setMode }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20 }}>
      {[
        { key: "files", label: "Screens & PDFs", icon: Upload },
        { key: "url", label: "Website URL", icon: Globe },
      ].map((m) => {
        const Icon = m.icon;
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 99,
              border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldSoft : C.surface,
              color: active ? C.gold : C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            <Icon size={14} /> {m.label}
          </button>
        );
      })}
    </div>
  );
}

function UploadScreen({ images, onAddFiles, onRemove, onRun, dragOver, setDragOver, error, screenLimit }) {
  return (
    <div>
      <label
        htmlFor="uxnest-file-input"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onAddFiles(e.dataTransfer.files); }}
        style={{
          display: "block", position: "relative", border: `1.5px dashed ${dragOver ? C.gold : C.border}`,
          background: dragOver ? C.goldSoft : C.surface, borderRadius: 14,
          padding: images.length ? 18 : 38, textAlign: "center", cursor: "pointer", transition: "all 160ms ease",
        }}
      >
        <input
          id="uxnest-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", zIndex: 1 }}
          onChange={(e) => { onAddFiles(e.target.files); e.target.value = ""; }}
        />
        {images.length === 0 ? (
          <>
            <Upload size={26} color={C.gold} strokeWidth={1.8} style={{ marginBottom: 10 }} />
            <div style={{ color: C.text, fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Drop screens or PDFs here, or tap to browse</div>
            <div style={{ color: C.muted, fontSize: 12.5 }}>
              PNG, JPG, WEBP or PDF · up to {screenLimit} files
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(82px, 1fr))", gap: 10 }}>
            {images.map((img) => (
              <div key={img.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, aspectRatio: "3/4", background: C.surfaceAlt }}>
                {img.kind === "pdf" ? (
                  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 4 }}>
                    <FileType2 size={20} color={C.gold} />
                    <span style={{ fontSize: 9, color: C.muted, textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>{img.name}</span>
                  </div>
                ) : (
                  <img src={img.dataUrl} alt={img.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(img.id); }}
                  style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(44,32,19,0.75)", border: `1px solid ${C.border}`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 5 }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {images.length < screenLimit && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: `1px dashed ${C.border}`, borderRadius: 8, aspectRatio: "3/4", color: C.muted }}>
                <ImageIcon size={16} />
                <span style={{ fontSize: 10.5, marginTop: 4 }}>Add more</span>
              </div>
            )}
          </div>
        )}
      </label>

      <div style={{ fontSize: 11.5, color: C.muted, textAlign: "right", marginTop: 6 }}>
        {images.length}/{screenLimit} used
      </div>

      {error && (
        <div style={{ marginTop: 10, padding: "10px 14px", background: C.criticalSoft, border: `1px solid ${C.critical}55`, borderRadius: 8, color: C.critical, fontSize: 13 }}>
          {error}
        </div>
      )}

      <button
        disabled={images.length === 0}
        onClick={onRun}
        style={{
          width: "100%", marginTop: 14, padding: "14px 0", borderRadius: 10, border: "none",
          background: images.length ? C.now : C.surfaceAlt, color: images.length ? C.dark : C.muted, borderRadius: 999,
          fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, cursor: images.length ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        <Sparkles size={17} strokeWidth={2.2} /> Run the audit
      </button>
    </div>
  );
}

function UrlScreen({ url, setUrl, onRun, error, navLimit }) {
  return (
    <div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Globe size={18} color={C.gold} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 16, color: C.text }}>Review a live website</span>
        </div>
        <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, margin: "0 0 14px 0" }}>
          UXNest reads the homepage and up to {navLimit} main navigation pages. This
          is a content/structure-based review, not a pixel-level screenshot audit.
        </p>
        <input
          type="url"
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={inputStyle}
        />
        {error && <div style={{ marginTop: 10, fontSize: 13, color: C.critical }}>{error}</div>}
        <button
          disabled={!url.trim()}
          onClick={onRun}
          style={{
            width: "100%", marginTop: 16, padding: "14px 0", borderRadius: 10, border: "none",
            background: url.trim() ? C.now : C.surfaceAlt, color: url.trim() ? C.dark : C.muted, borderRadius: 999,
            fontWeight: 600, fontSize: 15, cursor: url.trim() ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Sparkles size={17} /> Review this site
        </button>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const AUDIT_STEPS = [
  { icon: Eye, label: "Reading the screens", sub: "Ingesting layout, copy & structure" },
  { icon: NavIcon, label: "Usability heuristics", sub: "Nielsen's 10, navigation & error prevention" },
  { icon: Palette, label: "Visual design pass", sub: "Hierarchy, spacing, typography, color" },
  { icon: A11yIcon, label: "Accessibility check", sub: "Contrast, touch targets, WCAG" },
  { icon: ShieldCheck, label: "Trust & credibility", sub: "Security signals, transparency" },
  { icon: TrendingUp, label: "Conversion & cognition", sub: "CTAs, friction, mental load" },
  { icon: Trophy, label: "Ranking priorities", sub: "Top 10, quick wins, strategy" },
  { icon: FileText, label: "Final scorecard", sub: "Scores, verdict, sign-off" },
];

function StepRow({ step, state, index }) {
  const Icon = step.icon;
  const isDone = state === "done";
  const isActive = state === "active";
  return (
    <div
      className="step-enter"
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "9px 12px",
        borderRadius: 10, marginBottom: 4, animationDelay: `${index * 70}ms`,
        background: isActive ? C.goldSoft : "transparent",
        border: `1px solid ${isActive ? `${C.gold}44` : "transparent"}`,
        transition: "background 300ms ease, border 300ms ease",
      }}
    >
      <div
        style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: isDone ? C.low : isActive ? C.gold : C.surfaceAlt,
          border: `1px solid ${isDone ? C.low : isActive ? C.gold : C.border}`,
          transition: "background 300ms ease",
          position: "relative",
        }}
      >
        {isDone ? (
          <span className="tick-pop" style={{ display: "flex" }}><Check size={15} color="#FBF6EC" strokeWidth={3} /></span>
        ) : (
          <Icon
            size={14}
            color={isActive ? "#FBF1EC" : C.muted}
            style={isActive ? { animation: "iconBob 1.1s ease-in-out infinite" } : undefined}
          />
        )}
        {isActive && (
          <span style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `1.5px solid ${C.gold}55`, animation: "pulseRing 1.6s ease-out infinite" }} />
        )}
      </div>
      <div style={{ textAlign: "left", minWidth: 0, flex: 1 }}>
        <div
          className={isActive ? "shimmer-text" : undefined}
          style={{
            fontSize: 13.5, fontWeight: 600,
            color: isDone ? C.textDim : isActive ? C.text : C.muted,
            textDecorationLine: "none",
          }}
        >
          {step.label}
        </div>
        <div style={{ fontSize: 11, color: isActive ? C.textDim : `${C.muted}AA`, lineHeight: 1.35 }}>
          {step.sub}
        </div>
      </div>
      {isDone && <span className="tick-pop" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.low }}>DONE</span>}
      {isActive && (
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: C.gold, animation: `dotPulse 1.2s ease-in-out ${i * 0.18}s infinite` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingScreen({ thumbs, progress, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tInterval = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(tInterval);
  }, []);

  /* Blend real batch progress with elapsed time so steps advance smoothly
     even between batch completions, but never show ahead of reality. */
  const realFrac = progress.total ? (progress.done || 0) / progress.total : 0;
  const timeFrac = Math.min(elapsed / 100, 0.92);
  const frac = Math.min(Math.max(realFrac, Math.min(timeFrac, realFrac + 0.18)), 0.98);
  const activeIndex = Math.min(Math.floor(frac * AUDIT_STEPS.length), AUDIT_STEPS.length - 1);
  const pct = Math.round(frac * 100);

  return (
    <div style={{ maxWidth: 440, margin: "34px auto", textAlign: "center", padding: "0 16px" }}>
      {thumbs.length > 0 && (
        <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: 8, marginBottom: 20, overflow: "hidden", padding: "2px 0" }}>
          {thumbs.slice(0, 5).map((img) => (
            <div key={img.id} style={{ position: "relative", width: 40, height: 52, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, opacity: 0.9, background: C.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {img.kind === "pdf" ? <FileType2 size={15} color={C.gold} /> : <img src={img.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              <div className="scan-sweep" style={{ position: "absolute", top: 0, left: "-60%", width: "60%", height: "100%", background: `linear-gradient(90deg, transparent, ${C.gold}55, transparent)` }} />
            </div>
          ))}
        </div>
      )}

      {/* Progress bar with moving stripes */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ height: 8, background: C.surfaceAlt, borderRadius: 99, overflow: "hidden", border: `1px solid ${C.borderSoft}` }}>
          <div
            style={{
              height: "100%", width: `${pct}%`, borderRadius: 99,
              background: `repeating-linear-gradient(45deg, ${C.gold}, ${C.gold} 8px, #C4564A 8px, #C4564A 16px)`,
              backgroundSize: "24px 24px",
              animation: "stripeSlide 0.9s linear infinite",
              transition: "width 800ms cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.muted }}>{formatElapsed(elapsed)}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.gold }}>{pct}%</span>
      </div>

      {/* Step checklist */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 8px", textAlign: "left", marginBottom: 10 }}>
        {AUDIT_STEPS.map((step, i) => (
          <StepRow
            key={step.label}
            step={step}
            index={i}
            state={i < activeIndex ? "done" : i === activeIndex ? "active" : "pending"}
          />
        ))}
      </div>

      {progress.status && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: C.high, marginBottom: 6 }}>
          {progress.status}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 14 }}>
        Usually 1–3 minutes · stops automatically at 5
      </div>

      <button
        onClick={onCancel}
        style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 12.5, borderRadius: 8, padding: "8px 16px", cursor: "pointer" }}
      >
        Cancel audit
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Report screen                                                           */
/* ----------------------------------------------------------------------- */
const TABS = [
  { key: "summary", label: "Summary", icon: Gauge },
  { key: "usability", label: "Usability", icon: NavIcon },
  { key: "visual", label: "Visual", icon: Palette },
  { key: "accessibility", label: "A11y", icon: A11yIcon },
  { key: "trust", label: "Trust", icon: ShieldCheck },
  { key: "conversion", label: "Conversion", icon: TrendingUp },
  { key: "cognitive", label: "Cog. Load", icon: Brain },
  { key: "ai", label: "AI Recommendations", icon: Lightbulb },
  { key: "top10", label: "Top 10", icon: Trophy },
  { key: "wins", label: "Quick Wins", icon: Zap },
  { key: "strategic", label: "Strategic", icon: Rocket },
  { key: "scorecard", label: "Scorecard", icon: FileText },
];

function AssessmentChip({ assessment }) {
  const map = { Excellent: C.low, Good: C.medium, Average: C.high, Poor: C.critical };
  const color = map[assessment] || C.muted;
  return (
    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: 0.5, color, border: `1px solid ${color}55`, background: `${color}1A`, borderRadius: 99, padding: "4px 12px" }}>
      {assessment ? assessment.toUpperCase() : "UNRATED"}
    </span>
  );
}


function VisualEvidencePanel({ screenshot, evidence = [] }) {
  if (!screenshot || !evidence.length) return null;
  return (
    <div style={{ borderTop: "1px solid " + C.borderSoft, paddingTop: 14, marginBottom: 14 }}>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 5 }}>Visual Evidence</div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45, marginBottom: 12 }}>Highlighted areas are mapped only where the finding is visible in the rendered page.</div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid " + C.border, background: C.surfaceAlt }}>
        <img src={screenshot} alt="Rendered website evidence" style={{ display: "block", width: "100%", height: "auto" }} />
        {evidence.map((item, index) => {
          const r = item.radius ?? Math.max(3, Math.min(7, Math.min(item.w || 12, item.h || 8) / 2));
          const cx = item.cx ?? ((item.x || 0) + (item.w || 0) / 2);
          const cy = item.cy ?? ((item.y || 0) + (item.h || 0) / 2);
          return (
            <div key={item.id} style={{ position: "absolute", left: cx + "%", top: cy + "%", width: (r * 2) + "%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)", border: "3px solid " + C.critical, borderRadius: "50%", boxShadow: "0 0 0 1px rgba(255,255,255,0.8), 0 2px 10px rgba(128,36,25,0.22)", pointerEvents: "none" }}>
              <span style={{ position: "absolute", top: 0, left: 0, transform: "translate(-30%, -30%)", width: 24, height: 24, borderRadius: "50%", background: C.critical, color: "#fff", border: "2px solid #fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }}>{index + 1}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {evidence.map((item, index) => (
          <div key={item.id + "-note"} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 11px", borderRadius: 10, background: C.surfaceAlt, border: "1px solid " + C.borderSoft }}>
            <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: C.critical, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{index + 1}</span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 2 }}>{item.issueTitle}</div>
              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.45 }}>{item.explanation}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportScreen({ report, images, source, auditedPages = [], auditScreenshot = null, visualEvidence = [], onReset, isLoggedIn, onRequireLogin, onDownload, mailtoHref }) {
  const [tab, setTab] = useState("summary");
  const { summary, usability, visual, accessibility, trust, conversion, cognitive, aiRecommendations, top10, quickWins, strategic, scorecard } = report;

  return (
    <div>
      {/* Report overview header — dark title band + score panel */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", marginBottom: 16, boxShadow: "0 6px 20px rgba(18,48,43,0.06)" }}>
        <div style={{ height: 6, background: C.gold }} />
        <div style={{ padding: "18px 18px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <FileText size={20} color="#FFFFFF" />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 22, color: C.text, margin: "0 0 3px 0", letterSpacing: -0.5 }}>Report Overview</h2>
                <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {source.mode === "url" && source.url ? source.url.replace(/^https?:\/\//, "") : `${images.length} screen${images.length === 1 ? "" : "s"} reviewed`}
                  {"  ·  "}{new Date().toLocaleDateString()}
                </div>
              </div>
            </div>
            <button onClick={onReset} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, borderRadius: 999, padding: "7px 12px", cursor: "pointer", flexShrink: 0 }}>
              <RefreshCw size={12} /> New audit
            </button>
          </div>

          {/* Score panel */}
          <div style={{ background: C.goldSoft, borderRadius: 14, padding: "18px 18px 16px", marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 13, color: C.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Overall Score</div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 62, color: C.dark, lineHeight: 1 }}>{summary.score ?? "—"}</div>
            <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 12 }}>Out of 100</div>
            <div style={{ height: 9, background: "rgba(255,255,255,0.7)", borderRadius: 99, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ height: "100%", width: `${summary.score ?? 0}%`, background: C.gold, borderRadius: 99, transition: "width 900ms cubic-bezier(.2,.8,.2,1)" }} />
            </div>
            <AssessmentChip assessment={summary.assessment} />
          </div>

          {/* Score breakdown */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 10 }}>Score Breakdown</div>
            {[["Usability", scorecard.usability, NavIcon], ["Accessibility", scorecard.accessibility, A11yIcon], ["Visual Design", scorecard.visual, Palette], ["Trust", scorecard.trust, ShieldCheck], ["Conversion", scorecard.conversion, TrendingUp]].map(([label, v, Icon]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={13} color="#FFFFFF" />
                </div>
                <span style={{ fontSize: 12.5, color: C.textDim, width: 92, flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: 7, background: C.surfaceAlt, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${v ?? 0}%`, background: C.gold, borderRadius: 99 }} />
                </div>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 13, color: C.text, width: 26, textAlign: "right", flexShrink: 0 }}>{v ?? "—"}</span>
              </div>
            ))}
          </div>

          {/* Source thumbnails */}
          {source.mode === "files" && images.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
              {images.map((img) => (
                <div key={img.id} style={{ width: 40, height: 52, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, flexShrink: 0, background: C.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {img.kind === "pdf" ? <FileType2 size={14} color={C.gold} /> : <img src={img.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
              ))}
            </div>
          )}

          {auditedPages.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 8 }}>Pages Audited ({auditedPages.length})</div>
              {auditedPages.map((u) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 12.5, color: C.gold, marginBottom: 5, wordBreak: "break-all", textDecoration: "none" }}>
                  {u.replace(/^https?:\/\//, "")}
                </a>
              ))}
            </div>
          )}

          <VisualEvidencePanel screenshot={auditScreenshot} evidence={visualEvidence} />

          {summary.intro && (
            <div style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14, marginBottom: 14 }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 6 }}>Executive Summary</div>
              <p style={{ color: C.textDim, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>{summary.intro}</p>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14 }}>
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 12.5, color: C.low, marginBottom: 8 }}>Key Strengths</div>
              {summary.strengths.length ? summary.strengths.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 7, marginBottom: 7 }}>
                  <Check size={14} color={C.low} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{t}</span>
                </div>
              )) : <EmptyIssueState />}
            </div>
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 12.5, color: C.critical, marginBottom: 8 }}>Key Concerns</div>
              {summary.concerns.length ? summary.concerns.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 7, marginBottom: 7 }}>
                  <AlertCircle size={14} color={C.critical} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{t}</span>
                </div>
              )) : <EmptyIssueState />}
            </div>
          </div>
        </div>
      </div>

      {!isLoggedIn && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <HistoryIcon size={15} color={C.muted} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: C.textDim, flex: 1 }}>Optional: log in to save this audit to your history for later.</span>
          <button onClick={() => onRequireLogin("save")} style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", flexShrink: 0 }}>
            Log in
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "8px 13px", borderRadius: 99, fontSize: 12.5, fontWeight: 500, border: `1px solid ${active ? C.gold : C.border}`, background: active ? C.goldSoft : C.surface, color: active ? C.gold : C.muted, cursor: "pointer", whiteSpace: "nowrap" }}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === "summary" && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 17, margin: "0 0 12px 0" }}>Final Verdict</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Stamp size={20} color={C.gold} style={{ marginTop: 2, flexShrink: 0 }} />
              <p style={{ margin: 0, color: C.textDim, fontSize: 14, lineHeight: 1.6 }}>{scorecard.verdict || "Verdict pending — see Scorecard tab."}</p>
            </div>
          </div>
        )}
        {tab === "usability" && <Section icon={NavIcon} title="Usability Analysis" data={usability} />}
        {tab === "visual" && <Section icon={Palette} title="Visual Design Analysis" data={visual} />}
        {tab === "accessibility" && <Section icon={A11yIcon} title="Accessibility Review" data={accessibility} />}
        {tab === "trust" && <Section icon={ShieldCheck} title="Trust & Credibility Review" data={trust} />}
        {tab === "conversion" && <Section icon={TrendingUp} title="Conversion Optimization Review" data={conversion} />}
        {tab === "cognitive" && <Section icon={Brain} title="Cognitive Load Assessment" data={cognitive} />}

        {tab === "ai" && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 17, margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <Lightbulb size={16} color={C.gold} /> AI Recommendations
            </h3>
            {aiRecommendations ? (
              <p style={{ margin: 0, color: C.textDim, fontSize: 14, lineHeight: 1.65 }}>{aiRecommendations}</p>
            ) : <EmptyIssueState />}
          </div>
        )}

        {tab === "top10" && (
          <div>
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 18, margin: "0 0 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <Trophy size={17} color={C.gold} /> Top 10 UX Improvements
            </h3>
            {top10.length === 0 && <EmptyIssueState />}
            {top10.map((item) => (
              <div key={item.rank} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10, display: "flex", gap: 12 }}>
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 18, color: C.gold, width: 28, flexShrink: 0 }}>{String(item.rank).padStart(2, "0")}</div>
                <div>
                  <p style={{ margin: "0 0 8px 0", color: C.text, fontSize: 14.5, lineHeight: 1.5, fontWeight: 500 }}>{item.recommendation}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.medium, marginBottom: 2 }}>USER BENEFIT</div>
                      <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{item.userBenefit}</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.gold, marginBottom: 2 }}>BUSINESS BENEFIT</div>
                      <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{item.businessBenefit}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "wins" && <ListBlock icon={Zap} title="Quick Wins" subtitle="Under a day of effort" items={quickWins} color={C.low} />}
        {tab === "strategic" && <ListBlock icon={Rocket} title="Strategic Improvements" subtitle="Larger design investment" items={strategic} color={C.gold} />}

        {tab === "scorecard" && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 17, margin: "0 0 16px 0" }}>Final Scorecard</h3>
            <ScoreBar label="Usability" value={scorecard.usability} />
            <ScoreBar label="Accessibility" value={scorecard.accessibility} />
            <ScoreBar label="Visual Design" value={scorecard.visual} />
            <ScoreBar label="Trust" value={scorecard.trust} />
            <ScoreBar label="Conversion" value={scorecard.conversion} />
            <div style={{ height: 1, background: C.border, margin: "14px 0" }} />
            <ScoreBar label="Overall UX Score" value={scorecard.overall} />
            <div style={{ marginTop: 18, padding: "14px 16px", background: C.surfaceAlt, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Stamp size={16} color={C.gold} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 0.6, color: C.gold }}>FINAL VERDICT</span>
              </div>
              <p style={{ margin: 0, color: C.text, fontSize: 14, lineHeight: 1.6 }}>{scorecard.verdict || "—"}</p>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
        <button onClick={onDownload} style={{ ...exportBtnStyle, background: C.now, color: C.dark, borderRadius: 999, border: "none", fontWeight: 600 }}>
          <Download size={14} /> Slide deck & PDF
        </button>
        <a href={mailtoHref} style={{ ...exportBtnStyle, textDecoration: "none" }}>
          <Mail size={13} /> Email report
        </a>
      </div>
      <p style={{ textAlign: "center", fontSize: 11, color: C.muted, marginTop: 8 }}>
        "Slide deck & PDF" opens the deck — present from it directly, or tap "Download PDF" inside to save a real PDF file.  "Email report" opens your mail app with a summary; attach the downloaded PDF yourself, since browsers won't let a webpage attach files automatically.
      </p>
    </div>
  );
}

const exportBtnStyle = {
  display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`,
  color: C.muted, fontSize: 12.5, borderRadius: 8, padding: "8px 14px", cursor: "pointer",
};

/* ----------------------------------------------------------------------- */
/* Printable view (for window.print() → Save as PDF)                       */
/* ----------------------------------------------------------------------- */
/* ----------------------------------------------------------------------- */
/* Standalone HTML deck (for download / share when print is unavailable)    */
/* ----------------------------------------------------------------------- */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDeckHtml(report, source, auditedPages = []) {
  const { summary, usability, visual, accessibility, trust, conversion, cognitive, aiRecommendations, top10, quickWins, strategic, scorecard } = report;
  const srcLabel = source && source.mode === "url" && source.url ? esc(source.url.replace(/^https?:\/\//, "").toUpperCase()) : "SCREEN REVIEW";
  const scoreColor = (v) => (v >= 80 ? C.low : v >= 60 ? C.medium : v >= 40 ? C.high : C.critical);
  const sevColor = (sev) => (SEVERITY_STYLES[sev] || SEVERITY_STYLES.Medium).color;
  const sevBg = (sev) => (SEVERITY_STYLES[sev] || SEVERITY_STYLES.Medium).bg;
  const hasScreenshots = auditScreenshots.length > 0 || !!auditScreenshot;
  const TOTAL = 12 + (hasScreenshots ? 1 : 0) + (auditScreenshot && visualEvidence.length ? visualEvidence.length : 0);
  let n = 0;
  const footer = () => `<div class="ft"><span>NEST AUDIT · ${srcLabel}</span><span>${++n} / ${TOTAL}</span></div>`;

  const issueSlide = (title, data) => {
    const cards = data.issues.slice(0, 3).map((iss) => `
      <div class="card" style="border-top:5px solid ${sevColor(iss.severity)}">
        <div class="cardhead"><div class="ctitle">${esc(iss.title)}</div>
        <span class="sev" style="color:${sevColor(iss.severity)};background:${sevBg(iss.severity)};border-color:${sevColor(iss.severity)}55">${esc(iss.severity).toUpperCase()}</span></div>
        <div><div class="whylabel">Why it matters</div><div class="why">${esc(iss.why)}</div></div>
        <div class="fix"><div class="fixlabel">Recommendation</div>${esc(iss.recommendation)}</div>
      </div>`).join("");
    return `<section class="slide"><div class="kicker">Findings</div><h2>${esc(title)}</h2><div class="rule"></div>
      <div class="cards">${cards || '<p class="empty">No structured findings for this area.</p>'}</div>${footer()}</section>`;
  };

  const bars = [["Usability", scorecard.usability], ["Accessibility", scorecard.accessibility], ["Visual Design", scorecard.visual], ["Trust", scorecard.trust], ["Conversion", scorecard.conversion], ["Overall", scorecard.overall]]
    .map(([label, v]) => `
      <div class="bar-row"><span class="bar-label"${label === "Overall" ? ' style="font-weight:700"' : ""}>${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${v ?? 0}%;background:${scoreColor(v ?? 0)}"></div></div>
      <span class="bar-val">${v ?? "—"}</span></div>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nest Audit Report — ${srcLabel}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
* { box-sizing: border-box; margin: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
body { background: #555; font-family: 'Inter', sans-serif; color: ${C.text}; }
.hint { text-align:center; color:#fff; font-size:13px; padding:14px; }
.slide { width: 296mm; height: 166mm; background: ${C.goldSoft}; border: 1.2mm solid ${C.gold}; margin: 6mm auto; padding: 14mm 16mm; position: relative; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 4px 18px rgba(0,0,0,.28); }
.kicker { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 10pt; letter-spacing: 2px; color: ${C.gold}; margin-bottom: 3mm; text-transform: uppercase; }
h2 { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 26pt; margin-bottom: 3mm; color: ${C.dark}; letter-spacing: -0.5pt; }
.rule { width: 26mm; height: 1.2mm; background: ${C.gold}; border-radius: 99px; margin-bottom: 6mm; }
.ft { position: absolute; bottom: 8mm; left: 16mm; right: 16mm; display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: ${C.muted}; }
.cards { display: flex; gap: 6mm; flex: 1; }
.card { flex: 1; background: #FFFFFF; border: 0.4mm solid ${C.gold}; border-radius: 3mm; padding: 6mm; display: flex; flex-direction: column; gap: 3mm; }
.cardhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm; }
.ctitle { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 12pt; line-height: 1.25; color: ${C.dark}; }
.sev { font-family: 'IBM Plex Mono', monospace; font-size: 7.5pt; border: 1px solid; border-radius: 99px; padding: 1mm 3mm; white-space: nowrap; }
.why { font-size: 9pt; line-height: 1.45; color: ${C.textDim}; }
.whylabel { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 8pt; letter-spacing: 0.5px; color: ${C.muted}; margin-bottom: 1.5mm; text-transform: uppercase; }
.fix { margin-top: auto; border-top: 0.3mm solid ${C.border}; padding-top: 3.5mm; font-size: 9pt; line-height: 1.4; }
.fixlabel { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 8pt; letter-spacing: 0.5px; color: ${C.gold}; margin-bottom: 1.5mm; text-transform: uppercase; }
.empty { color: ${C.muted}; font-style: italic; }
.cols { display: flex; gap: 8mm; flex: 1; }
.panel { flex: 1; border-radius: 3mm; padding: 6mm; background: #FFFFFF; border: 0.4mm solid ${C.gold}; }
.plabel { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 8.5pt; letter-spacing: 1px; margin-bottom: 3mm; text-transform: uppercase; }
.li { font-size: 10.5pt; line-height: 1.4; margin-bottom: 3mm; display: flex; gap: 2.5mm; }
.grid10 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; flex: 1; align-content: start; }
.t10 { display: flex; gap: 3mm; align-items: baseline; border-bottom: 1px solid ${C.borderSoft}; padding-bottom: 2.5mm; }
.rank { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 13pt; color: ${C.gold}; min-width: 7mm; }
.t10 span:last-child { font-size: 9.5pt; line-height: 1.35; }
.bar-row { display: flex; align-items: center; gap: 5mm; margin-bottom: 5mm; }
.bar-label { width: 38mm; font-size: 10.5pt; }
.bar-track { flex: 1; height: 5mm; background: #FFFFFF; border: 0.3mm solid ${C.border}; border-radius: 99px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 99px; }
.bar-val { font-family: 'IBM Plex Mono', monospace; font-size: 10.5pt; width: 16mm; text-align: right; }
.center { justify-content: center; align-items: center; text-align: center; }
.bigscore { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 68pt; }
.disc { position: absolute; bottom: 16mm; left: 16mm; right: 16mm; font-size: 7.5pt; color: ${C.muted}; line-height: 1.4; }
@media print {
  @page { size: 296mm 166mm; margin: 0; }
  body { background: none; }
  .hint { display: none; }
  .slide { margin: 0; box-shadow: none; page-break-after: always; }
}
</style></head><body>
<div class="hint">To make this a PDF: open your browser's menu → Print → choose "Save as PDF".</div>

<section class="slide center">
  <div class="kicker">Senior UX Review</div>
  <div style="font-family:'Plus Jakarta Sans',sans-serif;font-weight:600;font-size:40pt;margin-bottom:4mm">Nest Audit Report</div>
  <div style="font-family:'IBM Plex Mono',monospace;font-size:11pt;color:${C.textDim};margin-bottom:10mm">${srcLabel}</div>
  <div><span class="bigscore" style="color:${scoreColor(summary.score ?? 0)}">${summary.score ?? "—"}</span>
  <span style="font-size:16pt;color:${C.muted}">/100 · ${esc(summary.assessment ?? "Unrated")}</span></div>
  ${footer()}
</section>

<section class="slide">
  <div class="kicker">Overview</div><h2>Executive Summary</h2><div class="rule"></div>
  <p style="font-size:11pt;line-height:1.55;color:${C.textDim};max-width:220mm;margin-bottom:6mm">${esc(summary.intro)}</p>
  <div class="cols">
    <div class="panel" style="border-color:${C.low}"><div class="plabel" style="color:${C.low}">TOP STRENGTHS</div>
      ${summary.strengths.map((s) => `<div class="li"><span style="color:${C.low}">▸</span><span>${esc(s)}</span></div>`).join("")}</div>
    <div class="panel" style="border-color:${C.critical}"><div class="plabel" style="color:${C.critical}">TOP CONCERNS</div>
      ${summary.concerns.map((s) => `<div class="li"><span style="color:${C.critical}">▸</span><span>${esc(s)}</span></div>`).join("")}</div>
  </div>
  ${footer()}
</section>

${issueSlide("Usability", usability)}
${issueSlide("Visual Design", visual)}
${issueSlide("Accessibility", accessibility)}
${issueSlide("Trust & Credibility", trust)}
${issueSlide("Conversion", conversion)}
${issueSlide("Cognitive Load", cognitive)}

<section class="slide">
  <div class="kicker">Priorities</div><h2>Top 10 Improvements</h2><div class="rule"></div>
  <div class="grid10">${top10.slice(0, 10).map((t) => `<div class="t10"><span class="rank">${String(t.rank).padStart(2, "0")}</span><span>${esc(t.recommendation)}</span></div>`).join("")}</div>
  ${footer()}
</section>

<section class="slide">
  <div class="kicker">Roadmap</div><h2>Quick Wins vs. Strategic Bets</h2><div class="rule"></div>
  <div class="cols">
    <div class="panel"><div class="plabel" style="color:${C.low}">QUICK WINS · UNDER A DAY</div>
      ${quickWins.slice(0, 6).map((q) => `<div class="li" style="font-size:10pt"><span style="color:${C.low}">✓</span><span>${esc(q)}</span></div>`).join("")}</div>
    <div class="panel"><div class="plabel" style="color:${C.gold}">STRATEGIC · REAL DESIGN EFFORT</div>
      ${strategic.slice(0, 6).map((s) => `<div class="li" style="font-size:10pt"><span style="color:${C.gold}">◆</span><span>${esc(s)}</span></div>`).join("")}</div>
  </div>
  ${footer()}
</section>

${auditedPages.length ? `<section class="slide">
  <div class="kicker">Scope</div><h2>Pages Audited</h2><div class="rule"></div>
  <div class="grid10">${auditedPages.map((u, i) => `<div class="t10"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span>${esc(u.replace(/^https?:\/\//, ""))}</span></div>`).join("")}</div>
</section>` : ""}

<section class="slide">
  <div class="kicker">Scorecard</div><h2>Final Scores</h2><div class="rule"></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;max-width:230mm">${bars}</div>
  ${footer()}
</section>

<section class="slide" style="justify-content:center">
  <div class="kicker">Decision</div><h2>Final Verdict</h2><div class="rule"></div>
  <p style="font-size:13pt;line-height:1.6;max-width:220mm;margin-bottom:6mm">${esc(scorecard.verdict || "—")}</p>
  ${aiRecommendations ? `<div class="panel" style="max-width:230mm;flex:none"><div class="plabel" style="color:${C.gold}">WHERE TO INVEST NEXT</div><p style="font-size:10pt;line-height:1.5;color:${C.textDim}">${esc(aiRecommendations)}</p></div>` : ""}
  <p class="disc">AI-generated analysis by UXNest. Not a certified accessibility audit, legal advice, or professional UX research. Validate critical findings with qualified professionals.</p>
  ${footer()}
</section>
</body></html>`;
}

const SLIDE = {
  page: {
    width: "296mm", height: "166mm", boxSizing: "border-box", padding: "14mm 16mm",
    background: "#FCFBF8", color: C.text, pageBreakAfter: "always", position: "relative",
    fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: "hidden", display: "flex", flexDirection: "column",
    border: "0.3mm solid #E7E1D8", boxShadow: "inset 0 3mm 0 #F3EEE5",
  },
  kicker: { display: "inline-flex", alignSelf: "flex-start", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: "8pt", letterSpacing: 1.4, color: C.gold, background: C.goldSoft, border: `0.3mm solid ${C.gold}33`, borderRadius: 99, padding: "1.3mm 3mm", marginBottom: "3.5mm", textTransform: "uppercase" },
  title: { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: "28pt", margin: "0 0 3.5mm 0", color: C.dark, letterSpacing: "-0.8pt", lineHeight: 1.05 },
  rule: { width: "30mm", height: "1mm", background: `linear-gradient(90deg, ${C.gold}, ${C.now})`, borderRadius: 99, marginBottom: "6mm" },
  footer: { position: "absolute", bottom: "7mm", left: "16mm", right: "16mm", paddingTop: "3mm", borderTop: "0.25mm solid #E8E2D9", display: "flex", justifyContent: "space-between", fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 0.35, color: C.muted },
};

function SlideIconBadge({ icon: Icon, size = 14, theme = REPORT_THEME_FALLBACK }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "9mm", height: "9mm", borderRadius: `${Math.max(8, Math.min(theme.radius || 14, 24))}px`, background: theme.primary || C.gold, flexShrink: 0 }}>
      <Icon size={size} color="#FFFFFF" />
    </span>
  );
}

function SlideFooter({ n, total, sourceLabel, theme = REPORT_THEME_FALLBACK }) {
  return (
    <div style={{ ...SLIDE.footer, color: theme.muted, borderTopColor: theme.border }}>
      <span>NEST AUDIT · {sourceLabel}</span>
      <span>{n} / {total}</span>
    </div>
  );
}

function SevChip({ severity }) {
  const s = SEVERITY_STYLES[severity] || SEVERITY_STYLES.Medium;
  return (
    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", color: s.color, background: s.bg, border: `1px solid ${s.color}55`, borderRadius: 99, padding: "1mm 3mm", whiteSpace: "nowrap" }}>
      {severity.toUpperCase()}
    </span>
  );
}

function IssueSlide({ title, data, n, total, sourceLabel, icon, theme = REPORT_THEME_FALLBACK }) {
  const T = theme || REPORT_THEME_FALLBACK;
  const issues = data.issues.slice(0, 3);
  return (
    <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
      <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Findings</div>
      <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>{title}</h2>
      <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
      <div style={{ display: "flex", gap: "6mm", flex: 1 }}>
        {issues.length === 0 && <p style={{ color: C.muted, fontStyle: "italic" }}>No structured findings for this area.</p>}
        {issues.map((iss, i) => (
          <div key={i} style={{ flex: 1, background: T.surface, border: `0.3mm solid ${T.border}`, borderTop: `1.2mm solid ${(SEVERITY_STYLES[iss.severity] || SEVERITY_STYLES.Medium).color}`, borderRadius: `${T.radius || 14}px`, padding: T.density === "assertive" ? "6.5mm" : "6mm", display: "flex", flexDirection: "column", gap: "3mm", boxShadow: T.cardShadow || "0 2mm 6mm rgba(30,43,40,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "3mm" }}>
              <div style={{ fontWeight: 800, fontSize: `${12 * (T.titleScale || 1)}pt`, lineHeight: 1.25, color: T.text }}>{iss.title}</div>
              <SevChip severity={iss.severity} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "8pt", letterSpacing: 0.5, color: T.muted, marginBottom: "1mm", textTransform: "uppercase" }}>Why it matters</div>
              <div style={{ fontSize: "9pt", lineHeight: 1.45, color: T.textDim }}>{iss.why}</div>
            </div>
            <div style={{ marginTop: "auto", borderTop: `0.3mm solid ${T.border}`, paddingTop: "3mm", display: "flex", gap: "3mm", alignItems: "flex-start" }}>
              <SlideIconBadge icon={Check} size={12} theme={T} />
              <div>
                <div style={{ fontWeight: 800, fontSize: "8pt", letterSpacing: 0.5, color: T.primary, marginBottom: "1mm", textTransform: "uppercase" }}>Recommendation</div>
                <div style={{ fontSize: "9pt", lineHeight: 1.4, color: T.text }}>{iss.recommendation}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <SlideFooter n={n} total={total} sourceLabel={sourceLabel} theme={T} />
    </div>
  );
}

function EvidenceFocusSlide({ screenshot, item, index, n, total, sourceLabel, issue, theme = REPORT_THEME_FALLBACK }) {
  const T = theme || REPORT_THEME_FALLBACK;
  const severity = issue?.severity || "Medium";
  const sev = SEVERITY_STYLES[severity] || SEVERITY_STYLES.Medium;
  const cx = Number.isFinite(Number(item.cx)) ? Number(item.cx) : 50;
  const cy = Number.isFinite(Number(item.cy)) ? Number(item.cy) : 50;
  const tight = Math.max(3, Math.min(6, Number(item.radius) || 4.5));

  return (
    <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
      <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>
        Evidence · Finding {index + 1}
      </div>
      <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${27 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>
        {item.issueTitle}
      </h2>
      <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />

      <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.9fr", gap: "8mm", flex: 1, minHeight: 0 }}>
        <div style={{ position: "relative", minHeight: 0, overflow: "hidden", borderRadius: `${Math.max(8, T.radius || 14)}px`, border: `0.4mm solid ${T.border}`, background: T.surface, boxShadow: T.cardShadow }}>
          <img
            src={screenshot}
            alt={`Focused evidence for finding ${index + 1}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: `${cx}% ${cy}%`, display: "block" }}
          />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: `${Math.max(26, tight * 7)}mm`, height: `${Math.max(26, tight * 7)}mm`, transform: "translate(-50%, -50%)", border: `1mm solid ${sev.color}`, borderRadius: "50%", boxShadow: "0 0 0 0.6mm rgba(255,255,255,.96), 0 2mm 7mm rgba(0,0,0,.24)", pointerEvents: "none" }}>
            <span style={{ position: "absolute", left: "-2mm", top: "-2mm", width: "9mm", height: "9mm", transform: "translate(-28%, -28%)", borderRadius: "50%", background: sev.color, color: "#fff", border: "0.7mm solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "9pt", fontWeight: 800 }}>
              {index + 1}
            </span>
          </div>
          <div style={{ position: "absolute", left: "6mm", bottom: "6mm", background: "rgba(15,22,20,.82)", color: "#fff", padding: "2.2mm 3.5mm", borderRadius: "99px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: .7 }}>
            ZOOMED EVIDENCE · TARGET CENTERED
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4mm", minHeight: 0 }}>
          <div style={{ padding: "5mm", borderRadius: `${T.radius || 14}px`, background: T.surface, border: `0.3mm solid ${T.border}`, boxShadow: T.cardShadow }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "3mm", marginBottom: "3mm" }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 1, color: T.primary }}>THE FINDING</span>
              <SevChip severity={severity} />
            </div>
            <div style={{ fontSize: "14pt", fontWeight: T.titleWeight || 800, lineHeight: 1.25, color: T.text }}>{item.issueTitle}</div>
          </div>

          <div style={{ padding: "5mm", borderRadius: `${T.radius || 14}px`, background: T.soft, border: `0.3mm solid ${T.border}` }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 1, color: T.primary, marginBottom: "2mm" }}>WHAT THE CIRCLE POINTS TO</div>
            <div style={{ fontSize: "10pt", lineHeight: 1.5, color: T.text }}>{item.explanation}</div>
          </div>

          {issue?.why && (
            <div style={{ padding: "0 1mm" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 1, color: T.muted, marginBottom: "2mm" }}>WHY IT MATTERS</div>
              <div style={{ fontSize: "9.5pt", lineHeight: 1.5, color: T.textDim }}>{issue.why}</div>
            </div>
          )}

          {issue?.recommendation && (
            <div style={{ marginTop: "auto", padding: "5mm", borderRadius: `${T.radius || 14}px`, background: T.surface, border: `0.3mm solid ${T.border}`, borderLeft: `1.4mm solid ${T.primary}` }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 1, color: T.primary, marginBottom: "2mm" }}>RECOMMENDED IMPROVEMENT</div>
              <div style={{ fontSize: "9.5pt", lineHeight: 1.5, color: T.text }}>{issue.recommendation}</div>
            </div>
          )}
        </div>
      </div>

      <SlideFooter n={n} total={total} sourceLabel={sourceLabel} theme={T} />
    </div>
  );
}

function DeckSlides({ report, source, auditedPages = [], auditScreenshot = null, auditScreenshots = [], visualEvidence = [], theme = REPORT_THEME_FALLBACK }) {
  if (!report) return null;
  const T = theme || REPORT_THEME_FALLBACK;
  const { summary, usability, visual, accessibility, trust, conversion, cognitive, aiRecommendations, top10, quickWins, strategic, scorecard } = report;
  const sourceLabel = source && source.mode === "url" && source.url ? source.url.replace(/^https?:\/\//, "").toUpperCase() : "SCREEN REVIEW";
  const scoreColor = (v) => (v >= 80 ? C.low : v >= 60 ? C.medium : v >= 40 ? C.high : C.critical);
  const hasScreenshots = auditScreenshots.length > 0 || !!auditScreenshot;
  const TOTAL = 12 + (hasScreenshots ? 1 : 0) + (auditScreenshot && visualEvidence.length ? visualEvidence.length : 0);
  let n = 0;
  const next = () => ++n;

  return (
    <div>
      {/* 1 — Title */}
      <div className="deck-slide" style={{ ...SLIDE.page, background: `linear-gradient(135deg, ${T.coverStart} 0%, ${T.coverEnd} 100%)`, color: "#FFFFFF", border: "none", boxShadow: "none", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ position: "absolute", width: T.ornament === "bubble" || T.ornament === "blob" ? "110mm" : "96mm", height: T.ornament === "bubble" || T.ornament === "blob" ? "110mm" : "62mm", borderRadius: T.ornament === "block" ? "8mm" : T.ornament === "frame" ? "0" : "50%", border: T.ornament === "line" ? "0.5mm solid rgba(255,255,255,0.13)" : "0.5mm solid rgba(255,255,255,0.08)", right: "-25mm", top: "-42mm", transform: T.ornament === "block" ? "rotate(14deg)" : "none" }} />
        <div style={{ position: "absolute", width: T.ornament === "grid" ? "74mm" : "70mm", height: T.ornament === "grid" ? "74mm" : "70mm", borderRadius: T.ornament === "block" ? "7mm" : T.ornament === "frame" ? "0" : "50%", background: T.ornament === "line" ? "transparent" : "rgba(255,255,255,0.035)", border: T.ornament === "grid" ? "0.5mm solid rgba(255,255,255,0.07)" : "none", left: "-18mm", bottom: "-22mm" }} />
        <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, position: "relative", zIndex: 1 }}>
          <div style={{ ...SLIDE.kicker, marginBottom: 0, lineHeight: 1.2, color: C.now, background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)" }}>Senior UX Review · {T.descriptor || "ADAPTIVE SYSTEM"}</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: T.titleWeight || 800, fontSize: 58 * (T.titleScale || 1), lineHeight: 1.02, color: "#FFFFFF", whiteSpace: "nowrap", letterSpacing: T.letterSpacing || "-1.5pt" }}>UXNest Audit Report</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, lineHeight: 1.3, color: "#BFD8D2", maxWidth: "190mm", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sourceLabel}</div>
          <div style={{ marginTop: 10, padding: "8mm 13mm", minWidth: "92mm", borderRadius: `${T.radius || 14}px`, background: "rgba(255,255,255,0.08)", border: "0.35mm solid rgba(255,255,255,0.16)", backdropFilter: "blur(6px)" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 1.3, color: "#9CCFC5", marginBottom: "2mm" }}>OVERALL UX SCORE</div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 10, lineHeight: 1 }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 92, lineHeight: 0.9, color: "#FFFFFF" }}>{summary.score ?? "—"}</span>
              <span style={{ fontSize: 18, color: "#BFD8D2", whiteSpace: "nowrap" }}>/100</span>
            </div>
            <div style={{ marginTop: "3mm", fontSize: 12, fontWeight: 700, color: scoreColor(summary.score ?? 0), textTransform: "uppercase", letterSpacing: 0.8 }}>{summary.assessment ?? "Unrated"}</div>
          </div>
        </div>
        <div style={{ ...SLIDE.footer, color: "#9CCFC5", borderTopColor: "rgba(255,255,255,0.12)" }}><span>UXNEST · {sourceLabel}</span><span>{next()} / {TOTAL}</span></div>
      </div>

      {/* 2 — Executive Summary */}
      <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
        <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Overview</div>
        <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Executive Summary</h2>
        <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
        <p style={{ fontSize: "11pt", lineHeight: 1.55, color: C.textDim, maxWidth: "220mm", margin: "0 0 5mm 0" }}>{summary.intro}</p>
        {source?.mode === "url" && (
          <div style={{ background: C.surfaceAlt, border: `0.35mm solid ${C.border}`, borderRadius: "2.5mm", padding: "3.5mm 4mm", marginBottom: "5mm", maxWidth: "240mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", letterSpacing: 0.8, color: C.gold, marginBottom: "2mm" }}>PAGES TESTED IN THIS AUDIT</div>
            {auditedPages.length > 0 ? auditedPages.map((url) => (
              <div key={url} style={{ fontSize: "8.5pt", color: C.textDim, lineHeight: 1.45, wordBreak: "break-all" }}>• {url}</div>
            )) : (
              <div style={{ fontSize: "8.5pt", color: C.muted }}>No individual page list was captured for this legacy audit.</div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: "8mm", flex: 1 }}>
          <div style={{ flex: 1, background: "#FFFFFF", border: `0.4mm solid ${C.low}`, borderRadius: "3mm", padding: "6mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8pt", letterSpacing: 1, color: C.low, marginBottom: "3mm" }}>TOP STRENGTHS</div>
            {summary.strengths.map((s, i) => (
              <div key={i} style={{ fontSize: "10.5pt", lineHeight: 1.4, marginBottom: "3mm", display: "flex", gap: "2.5mm" }}><span style={{ color: C.low }}>▸</span><span>{s}</span></div>
            ))}
          </div>
          <div style={{ flex: 1, background: "#FFFFFF", border: `0.4mm solid ${C.critical}`, borderRadius: "3mm", padding: "6mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8pt", letterSpacing: 1, color: C.critical, marginBottom: "3mm" }}>TOP CONCERNS</div>
            {summary.concerns.map((s, i) => (
              <div key={i} style={{ fontSize: "10.5pt", lineHeight: 1.4, marginBottom: "3mm", display: "flex", gap: "2.5mm" }}><span style={{ color: C.critical }}>▸</span><span>{s}</span></div>
            ))}
          </div>
        </div>
        <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      </div>

      {/* 3–8 — Section slides */}
      <IssueSlide icon={NavIcon} title="Usability" data={usability} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      <IssueSlide icon={Palette} title="Visual Design" data={visual} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      <IssueSlide icon={A11yIcon} title="Accessibility" data={accessibility} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      <IssueSlide icon={ShieldCheck} title="Trust & Credibility" data={trust} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      <IssueSlide icon={TrendingUp} title="Conversion" data={conversion} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      <IssueSlide icon={Brain} title="Cognitive Load" data={cognitive} n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />

      {/* Pages reviewed — visual record of the URLs actually tested */}
      {hasScreenshots && (
        <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
          <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Audit Coverage</div>
          <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Pages Reviewed</h2>
          <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
          <div style={{ fontSize: "10pt", color: C.textDim, marginBottom: "5mm" }}>Visual snapshots of the live pages UXNest retrieved and used as evidence for this audit.</div>
          <div style={{ display: "grid", gridTemplateColumns: (auditScreenshots.length || 1) > 1 ? "1fr 1fr" : "1fr", gap: "6mm", flex: 1, alignContent: "start" }}>
            {(auditScreenshots.length ? auditScreenshots : [{ url: source?.url || "", screenshot: auditScreenshot }]).slice(0, 3).map((item, index) => (
              <div key={item.url || index} style={{ border: "0.3mm solid #E5DED4", borderRadius: "4mm", overflow: "hidden", background: "#FFFFFF", boxShadow: "0 2mm 6mm rgba(30,43,40,0.06)" }}>
                <div style={{ height: "82mm", background: C.surfaceAlt, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "hidden" }}>
                  <img src={item.screenshot} alt={"Audited page " + (index + 1)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }} />
                </div>
                <div style={{ padding: "3.5mm 4mm", fontFamily: "'IBM Plex Mono', monospace", fontSize: "7.5pt", color: C.textDim, wordBreak: "break-all" }}>
                  {item.url || "Audited page"}
                </div>
              </div>
            ))}
          </div>
          <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
        </div>
      )}

      {/* 9 — Top 10 */}
      <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
        <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Priorities</div>
        <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Top 10 Improvements</h2>
        <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3mm 8mm", flex: 1, alignContent: "start" }}>
          {top10.slice(0, 10).map((t) => (
            <div key={t.rank} style={{ display: "flex", gap: "3mm", alignItems: "baseline", borderBottom: `1px solid ${C.borderSoft}`, paddingBottom: "2.5mm" }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: "13pt", color: C.gold, minWidth: "7mm" }}>{String(t.rank).padStart(2, "0")}</span>
              <span style={{ fontSize: "9.5pt", lineHeight: 1.35 }}>{t.recommendation}</span>
            </div>
          ))}
        </div>
        <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      </div>

      {/* 10 — Roadmap */}
      <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
        <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Roadmap</div>
        <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Quick Wins vs. Strategic Bets</h2>
        <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
        <div style={{ display: "flex", gap: "8mm", flex: 1 }}>
          <div style={{ flex: 1, background: "#FFFFFF", border: `0.4mm solid ${C.gold}`, borderRadius: "3mm", padding: "6mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8pt", letterSpacing: 1, color: C.low, marginBottom: "3mm" }}>QUICK WINS · UNDER A DAY</div>
            {quickWins.slice(0, 6).map((q, i) => (
              <div key={i} style={{ fontSize: "10pt", lineHeight: 1.4, marginBottom: "3mm", display: "flex", gap: "2.5mm" }}><span style={{ color: C.low }}>✓</span><span>{q}</span></div>
            ))}
          </div>
          <div style={{ flex: 1, background: "#FFFFFF", border: `0.4mm solid ${C.gold}`, borderRadius: "3mm", padding: "6mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8pt", letterSpacing: 1, color: C.gold, marginBottom: "3mm" }}>STRATEGIC · REAL DESIGN EFFORT</div>
            {strategic.slice(0, 6).map((s, i) => (
              <div key={i} style={{ fontSize: "10pt", lineHeight: 1.4, marginBottom: "3mm", display: "flex", gap: "2.5mm" }}><span style={{ color: C.gold }}>◆</span><span>{s}</span></div>
            ))}
          </div>
        </div>
        <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      </div>

      {/* 11 — Scorecard */}
      <div className="deck-slide" style={{ ...SLIDE.page, background: T.background, color: T.text, borderColor: T.border, boxShadow: `inset 0 3mm 0 ${T.soft}` }}>
        <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Scorecard</div>
        <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Final Scores</h2>
        <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "5mm", maxWidth: "230mm" }}>
          {[["Usability", scorecard.usability], ["Accessibility", scorecard.accessibility], ["Visual Design", scorecard.visual], ["Trust", scorecard.trust], ["Conversion", scorecard.conversion], ["Overall", scorecard.overall]].map(([label, v]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "5mm" }}>
              <span style={{ width: "38mm", fontSize: "10.5pt", fontWeight: label === "Overall" ? 700 : 500 }}>{label}</span>
              <div style={{ flex: 1, height: "5mm", background: C.surfaceAlt, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${v ?? 0}%`, height: "100%", background: scoreColor(v ?? 0), borderRadius: 99 }} />
              </div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10.5pt", width: "16mm", textAlign: "right" }}>{v ?? "—"}</span>
            </div>
          ))}
        </div>
        <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      </div>

      {/* Focused visual evidence — one finding per slide so the UI is readable at presentation size */}
      {auditScreenshot && visualEvidence.length > 0 && (() => {
        const allIssues = [
          ...(usability?.issues || []),
          ...(visual?.issues || []),
          ...(accessibility?.issues || []),
          ...(trust?.issues || []),
          ...(conversion?.issues || []),
          ...(cognitive?.issues || []),
        ];
        return visualEvidence.map((item, index) => {
          const issue = item.findingIndex
            ? allIssues[item.findingIndex - 1]
            : allIssues.find((candidate) => candidate.title === item.issueTitle);
          return (
            <EvidenceFocusSlide
              key={item.id || index}
              screenshot={auditScreenshot}
              item={item}
              index={index}
              n={next()}
              total={TOTAL}
              sourceLabel={sourceLabel}
              issue={issue}
              theme={T}
            />
          );
        });
      })()}

      <div className="deck-slide" style={{ ...SLIDE.page, justifyContent: "center" }}>
        <div style={{ ...SLIDE.kicker, color: T.primary, background: T.soft, borderColor: T.border, borderRadius: `${Math.min(T.radius || 14, 18)}px` }}>Decision</div>
        <h2 style={{ ...SLIDE.title, color: T.text, fontWeight: T.titleWeight || 800, fontSize: `${28 * (T.titleScale || 1)}pt`, letterSpacing: T.letterSpacing || "-0.8pt" }}>Final Verdict</h2>
        <div style={{ ...SLIDE.rule, width: T.personality === "minimal" ? "22mm" : T.personality === "bold" ? "40mm" : "30mm", height: T.personality === "bold" ? "1.6mm" : "1mm", background: `linear-gradient(90deg, ${T.primary}, ${T.accent})`, borderRadius: `${Math.max(2, Math.min(T.radius || 14, 18))}px` }} />
        <p style={{ fontSize: "13pt", lineHeight: 1.6, color: C.text, maxWidth: "220mm", margin: "0 0 6mm 0" }}>{scorecard.verdict || "—"}</p>
        {aiRecommendations && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "3mm", padding: "6mm", maxWidth: "230mm" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8pt", letterSpacing: 1, color: C.gold, marginBottom: "2.5mm" }}>WHERE TO INVEST NEXT</div>
            <p style={{ fontSize: "10pt", lineHeight: 1.5, color: C.textDim, margin: 0 }}>{aiRecommendations}</p>
          </div>
        )}
        <p style={{ position: "absolute", bottom: "16mm", left: "16mm", right: "16mm", fontSize: "7.5pt", color: C.muted, lineHeight: 1.4 }}>
          AI-generated analysis by UXNest. Not a certified accessibility audit, legal advice, or professional UX research. Validate critical findings with qualified professionals.
        </p>
        <SlideFooter n={next()} total={TOTAL} sourceLabel={sourceLabel} theme={T} />
      </div>
    </div>
  );
}

function PrintableReport({ report, source, auditedPages = [], auditScreenshot = null, auditScreenshots = [], visualEvidence = [], theme = REPORT_THEME_FALLBACK }) {
  if (!report) return null;
  return (
    <div id="uxnest-print-area" className="print-only">
      <DeckSlides report={report} source={source} auditedPages={auditedPages} auditScreenshot={auditScreenshot} auditScreenshots={auditScreenshots} visualEvidence={visualEvidence} theme={theme} />
    </div>
  );
}

/* Fullscreen in-app deck viewer: slides scaled to the device width so users
   can present or screenshot directly, since sandboxed iframes block both
   window.print() and file downloads on some platforms. */
function DeckViewer({ report, source, auditedPages = [], auditScreenshot = null, auditScreenshots = [], visualEvidence = [], theme = REPORT_THEME_FALLBACK, onClose, onTryPrint, exporting }) {
  const [scale, setScale] = useState(0.3);
  const SLIDE_W = 1119; // 296mm at 96dpi
  useEffect(() => {
    const compute = () => setScale(Math.min((window.innerWidth - 16) / SLIDE_W, 1));
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: theme.coverStart, zIndex: 100, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: theme.coverStart, backdropFilter: "blur(4px)" }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 1, color: "#E8F0ED" }}>BRAND-ADAPTIVE · {theme.personality || "corporate"} · {theme.confidence === "image" ? "STYLE EXTRACTED FROM AUDITED SCREEN" : "UXNEST FALLBACK"} · PINCH OR ROTATE TO ZOOM</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onTryPrint} style={{ background: C.now, color: C.dark, borderRadius: 999, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Print / Save PDF
          </button>
          <button onClick={onClose} style={{ background: "transparent", color: "#D8CBB6", border: "1px solid #6B5D4D", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
      <div style={{ width: exporting ? SLIDE_W : SLIDE_W * scale, margin: "10px auto 40px" }}>
        <div className="deck-scale" style={{ transform: exporting ? "none" : `scale(${scale})`, transformOrigin: "top left", width: SLIDE_W }}>
          <div className="deck-screen">
            <DeckSlides report={report} source={source} auditedPages={auditedPages} auditScreenshot={auditScreenshot} auditScreenshots={auditScreenshots} visualEvidence={visualEvidence} theme={theme} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* History panel                                                           */
/* ----------------------------------------------------------------------- */
function HistoryPanel({ entries, onOpen, onClose, loading }) {
  return (
    <Modal onClose={onClose} maxWidth={460}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <HistoryIcon size={18} color={C.gold} />
        <h3 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, color: C.text }}>Saved audits</h3>
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 20, color: C.muted }}>
          <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : entries.length === 0 ? (
        <p style={{ fontSize: 13, color: C.muted }}>No saved audits yet — run one while logged in to see it here.</p>
      ) : (
        entries.map((e) => (
          <button
            key={e.id}
            onClick={() => onOpen(e)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
              textAlign: "left", background: C.raised, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "11px 13px", marginBottom: 8, cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 500, marginBottom: 2 }}>
                {e.mode === "url" ? e.url : `${e.screenCount} screen${e.screenCount === 1 ? "" : "s"}`}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>{new Date(e.date).toLocaleDateString()} · {e.assessment || "Unrated"}</div>
            </div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 18, color: C.gold }}>{e.score ?? "—"}</div>
          </button>
        ))
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------------------- */
/* Root App                                                                 */
/* ----------------------------------------------------------------------- */
/* ----------------------------------------------------------------------- */
/* Marketing landing page                                                   */
/* ----------------------------------------------------------------------- */
const FEATURES = [
  { icon: ImageIcon, img: "/images/feature-screenshots.jpg", title: "Screenshot Analysis", desc: "Upload up to 5 screens (20 on Pro) for a full visual UX review." },
  { icon: FileType2, img: "/images/feature-pdf.jpg", title: "PDF Upload", desc: "Submit design documents, wireframes, or prototypes as PDFs." },
  { icon: Globe, img: "/images/feature-url.jpg", title: "URL Crawl & Review", desc: "Enter a URL and UXNest explores the top pages for a site-wide audit." },
  { icon: FileText, img: "/images/feature-reports.jpg", title: "Structured Reports", desc: "Findings across usability, accessibility, visual design, trust & conversion." },
  { icon: Lightbulb, img: "/images/feature-ai.jpg", title: "AI Recommendations", desc: "Prioritized, actionable recommendations ranked by impact." },
  { icon: Download, img: "/images/feature-deck.jpg", title: "Slide-Deck Report", desc: "A 12-slide presentation deck ready to share with your team." },
];

const DIMENSIONS = [
  { icon: NavIcon, img: "/images/dim-usability.jpg", title: "Usability", desc: "Navigation, task completion, user flow analysis" },
  { icon: Palette, img: "/images/dim-visualdesign.jpg", title: "Visual Design", desc: "Layout, typography, color, and visual hierarchy" },
  { icon: A11yIcon, img: "/images/dim-accessibility.jpg", title: "Accessibility", desc: "WCAG compliance and inclusive design standards" },
  { icon: ShieldCheck, img: "/images/dim-trust.jpg", title: "Trust & Credibility", desc: "Security signals, social proof, and brand perception" },
  { icon: TrendingUp, img: "/images/dim-conversion.jpg", title: "Conversion", desc: "CTA effectiveness, friction points, and persuasion patterns" },
  { icon: Brain, img: "/images/dim-cognitive.jpg", title: "Cognitive Load", desc: "Information density, mental models, and user comprehension" },
];

const STEPS = [
  { n: "01", title: "Accept Terms", desc: "Review and accept our disclaimer before submitting." },
  { n: "02", title: "Upload or Enter URL", desc: "Add screenshots, a PDF, or a website URL to analyze." },
  { n: "03", title: "AI Analyzes", desc: "The engine performs a deep multi-framework UX audit." },
  { n: "04", title: "Get Your Report", desc: "View the report online and export the slide deck." },
];

const SUITES = [
  { icon: Users, title: "Nest Research", desc: "Uncover user insights with AI-powered research tools.", tools: ["Persona Generator", "Journey Maps", "Interview Summaries", "Survey Analysis"] },
  { icon: Palette, title: "Nest Design", desc: "Elevate your design with AI critique and consistency checks.", tools: ["AI Design Critic", "Design Review", "Design System Checker", "UI Consistency Checker"] },
  { icon: BarChart3, title: "Nest Strategy", desc: "Make data-driven strategic decisions with competitive insights.", tools: ["Competitor Benchmarking", "Feature Gap Analysis", "Product Requirements", "User Stories"] },
  { icon: TestTube2, title: "Nest Testing", desc: "Optimize user experience with AI-powered testing insights.", tools: ["AI User Simulator", "Usability Testing", "A/B Test Ideas", "Heatmap Predictions"] },
  { icon: MessageSquare, title: "Nest Copilot", desc: "Perfect your copy and design with AI assistance.", tools: ["UX Writing", "Microcopy Generator", "Accessibility Fixes", "Figma Assistant"] },
];

function SectionKicker({ children, onDark }) {
  return <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 12.5, letterSpacing: 2, color: onDark ? C.now : C.gold, marginBottom: 14, textTransform: "uppercase" }}>{children}</div>;
}

function InstantPreview({ onSignup, isLoggedIn }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState("idle"); // idle | running | done | error
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");

  const run = async () => {
    let v = url.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    try {
      const u = new URL(v);
      if (!u.hostname.includes(".")) throw new Error();
    } catch {
      setMessage("That doesn't look like a valid website address.");
      setState("error");
      return;
    }
    setState("running");
    setMessage("");
    try {
      const r = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          max_tokens: 700,
          messages: [{ role: "user", content: [{ type: "text", text: buildPreviewPrompt(v) }] }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || data.error || "Preview failed");
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const parsed = parsePreview(text);
      if (parsed.score == null && parsed.issues.length === 0) throw new Error("Couldn't read that page — it may block automated access.");
      setResult({ ...parsed, url: v });
      setState("done");
    } catch (e) {
      setMessage(e.message || "Something went wrong. Please try again.");
      setState("error");
    }
  };

  const scoreColor = (v) => (v >= 80 ? C.low : v >= 60 ? C.medium : v >= 40 ? C.high : C.critical);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, maxWidth: 560, margin: "0 auto", boxShadow: "0 8px 26px rgba(18,48,43,0.08)" }}>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 17, color: C.text, marginBottom: 4 }}>Try it now — free, no account</div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>Paste a URL for an instant score and your top three issues.</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && state !== "running" && run()}
          placeholder="example.com"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        <button
          onClick={run}
          disabled={state === "running" || !url.trim()}
          style={{ background: url.trim() && state !== "running" ? C.now : C.surfaceAlt, color: url.trim() && state !== "running" ? C.dark : C.muted, border: "none", borderRadius: 999, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: state === "running" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          {state === "running" ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={15} />}
          {state === "running" ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {state === "error" && <div style={{ marginTop: 12, fontSize: 12.5, color: C.critical }}>{message}</div>}

      {state === "running" && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted }}>Reading the page and scoring it — about 15 seconds.</div>
      )}

      {state === "done" && result && (
        <div style={{ marginTop: 18, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 16, textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 40, color: scoreColor(result.score ?? 0), lineHeight: 1 }}>{result.score ?? "—"}</span>
            <span style={{ fontSize: 14, color: C.muted }}>/100 · {result.assessment || "Unrated"}</span>
          </div>
          {result.summary && <p style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.55, margin: "0 0 14px" }}>{result.summary}</p>}

          {result.issues.map((iss, i) => {
            const sev = SEVERITY_STYLES[iss.severity] || SEVERITY_STYLES.Medium;
            return (
              <div key={i} style={{ borderLeft: `3px solid ${sev.color}`, background: C.bg, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: C.text }}>{iss.title}</span>
                  <SeverityBadge severity={iss.severity} />
                </div>
                <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{iss.why}</div>
              </div>
            );
          })}

          <div style={{ background: C.goldSoft, borderRadius: 10, padding: "14px 16px", marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text, marginBottom: 4 }}>That's the preview. The full audit adds:</div>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.7, marginBottom: 12 }}>
              All six dimensions · every finding with fixes · Top 10 ranked improvements · quick wins and strategy · a 12-slide deck and PDF · screenshots and PDFs as input
            </div>
            <button onClick={onSignup} style={{ background: C.now, color: C.dark, border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
              {isLoggedIn ? "Run the full audit" : "Get the full report — free"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LandingPage({ onStart, onOpenLegal, isLoggedIn }) {
  const h2 = { fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 34, letterSpacing: -0.8, color: C.text, margin: "0 0 10px 0", lineHeight: 1.2 };
  const sect = { padding: "44px 0", textAlign: "center" };
  return (
    <div>
      {/* Hero - full-bleed dark band */}
      <div style={{ position: "relative", left: "50%", marginLeft: "-50vw", width: "100vw", background: `linear-gradient(135deg, ${C.dark}, ${C.darkAlt})`, padding: "56px 0 64px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 28, alignItems: "center" }}>
          <div style={{ textAlign: "left" }}>
            <SectionKicker onDark>AI-Powered UX Audit</SectionKicker>
            <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 44, color: "#FFFFFF", margin: "0 0 16px 0", lineHeight: 1.08, letterSpacing: -1 }}>
              Professional UX audits in minutes.
            </h1>
            <p style={{ color: "#BFD8D2", fontSize: 16, lineHeight: 1.6, margin: "0 0 24px 0", maxWidth: 420 }}>
              AI-powered insight across 6 critical UX dimensions. Upload screenshots, PDFs, or enter a URL for a comprehensive, actionable audit report.
            </p>
            <button onClick={onStart} style={{ background: C.now, color: C.dark, border: "none", borderRadius: 999, padding: "15px 30px", fontSize: 15.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {isLoggedIn ? "Start Free Audit" : "Sign Up & Start Free"} <ArrowRight size={16} />
            </button>
            <div style={{ fontSize: 12.5, color: "#8FB3AB", marginTop: 14 }}>Instant preview, no account · Full report free after signup</div>
          </div>
          <div>
            <InstantPreview onSignup={onStart} isLoggedIn={isLoggedIn} />
          </div>
        </div>
      </div>

      {/* Features */}
      <div style={sect}>
        <SectionKicker>FEATURES</SectionKicker>
        <h2 style={h2}>Everything You Need for a Complete UX Audit</h2>
        <p style={{ color: C.muted, fontSize: 14, maxWidth: 480, margin: "0 auto 26px" }}>From upload to report delivery, every step is designed to give you expert-level UX insight.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, textAlign: "left" }}>
          {FEATURES.map((f) => { const Icon = f.icon; return (
            <div key={f.title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", padding: 0, boxShadow: "0 6px 20px rgba(18,48,43,0.07)" }}>
              <div style={{ position: "relative", height: 110, overflow: "hidden" }}>
                <img src={f.img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", bottom: 10, left: 14, width: 34, height: 34, borderRadius: 9, background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={17} color={C.gold} /></div>
              </div>
              <div style={{ padding: "12px 16px 16px" }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 15.5, marginBottom: 5, color: C.text }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginBottom: 10 }}>{f.desc}</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: C.gold }}>Learn more <ArrowRight size={13} /></span>
              </div>
            </div>
          );})}
        </div>
      </div>

      {/* Six Dimensions */}
      <div style={sect}>
        <SectionKicker>ANALYSIS FRAMEWORKS</SectionKicker>
        <h2 style={h2}>Six Dimensions of UX Excellence</h2>
        <p style={{ color: C.muted, fontSize: 14, maxWidth: 480, margin: "0 auto 26px" }}>Every design is evaluated across proven UX frameworks to deliver comprehensive, actionable insights.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, textAlign: "left" }}>
          {DIMENSIONS.map((d) => { const Icon = d.icon; return (
            <div key={d.title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 6px 20px rgba(18,48,43,0.07)" }}>
              <div style={{ position: "relative", height: 84, overflow: "hidden" }}>
                <img src={d.img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
              <div style={{ padding: "12px 14px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Icon size={17} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 3 }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.45 }}>{d.desc}</div>
                </div>
              </div>
            </div>
          );})}
        </div>
      </div>

      {/* How it works */}
      <div style={sect}>
        <SectionKicker>HOW IT WORKS</SectionKicker>
        <h2 style={h2}>Four Steps to Expert UX Insights</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginTop: 24, textAlign: "left" }}>
          {STEPS.map((st) => (
            <div key={st.n}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 22, color: C.gold, marginBottom: 6 }}>{st.n}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: C.text, marginBottom: 4 }}>{st.title}</div>
              <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>{st.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Free access */}
      <div style={sect}>
        <SectionKicker>Pricing</SectionKicker>
        <h2 style={h2}>Free during early access</h2>
        <p style={{ color: C.textDim, fontSize: 14.5, lineHeight: 1.6, maxWidth: 500, margin: "0 auto 24px" }}>
          Try any URL instantly without an account. Sign up free and every account includes {AUDIT_QUOTA} complete
          audits — up to {SCREEN_LIMIT} screens or {NAV_LIMIT} pages each, with the full report, slide deck and PDF export.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, maxWidth: 620, margin: "0 auto 24px", textAlign: "left" }}>
          {["Instant preview with no account", `${AUDIT_QUOTA} full audits, ${SCREEN_LIMIT} screens or ${NAV_LIMIT} pages each`, "Screenshots, PDFs and URL audits", "All six analysis dimensions", "AI recommendations and Top 10", "12-slide deck and PDF export", "No credit card required"].map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, fontSize: 13, color: C.textDim }}>
              <Check size={15} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />{f}
            </div>
          ))}
        </div>
        <button onClick={onStart} style={{ background: C.now, color: C.dark, border: "none", borderRadius: 999, padding: "13px 26px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
          {isLoggedIn ? "Start an audit" : "Sign Up & Start Free"} <ArrowRight size={15} />
        </button>
      </div>

      {/* Early access (honest, in place of testimonials) */}
      <div style={sect}>
        <SectionKicker>EARLY ACCESS</SectionKicker>
        <h2 style={h2}>Be one of the first design teams on UXNest</h2>
        <p style={{ color: C.textDim, fontSize: 14, maxWidth: 500, margin: "0 auto 8px", lineHeight: 1.6 }}>
          UXNest is new — we don't have a wall of testimonials yet, and we won't invent one. Run an audit, tell us what's sharp and what's off, and help shape the tool.
        </p>
      </div>

      {/* Suites showcase */}
      <div style={sect}>
        <SectionKicker>COMING SOON</SectionKicker>
        <h2 style={h2}>The Full Nest Toolkit</h2>
        <p style={{ color: C.muted, fontSize: 14, maxWidth: 500, margin: "0 auto 26px" }}>Beyond audits, five product suites are in development to cover every UX challenge.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, textAlign: "left" }}>
          {SUITES.map((su) => { const Icon = su.icon; return (
            <div key={su.title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <Icon size={18} color={C.gold} style={{ marginBottom: 8 }} />
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14.5, color: C.text, marginBottom: 4 }}>{su.title}</div>
              <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.45, marginBottom: 8 }}>{su.desc}</div>
              {su.tools.map((t) => <div key={t} style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>· {t}</div>)}
              <span style={{ display: "inline-block", marginTop: 8, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: 0.8, color: C.high, background: C.highSoft, borderRadius: 99, padding: "2px 8px" }}>COMING SOON</span>
            </div>
          );})}
        </div>
      </div>

      {/* CTA */}
      <div style={{ ...sect, position: "relative", left: "50%", marginLeft: "-50vw", width: "100vw", background: `linear-gradient(135deg, ${C.dark}, ${C.darkAlt})`, padding: "52px 18px", marginBottom: 0 }}>
        <h2 style={{ ...h2, color: "#FFFFFF" }}>Ready to Transform Your UX?</h2>
        <p style={{ color: "#BFD8D2", fontSize: 14.5, margin: "0 0 20px" }}>Get a professional-grade UX audit in minutes. Start free, no credit card required.</p>
        <button onClick={onStart} style={{ background: C.now, color: C.dark, borderRadius: 999, border: "none", borderRadius: 10, padding: "13px 26px", fontSize: 14.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
          Start Your Free Audit <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Toolkit dashboard                                                        */
/* ----------------------------------------------------------------------- */
function DashboardPage({ onStartAudit }) {
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ position: "relative", left: "50%", marginLeft: "-50vw", width: "100vw", background: `linear-gradient(135deg, ${C.dark}, ${C.darkAlt})`, padding: "40px 0", marginBottom: 26 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 18px" }}>
          <SectionKicker onDark>Your UX Toolkit</SectionKicker>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 34, color: "#FFFFFF", margin: "0 0 6px 0", letterSpacing: -0.8 }}>Everything Nest can do</h1>
          <p style={{ color: "#BFD8D2", fontSize: 14.5, margin: 0 }}>One suite is live today. Five more are in active development.</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 14 }}>
        <div style={{ background: C.goldSoft, border: `1.5px solid ${C.gold}`, borderRadius: 16, padding: 20, boxShadow: "0 6px 20px rgba(18,48,43,0.06)" }}>
          <Zap size={19} color={C.gold} style={{ marginBottom: 8 }} />
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 16, color: C.text, marginBottom: 4 }}>Nest Audit</div>
          <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginBottom: 10 }}>AI-powered comprehensive UX analysis.</div>
          {["Screenshot analysis", "PDF upload support", "URL exploration", "Slide-deck reports"].map((t) => (
            <div key={t} style={{ display: "flex", gap: 6, fontSize: 12, color: C.text, marginBottom: 4 }}><Check size={13} color={C.low} style={{ marginTop: 2, flexShrink: 0 }} />{t}</div>
          ))}
          <button onClick={onStartAudit} style={{ width: "100%", marginTop: 10, background: C.now, color: C.dark, borderRadius: 999, border: "none", borderRadius: 9, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            Start Audit <ArrowRight size={14} />
          </button>
        </div>
        {SUITES.map((su) => { const Icon = su.icon; return (
          <div key={su.title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: "0 6px 20px rgba(18,48,43,0.06)", opacity: 0.85 }}>
            <Icon size={19} color={C.muted} style={{ marginBottom: 8 }} />
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 16, color: C.text, marginBottom: 4 }}>{su.title}</div>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginBottom: 10 }}>{su.desc}</div>
            {su.tools.map((t) => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.muted, marginBottom: 5 }}>
                <span>{t}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8.5, letterSpacing: 0.6, color: C.high, background: C.highSoft, borderRadius: 99, padding: "2px 7px", flexShrink: 0 }}>SOON</span>
              </div>
            ))}
          </div>
        );})}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* My Audits page                                                           */
/* ----------------------------------------------------------------------- */
function MyAuditsPage({ user, onOpenEntry, onNewAudit, onRequireLogin }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try {
      const { audits } = await api.listAudits();
      setEntries((audits || []).map((a) => ({
        id: a.id,
        date: new Date(a.created_at).getTime(),
        title: a.title || "",
        mode: a.mode,
        url: a.url || "",
        screenCount: a.screen_count || 0,
        score: a.score,
        assessment: a.assessment,
        rawText: a.raw_text || "",
      })));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const onDelete = async (id) => {
    if (!user) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try { await api.deleteAudit(id); } catch { /* list already updated optimistically */ }
  };

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <HistoryIcon size={26} color={C.muted} style={{ marginBottom: 12 }} />
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, color: C.text, margin: "0 0 8px" }}>My Audits</h2>
        <p style={{ color: C.textDim, fontSize: 13.5, margin: "0 0 18px" }}>Log in to see your saved audits.</p>
        <button onClick={() => onRequireLogin("save")} style={{ background: C.now, color: C.dark, borderRadius: 999, border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Log in</button>
      </div>
    );
  }

  const filtered = entries
    .filter((e) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (e.title || "").toLowerCase().includes(q) || (e.url || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === "newest") return b.date - a.date;
      if (sort === "oldest") return a.date - b.date;
      if (sort === "highest") return (b.score ?? -1) - (a.score ?? -1);
      return (a.score ?? 101) - (b.score ?? 101);
    });

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 26, color: C.text, margin: "0 0 2px" }}>My Audits</h1>
          <div style={{ fontSize: 12.5, color: C.muted }}>{entries.length} audit{entries.length === 1 ? "" : "s"} saved</div>
        </div>
        <button onClick={onNewAudit} style={{ display: "flex", alignItems: "center", gap: 6, background: C.now, color: C.dark, borderRadius: 999, border: "none", borderRadius: 9, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Plus size={14} /> New Audit
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
          <Search size={14} color={C.muted} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search audits…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...inputStyle, width: "auto", cursor: "pointer" }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="highest">Highest score</option>
          <option value="lowest">Lowest score</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 30, color: C.muted }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted, fontSize: 13.5 }}>
          {entries.length === 0 ? "No audits yet — run one and it'll be saved here." : "No audits match your search."}
        </div>
      ) : (
        filtered.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 15, color: C.text }}>
                  {e.title || (e.mode === "url" ? (e.url || "").replace(/^https?:\/\//, "") : `${e.screenCount} screen${e.screenCount === 1 ? "" : "s"}`)}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: 0.6, color: C.low, background: C.lowSoft, borderRadius: 99, padding: "2px 8px" }}>COMPLETED</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted }}>
                {new Date(e.date).toLocaleDateString()} · {e.mode === "url" ? (e.url || "").replace(/^https?:\/\//, "") : "screens/PDF"} · {e.assessment || "Unrated"}
              </div>
            </div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 22, color: C.gold, flexShrink: 0 }}>{e.score ?? "—"}</div>
            <button onClick={() => onOpenEntry(e)} style={{ ...exportBtnStyle, flexShrink: 0 }}><Eye size={13} /> View</button>
            <button onClick={() => onDelete(e.id)} title="Delete" style={{ ...iconBtnStyle, flexShrink: 0, borderColor: `${C.critical}44` }}><Trash2 size={14} color={C.critical} /></button>
          </div>
        ))
      )}
    </div>
  );
}

export default function UxnestApp() {
  const [mode, setMode] = useState("files");
  const [images, setImages] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);
  const [rawReport, setRawReport] = useState("");
  const [source, setSource] = useState({ mode: "files", url: "" });
  const [error, setError] = useState(null);

  const VALID_PAGES = ["landing", "audit", "myaudits", "dashboard", "admin"];
  const [page, setPage] = useState(() => {
    const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    return VALID_PAGES.includes(h) ? h : "landing";
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Reflect the current page in the URL hash so emailed links land in the
  // right place, and respond to back/forward navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = page === "landing" ? "" : `#${page}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target || window.location.pathname);
    }
  }, [page]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = window.location.hash.replace("#", "");
      setPage(VALID_PAGES.includes(h) ? h : "landing");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [auditTitle, setAuditTitle] = useState("");
  const [auditedPages, setAuditedPages] = useState([]);
  const [auditScreenshot, setAuditScreenshot] = useState(null);
  const [auditScreenshots, setAuditScreenshots] = useState([]);
  const auditScreenshotRef = useRef(null);
  const [visualEvidence, setVisualEvidence] = useState([]);
  const [reportTheme, setReportTheme] = useState(REPORT_THEME_FALLBACK);
  // State is for rendering; the ref guarantees the exact tested URLs survive
  // the async audit/save flow and are included in saved reports and decks.
  const auditedPagesRef = useRef([]);
  const [auditsUsed, setAuditsUsed] = useState(0);
  const [legalPage, setLegalPage] = useState(null);
  const [showDeck, setShowDeck] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const pendingRunRef = useRef(null);

  const [user, setUser] = useState(null);

  // Restore the signed-in user from the server session token.
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) return;
      try {
        const { account } = await api.session(token);
        if (account) {
          setUser({ email: account.email, name: account.name, plan: account.plan, id: account.id });
          setAuditsUsed(account.auditsUsed || 0);
        } else {
          setToken("");
        }
      } catch { /* offline or server unavailable; stay logged out */ }
    })();
  }, []);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authReason, setAuthReason] = useState("");
  const pendingAuthActionRef = useRef(null);
  const [historySaved, setHistorySaved] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const screenLimit = screenLimitFor();
  const navLimit = navLimitFor();

  /* ---- file handling ---- */
  /* Downscale images before upload: full-res phone screenshots are multi-MB
     base64 blobs that slow every API round-trip. 1568px longest edge matches
     the model's effective max input resolution, so nothing useful is lost. */
  function downscaleImage(dataUrl, mediaType) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_EDGE = 1568;
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        if (scale >= 1 && dataUrl.length < 1_500_000) {
          resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const outUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl: outUrl, base64: outUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = () => resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType });
      img.src = dataUrl;
    });
  }

  const onAddFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!files.length) return;
    setError(null);
    setImages((prev) => {
      if (prev.length >= screenLimit) {
        setError(`You can include up to ${screenLimit} files in one audit.`);
        return prev;
      }
      return prev;
    });
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const rawUrl = String(reader.result);
        const isPdf = file.type === "application/pdf";
        const processed = isPdf
          ? { dataUrl: rawUrl, base64: rawUrl.split(",")[1], mediaType: "application/pdf" }
          : await downscaleImage(rawUrl, file.type || "image/png");
        setImages((prev) => {
          if (prev.length >= screenLimit) return prev;
          return [
            ...prev,
            {
              id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              dataUrl: processed.dataUrl,
              base64: processed.base64,
              mediaType: processed.mediaType,
              kind: isPdf ? "pdf" : "image",
            },
          ];
        });
      };
      reader.onerror = () => setError("Couldn't read one of the files — try a different one.");
      reader.readAsDataURL(file);
    });
  }, [screenLimit]);

  const onRemove = useCallback((id) => setImages((prev) => prev.filter((img) => img.id !== id)), []);

  /* ---- API ---- */
  const runControlRef = useRef({ cancelled: false, deadline: 0 });
  const [runProgress, setRunProgress] = useState({ round: 0, status: "", done: 0, total: 4 });

  function checkRunState() {
    const ctl = runControlRef.current;
    if (ctl.cancelled) throw new Error("CANCELLED");
    if (ctl.deadline && Date.now() > ctl.deadline) throw new Error("DEADLINE");
  }

  async function waitInterruptible(ms) {
    const step = 500;
    let waited = 0;
    while (waited < ms) {
      checkRunState();
      const chunk = Math.min(step, ms - waited);
      await new Promise((res) => setTimeout(res, chunk));
      waited += chunk;
    }
    checkRunState();
  }

  async function callClaude(messages, tools, attempt = 0, stage = "audit") {
    checkRunState();
    const body = { model: "claude-sonnet-4-6", max_tokens: 1000, messages };
    if (tools) body.tools = tools;

    const requestId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Do not race a browser AbortController against the server's controlled
    // upstream timeout. The API returns a structured timeout before Vercel's
    // function ceiling, while a client abort can turn an otherwise valid late
    // response into the generic "fetch failed" message.
    let response;
    try {
      response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UXNest-Stage": stage,
          "X-UXNest-Request-Id": requestId,
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      if (attempt >= 1) {
        const timeout = networkErr && networkErr.name === "AbortError";
        throw new Error(timeout
          ? "This audit step timed out twice. Please try again in a moment."
          : "Couldn't reach the audit service after a retry. Check your connection and try again.");
      }
      const timeout = networkErr && networkErr.name === "AbortError";
      setRunProgress((p) => ({ ...p, status: timeout ? "This step is taking longer than expected — retrying once…" : "Connection hiccup — retrying once…" }));
      await waitInterruptible(800 + Math.random() * 400);
      return callClaude(messages, tools, attempt + 1, stage);
    } finally {
      // The server owns request timeout handling so valid responses are not
      // discarded by a competing browser-side timer.
    }

    if (response.status === 429 || response.status >= 500) {
      // Surface the server's own error message when it provides one — a 500
      // from our proxy usually means a config problem, not transient load.
      let serverMsg = "";
      try {
        const body = await response.clone().json();
        serverMsg = body && (body.error?.message || body.error || body.message) || "";
        if (typeof serverMsg !== "string") serverMsg = JSON.stringify(serverMsg);
      } catch { /* no JSON body */ }
      if (attempt >= 3 || (response.status === 500 && serverMsg)) {
        if (serverMsg) throw new Error(`${serverMsg} (HTTP ${response.status})`);
        throw new Error(response.status === 429 ? "The audit service is busy right now. Please wait a minute and try again." : `The server is temporarily unavailable (${response.status}). Please try again shortly.`);
      }
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 8000) : Math.min(1000 * 2 ** attempt, 4000);
      setRunProgress((p) => ({ ...p, status: `Service busy — retrying (${attempt + 1}/3)…` }));
      await waitInterruptible(waitMs);
      return callClaude(messages, tools, attempt + 1, stage);
    }
    if (!response.ok) {
      let msg = "";
      try {
        const body = await response.clone().json();
        msg = (body && (body.error?.message || body.error || body.message)) || "";
        if (typeof msg !== "string") msg = JSON.stringify(msg);
      } catch { /* ignore */ }
      throw new Error(msg ? `${msg} (HTTP ${response.status})` : `API request failed (${response.status})`);
    }

    try {
      return await response.json();
    } catch {
      if (attempt >= 3) throw new Error("Received an unreadable response from the audit service. Please try again.");
      await waitInterruptible(Math.min(1000 * 2 ** attempt, 4000));
      return callClaude(messages, tools, attempt + 1, stage);
    }
  }

  async function runWithContinuation(initialMessages, tools, onRound, stage = "audit") {
    let messages = initialMessages;
    let fullText = "";
    let iterations = 0;
    while (iterations < 10) {
      iterations++;
      if (onRound) onRound(iterations);
      const data = await callClaude(messages, tools, 0, stage);
      const blocks = data.content || [];
      fullText += blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      // pause_turn: the model paused mid-search — resume by returning its turn.
      // tool_use with server tools shouldn't normally surface, but resume the same way.
      if (data.stop_reason === "pause_turn" || data.stop_reason === "tool_use") {
        messages = [...messages, { role: "assistant", content: blocks }];
        continue;
      }
      if (data.stop_reason === "max_tokens") {
        messages = [
          ...messages,
          { role: "assistant", content: blocks },
          { role: "user", content: "Continue exactly where you left off. Do not repeat anything already written, do not add commentary, and do not restart any section. Keep the same exact structure and labels." },
        ];
        continue;
      }
      break;
    }
    return fullText;
  }

  /* Run report batches concurrently but throttled: at most 2 in flight, with
     staggered starts. Firing all 4 simultaneously (each carrying images or a
     web-search tool) can overwhelm the artifact fetch bridge on mobile and
     fail at the network level before reaching the API. Still ~2x faster than
     sequential. */
  async function runBatchedAudit(buildPromptForBatch, sharedContent, tools, progressOffset = 0) {
    let completed = 0;
    setRunProgress((p) => ({ round: 0, status: "", done: progressOffset, total: REPORT_BATCHES.length + progressOffset }));

    // Keep only two report requests in flight. Three concurrent long-lived
    // requests reproduce a mobile/browser connection failure where later
    // requests fail before reaching /api/audit. Two still provide parallelism
    // while keeping the transport stable.
    const CONCURRENCY = 2;
    const STAGGER_MS = 250;
    const results = new Array(REPORT_BATCHES.length);
    let nextIndex = 0;

    async function worker(workerId) {
      // Stagger worker start so requests never launch in the same instant
      if (workerId > 0) await waitInterruptible(workerId * STAGGER_MS);
      while (nextIndex < REPORT_BATCHES.length) {
        const i = nextIndex++;
        const content = [
          ...sharedContent,
          { type: "text", text: buildPromptForBatch(REPORT_BATCHES[i]) },
        ];
        try {
          const text = await runWithContinuation(
            [{ role: "user", content }],
            tools,
            undefined,
            `report-section-${i + 1}`
          );
          results[i] = { status: "fulfilled", value: text };
        } catch (e) {
          results[i] = { status: "rejected", reason: e };
          if (e && (e.message === "CANCELLED" || e.message === "DEADLINE")) return;
        }
        completed++;
        setRunProgress((p) => ({ ...p, done: completed + progressOffset }));
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, (_, id) => worker(id)));

    const failures = results.filter((r) => r && r.status === "rejected");
    const cancelled = failures.find((f) => f.reason && f.reason.message === "CANCELLED");
    if (cancelled) throw cancelled.reason;

    const texts = results.map((r) => (r && r.status === "fulfilled" ? r.value : ""));
    const combined = texts.join("\n\n");

    const deadlined = failures.find((f) => f.reason && f.reason.message === "DEADLINE");
    if (deadlined && !combined.trim()) throw deadlined.reason;
    if (deadlined) {
      // Time ran out but some batches finished — show what we have.
      setError("Time limit reached before every section finished — showing the completed parts below. Re-run to fill the gaps.");
      return combined;
    }

    if (!combined.trim()) {
      const firstErr = failures[0];
      throw new Error((firstErr && firstErr.reason && firstErr.reason.message) || "The review came back empty.");
    }
    if (failures.length > 0) {
      // Partial success: show what we have, but tell the user.
      setError(`${failures.length} of ${REPORT_BATCHES.length} report sections failed to generate — the rest are shown below. Re-run to fill the gaps.`);
    }
    return combined;
  }

  const executeFilesAudit = async () => {
    const fileContent = images.map((img) =>
      img.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.base64 } }
        : { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }
    );
    return runBatchedAudit(buildFilesBatchPrompt, fileContent, undefined);
  };

  const executeUrlAudit = async () => {
    let cleanUrl = urlInput.trim();
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) cleanUrl = `https://${cleanUrl}`;
    try {
      const parsedUrl = new URL(cleanUrl);
      if (!parsedUrl.hostname || !parsedUrl.hostname.includes(".")) throw new Error();
      cleanUrl = parsedUrl.toString();
    } catch {
      throw new Error("Enter a valid website address, for example uxnest.ai or https://uxnest.ai.");
    }

    // Stage 1: retrieve the actual public website directly. Search indexing is
    // supplementary information, not a prerequisite for auditing a live URL.
    setRunProgress({ round: 0, status: "Retrieving the live website…", done: 0, total: REPORT_BATCHES.length + 1 });
    const response = await fetch("/api/fetch-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: cleanUrl, navLimit }),
    });
    const evidence = await response.json().catch(() => ({}));

    if (!response.ok || evidence.evidenceStatus !== "SUFFICIENT") {
      const err = new Error("UXNest couldn't retrieve enough public content to produce a reliable audit. We didn't generate a score because that would be based on guesses.");
      err.code = "AUDIT_INSUFFICIENT_EVIDENCE";
      err.evidenceReason = evidence.reason || evidence.error || "The website could not be retrieved.";
      throw err;
    }

    const pages = Array.isArray(evidence.pages)
      ? evidence.pages.filter((u) => /^https?:\/\//i.test(u)).slice(0, 20)
      : [];
    const dossier = String(evidence.dossier || "").trim();

    if (!dossier || dossier.length < 100 || pages.length === 0) {
      const err = new Error("UXNest couldn't retrieve enough public content to produce a reliable audit. We didn't generate a score because that would be based on guesses.");
      err.code = "AUDIT_INSUFFICIENT_EVIDENCE";
      err.evidenceReason = "No meaningful public page content was returned.";
      throw err;
    }

    // Keep the exact URLs that were actually retrieved. These are shown in the
    // report and slide deck and are also persisted with the saved audit.
    auditedPagesRef.current = pages;
    setAuditedPages(pages);
    const capturedScreenshots = Array.isArray(evidence.screenshots)
      ? evidence.screenshots.filter((item) => item && /^https?:\/\//i.test(String(item.url || "")) && typeof item.screenshot === "string" && item.screenshot.startsWith("data:image/"))
      : [];
    const primaryScreenshot = capturedScreenshots[0]?.screenshot || evidence.screenshot || null;
    auditScreenshotRef.current = primaryScreenshot;
    setAuditScreenshot(primaryScreenshot);
    setAuditScreenshots(capturedScreenshots);
    setRunProgress((p) => ({ ...p, status: evidence.rendering === "browser" ? "Analyzing browser-rendered pages…" : "Analyzing retrieved pages…", done: 1 }));

    // Stage 2: batches consume deterministic retrieved evidence as plain text.
    return runBatchedAudit((batch) => buildUrlBatchPrompt(cleanUrl, dossier, batch), [], undefined, 1);
  };


  const generateVisualEvidence = async (parsed, screenshot) => {
    if (!screenshot || typeof screenshot !== "string" || !screenshot.startsWith("data:image/")) return [];
    const allIssues = [
      ["Usability", parsed.usability], ["Visual Design", parsed.visual], ["Accessibility", parsed.accessibility],
      ["Trust & Credibility", parsed.trust], ["Conversion", parsed.conversion], ["Cognitive Load", parsed.cognitive],
    ].flatMap(([section, data]) => (data?.issues || []).map((issue) => ({ ...issue, section })))
      .sort((a, b) => ({ Critical: 0, High: 1, Medium: 2, Low: 3 }[a.severity] ?? 4) - ({ Critical: 0, High: 1, Medium: 2, Low: 3 }[b.severity] ?? 4))
      .slice(0, 8);
    if (!allIssues.length) return [];

    const visionScreenshot = await compressScreenshotForVision(screenshot);
    const comma = visionScreenshot.indexOf(",");
    if (comma < 0) return [];
    const header = visionScreenshot.slice(0, comma);
    const base64 = visionScreenshot.slice(comma + 1);
    const mediaType = /data:(image\/[a-zA-Z0-9.+-]+);base64/.exec(header)?.[1] || "image/jpeg";

    try {
      setRunProgress((p) => ({ ...p, status: "Mapping visible findings to the live screenshot…" }));
      const data = await callClaude([{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: buildVisualEvidencePrompt(allIssues) },
      ] }], undefined, 0, "visual-evidence");
      const raw = (data.content || []).filter((item) => item.type === "text").map((item) => item.text).join("");
      return parseVisualEvidence(raw, allIssues);
    } catch (err) {
      console.warn("Visual evidence mapping failed", err);
      return [];
    }
  };

  const startRun = (which) => {
    if (!showDisclaimer) {
      pendingRunRef.current = which;
      setShowDisclaimer(true);
      return;
    }
    performRun(which);
  };

  const RUN_DEADLINE_MS = 5 * 60 * 1000;

  const performRun = async (which) => {
    runControlRef.current = { cancelled: false, deadline: Date.now() + RUN_DEADLINE_MS };
    setRunProgress({ round: 0, status: "" });
    setAnalyzing(true);
    setError(null);
    setReport(null);
    setHistorySaved(false);
    try {
      const text = which === "url" ? await executeUrlAudit() : await executeFilesAudit();
      if (!text || !text.trim()) throw new Error("The review came back empty.");
      const parsed = parseReport(text);
      const mappedEvidence = which === "url" && auditScreenshotRef.current ? await generateVisualEvidence(parsed, auditScreenshotRef.current) : [];
      setVisualEvidence(mappedEvidence);
      const themeImage = which === "url" ? auditScreenshotRef.current : (images[0]?.dataUrl || images[0]?.url || null);
      const adaptiveTheme = await extractBrandTheme(themeImage);
      setReportTheme(adaptiveTheme);
      setRawReport(text);
      setReport(parsed);
      setSource(which === "url" ? { mode: "url", url: urlInput.trim() } : { mode: "files", url: "" });

      if (user) {
        try {
          const saved = await api.saveAudit({
            title: auditTitle.trim(),
            mode: which,
            url: which === "url" ? urlInput.trim() : "",
            screenCount: which === "files" ? images.length : 0,
            score: parsed.summary.score,
            assessment: parsed.summary.assessment,
            scorecard: parsed.scorecard,
            severities: {
              critical: [parsed.usability, parsed.visual, parsed.accessibility, parsed.trust, parsed.conversion, parsed.cognitive]
                .flatMap((sec) => sec.issues).filter((i) => i.severity === "Critical").length,
              high: [parsed.usability, parsed.visual, parsed.accessibility, parsed.trust, parsed.conversion, parsed.cognitive]
                .flatMap((sec) => sec.issues).filter((i) => i.severity === "High").length,
            },
            pages: auditedPagesRef.current,
            rawText: text,
          });
          setHistorySaved(true);
          if (typeof saved.used === "number") setAuditsUsed(saved.used);
        } catch (saveErr) {
          // The report is already on screen; saving is best-effort.
          setHistorySaved(false);
        }
      }
    } catch (e) {
      const msg = e && e.message;
      if (msg === "CANCELLED") {
        setError(null); // user chose to stop; no error banner needed
      } else if (msg === "DEADLINE") {
        setError("The audit hit the 5-minute limit before producing anything usable. The service may be under heavy load — try again shortly, or reduce the number of screens per run.");
      } else if (e && e.code === "AUDIT_INSUFFICIENT_EVIDENCE") {
        const detail = e.evidenceReason ? ` Reason: ${e.evidenceReason}` : "";
        setError(`We couldn't complete this audit because UXNest couldn't verify enough public website content. We won't generate a score based on guesses.${detail} Try a specific public page, retry later, or upload screenshots instead.`);
      } else {
        setError(msg || "Something went wrong running the audit. Please try again.");
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const cancelRun = () => {
    runControlRef.current.cancelled = true;
  };

  const onAcceptDisclaimer = () => {
    setShowDisclaimer(false);
    const which = pendingRunRef.current;
    pendingRunRef.current = null;
    if (which) performRun(which);
  };

  const onRunFiles = () => {
    setError(null);
    if (!images.length) return;
    if (!user) { requireLogin("runAudit"); return; }
    if (auditsUsed >= AUDIT_QUOTA) { setError(QUOTA_MESSAGE); return; }
    startRun("files");
  };
  const onRunUrl = () => {
    setError(null);
    let v = urlInput.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) {
      v = `https://${v}`;
    }
    // Sanity-check it parses as a URL with a plausible hostname
    try {
      const u = new URL(v);
      if (!u.hostname.includes(".")) throw new Error();
    } catch {
      setError("That doesn't look like a valid website address — try something like example.com");
      return;
    }
    if (v !== urlInput.trim()) setUrlInput(v);
    if (!user) { requireLogin("runAudit"); return; }
    if (auditsUsed >= AUDIT_QUOTA) { setError(QUOTA_MESSAGE); return; }
    startRun("url");
  };

  const onReset = useCallback(() => {
    setReport(null); setRawReport(""); setImages([]); setUrlInput(""); setError(null); setHistorySaved(false);
    setAuditTitle("");
    setAuditedPages([]);
    setAuditScreenshot(null);
    setAuditScreenshots([]);
    auditScreenshotRef.current = null;
    setVisualEvidence([]);
    setReportTheme(REPORT_THEME_FALLBACK);
    auditedPagesRef.current = [];
  }, []);

  /* ---- auth ---- */
  const requireLogin = (action) => {
    pendingAuthActionRef.current = action;
    const reasons = {
      runAudit: "Create a free account to run your audit — it keeps your reports in one place.",
      save: "Log in to save this audit to your history.",
    };
    setAuthReason(reasons[action] || "");
    setAuthMode(action === "runAudit" ? "signup" : "login");
    setShowAuth(true);
  };

  const onAuthSuccess = async (u) => {
    setUser(u);
    setAuditsUsed(u.auditsUsed || 0);
    kvSet("uxnest:session", JSON.stringify({ emailHash: u.emailHash })).catch(() => {});
    setShowAuth(false);
    const action = pendingAuthActionRef.current;
    pendingAuthActionRef.current = null;
    if (action === "runAudit") {
      // Resume the audit the person was starting when we asked them to sign up.
      setTimeout(() => startRun(mode === "url" ? "url" : "files"), 0);
      return;
    }

    // Save a report that was generated before this login.
    if (report && !historySaved) {
      api.saveAudit({
        title: auditTitle.trim(),
        mode: source.mode,
        url: source.url,
        screenCount: source.mode === "files" ? images.length : 0,
        score: report.summary.score,
        assessment: report.summary.assessment,
        scorecard: report.scorecard,
        pages: auditedPagesRef.current,
        rawText: rawReport,
      }).then((saved) => {
        setHistorySaved(true);
        if (typeof saved.used === "number") setAuditsUsed(saved.used);
      }).catch(() => {});
    }

  };

  const onLogout = () => {
    setUser(null);
    setAuditsUsed(0);
    setShowHistory(false);
    setToken("");
  };

  const doDownloadPdf = useCallback(() => {
    if (!report) return;
    setShowDeck(true);
  }, [report]);

  const [exporting, setExporting] = useState(false);

  /* Genuine PDF export: rasterize each rendered slide with html2canvas and
     place it on a landscape 16:9 jsPDF page. Requires the deck viewer to be
     open so the slides exist in the DOM at full size. */
  const tryExportDeck = useCallback(async () => {
    if (!report || exporting) return;
    setExporting(true);
    try {
      // Wait for the deck to re-render at its full, unscaled size before capture.
      // This prevents html2canvas from rasterizing a mobile-scaled slide.
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const slides = Array.from(document.querySelectorAll(".deck-screen .deck-slide"));
      if (!slides.length) {
        setError("Open the slide deck first, then export.");
        return;
      }

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [296, 166] });
      for (let i = 0; i < slides.length; i++) {
        const canvas = await html2canvas(slides[i], {
          scale: 2,
          backgroundColor: "#FFFFFF",
          useCORS: true,
          logging: false,
          windowWidth: 1119,
        });
        const img = canvas.toDataURL("image/jpeg", 0.9);
        if (i > 0) pdf.addPage([296, 166], "landscape");
        pdf.addImage(img, "JPEG", 0, 0, 296, 166, undefined, "FAST");
      }
      const name = `uxnest-ux-audit-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(name);
    } catch (e) {
      setError("Couldn't build the PDF. You can still present from the deck view, or use your browser's Print > Save as PDF.");
    } finally {
      setExporting(false);
    }
  }, [report, exporting]);

  const openHistory = async () => {
    if (!user) return;
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const { audits } = await api.listAudits();
      setHistoryEntries((audits || []).map((a) => ({
        id: a.id, date: new Date(a.created_at).getTime(), title: a.title || "",
        mode: a.mode, url: a.url || "", screenCount: a.screen_count || 0,
        score: a.score, assessment: a.assessment, rawText: a.raw_text || "", pages: Array.isArray(a.pages) ? a.pages : [],
      })));
    } catch {
      setHistoryEntries([]);
    }
    setHistoryLoading(false);
  };

  const openHistoryEntry = (entry) => {
    const parsed = parseReport(entry.rawText);
    setReport(parsed);
    setRawReport(entry.rawText);
    setSource({ mode: entry.mode, url: entry.url || "" });
    const savedPages = Array.isArray(entry.pages) ? entry.pages : [];
    auditedPagesRef.current = savedPages;
    setAuditedPages(savedPages);
    setAuditScreenshot(null);
    auditScreenshotRef.current = null;
    setVisualEvidence([]);
    setReportTheme(REPORT_THEME_FALLBACK);
    setImages([]);
    setShowHistory(false);
  };


  const mailtoHref = report
    ? `mailto:?subject=${encodeURIComponent(`Nest Audit — Score ${report.summary.score ?? "—"}/100`)}&body=${encodeURIComponent(buildPlainTextSummary(report, source, !!user && historySaved))}`
    : "#";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter', sans-serif", padding: "20px 14px 40px" }}>
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        .nav-desktop { display: none !important; }
        .nav-mobile { display: flex !important; }
        @media (min-width: 640px) {
          .nav-desktop { display: flex !important; }
          .nav-mobile, .nav-mobile-menu { display: none !important; }
        }
        ::-webkit-scrollbar { display: none; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes scanSweep { 0% { left: -60%; } 100% { left: 130%; } }
        .scan-sweep { animation: scanSweep 1.6s ease-in-out infinite; }
        @keyframes msgFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .msg-fade { animation: msgFadeIn 350ms ease-out; }
        @keyframes pulseRing { 0% { transform: scale(0.85); opacity: 0.9; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes dotPulse { 0%, 100% { transform: scale(0.7); opacity: 0.4; } 50% { transform: scale(1.1); opacity: 1; } }
        @keyframes tickPop { 0% { transform: scale(0); } 60% { transform: scale(1.35); } 100% { transform: scale(1); } }
        .tick-pop { animation: tickPop 380ms cubic-bezier(.2,.8,.3,1.4) both; }
        @keyframes stepEnter { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
        .step-enter { animation: stepEnter 420ms ease-out both; }
        @keyframes iconBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes stripeSlide { from { background-position: 0 0; } to { background-position: 24px 0; } }
        @keyframes shimmerText { 0% { background-position: -120px 0; } 100% { background-position: 120px 0; } }
        .shimmer-text {
          background: linear-gradient(90deg, ${C.text} 40%, ${C.gold} 50%, ${C.text} 60%);
          background-size: 240px 100%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmerText 1.8s linear infinite;
        }
        .print-only { display: none; }
        .deck-screen > div > div { margin-bottom: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
        @media print {
          @page { size: 296mm 166mm; margin: 0; }
          body * { visibility: hidden; }
          .print-only, .print-only * { visibility: visible; }
          .print-only { display: block; position: absolute; top: 0; left: 0; width: 296mm; }
          .print-only * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 40, background: C.surface, boxShadow: "0 1px 0 rgba(18,48,43,0.08)", margin: "-20px -14px 18px", padding: "12px 14px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div onClick={() => { setPage("landing"); setLegalPage(null); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Eye size={14} color="#FFFFFF" strokeWidth={2.4} />
            </div>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 16, color: C.text, letterSpacing: -0.2 }}>UXNest</span>
          </div>

          {/* Desktop nav — hidden on mobile via CSS class */}
          <nav className="nav-desktop" style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {[...(report ? [["audit", "Report", FileText]] : []), ["myaudits", "My Audits", ClipboardList], ["dashboard", "Toolkit", Gauge]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => { setPage(key); setLegalPage(null); }} style={{ display: "flex", alignItems: "center", gap: 5, background: page === key && !legalPage ? C.goldSoft : "transparent", border: "none", color: page === key && !legalPage ? C.gold : C.muted, fontSize: 12.5, fontWeight: 600, borderRadius: 99, padding: "6px 11px", cursor: "pointer" }}>
                <Icon size={13} /> {label}
              </button>
            ))}
            {user ? (
              <>
                <button onClick={onLogout} style={iconBtnStyle} title="Log out"><LogOut size={15} color={C.muted} /></button>
              </>
            ) : (
              <button onClick={() => { setAuthReason(""); pendingAuthActionRef.current = null; setShowAuth(true); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.border}`, color: C.text, fontSize: 12.5, fontWeight: 600, borderRadius: 99, padding: "7px 12px", cursor: "pointer" }}>
                <LogIn size={13} /> Log in
              </button>
            )}
          </nav>

          {/* Mobile: New Audit pill + hamburger */}
          <div className="nav-mobile" style={{ display: "none", alignItems: "center", gap: 8 }}>
            <button onClick={() => { setPage("audit"); setLegalPage(null); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 5, background: C.now, color: C.dark, border: "none", fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "8px 14px", cursor: "pointer" }}>
              <Zap size={13} /> New Audit
            </button>
            <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" style={{ ...iconBtnStyle, width: 36, height: 36 }}>
              {menuOpen ? <X size={18} color={C.text} /> : <Menu size={18} color={C.text} />}
            </button>
          </div>

          {/* Desktop New Audit CTA */}
          <button className="nav-desktop" onClick={() => { setPage("audit"); setLegalPage(null); }} style={{ display: "flex", alignItems: "center", gap: 5, background: C.now, color: C.dark, border: "none", fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "8px 16px", cursor: "pointer" }}>
            <Zap size={13} /> New Audit
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="nav-mobile-menu" style={{ maxWidth: 720, margin: "10px auto 0", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 28px rgba(18,48,43,0.14)" }}>
            {[...(report ? [["audit", "Report", FileText]] : []), ["myaudits", "My Audits", ClipboardList], ["dashboard", "Toolkit", Gauge]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => { setPage(key); setLegalPage(null); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: page === key && !legalPage ? C.goldSoft : "transparent", border: "none", borderBottom: `1px solid ${C.borderSoft}`, color: page === key && !legalPage ? C.gold : C.text, fontSize: 14, fontWeight: 600, padding: "14px 16px", cursor: "pointer" }}>
                <Icon size={16} /> {label}
              </button>
            ))}
            {user ? (
              <>
                <button onClick={() => { onLogout(); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: "none", color: C.critical, fontSize: 14, fontWeight: 600, padding: "14px 16px", cursor: "pointer" }}>
                  <LogOut size={16} /> Log out ({user.email})
                </button>
              </>
            ) : (
              <button onClick={() => { setAuthReason(""); pendingAuthActionRef.current = null; setShowAuth(true); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: "none", color: C.text, fontSize: 14, fontWeight: 600, padding: "14px 16px", cursor: "pointer" }}>
                <LogIn size={16} /> Log in / Sign up
              </button>
            )}
          </div>
        )}
      </header>
      {user && user.ephemeral && (
        <div style={{ maxWidth: 720, margin: "0 auto 14px", fontSize: 11.5, color: C.high, background: C.highSoft, border: `1px solid ${C.high}44`, borderRadius: 8, padding: "8px 12px" }}>
          Persistent storage isn't available right now — your account and history will only last for this session.
        </div>
      )}

      <main style={{ maxWidth: 720, margin: "0 auto" }}>
        {legalPage ? (
          <LegalPage pageKey={legalPage} onBack={() => setLegalPage(null)} />
        ) : page === "landing" && !analyzing ? (
          <LandingPage onStart={() => setPage("audit")} onOpenLegal={setLegalPage} isLoggedIn={!!user} />
        ) : page === "admin" ? (
          <AdminPage C={C} onExit={() => setPage("landing")} />
        ) : page === "dashboard" && !analyzing ? (
          <DashboardPage onStartAudit={() => setPage("audit")} />
        ) : page === "myaudits" && !analyzing ? (
          <MyAuditsPage user={user} onOpenEntry={(e) => { openHistoryEntry(e); setPage("audit"); }} onNewAudit={() => setPage("audit")} onRequireLogin={requireLogin} />
        ) : (
          <>
            {!analyzing && !report && (
              <div style={{ maxWidth: 640, margin: "0 auto" }}>
                <div style={{ textAlign: "center", marginBottom: 22 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Stamp size={20} color={C.gold} strokeWidth={2} />
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 2, color: C.gold }}>SENIOR UX REVIEW</span>
                  </div>
                  <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 30, color: C.text, margin: "0 0 8px 0", letterSpacing: -0.3 }}>UXNest</h1>
                  <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.55, margin: "0 auto", maxWidth: 440 }}>
                    Drop in a screen, a PDF, or a website URL and get the audit a 20-year design director would give it.
                  </p>
                </div>

                {user && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: auditsUsed >= AUDIT_QUOTA ? C.highSoft : C.goldSoft, border: `1px solid ${auditsUsed >= AUDIT_QUOTA ? C.high : C.gold}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
                    <FileText size={15} color={auditsUsed >= AUDIT_QUOTA ? C.high : C.gold} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: C.text }}>
                      {auditsUsed >= AUDIT_QUOTA
                        ? QUOTA_MESSAGE
                        : `${AUDIT_QUOTA - auditsUsed} of ${AUDIT_QUOTA} audit${AUDIT_QUOTA === 1 ? "" : "s"} remaining on your account.`}
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>Audit title <span style={{ fontWeight: 400, color: C.muted }}>(optional)</span></label>
                  <input value={auditTitle} onChange={(e) => setAuditTitle(e.target.value)} placeholder="e.g. Homepage Redesign v2, Checkout Flow, Mobile App…" maxLength={80} style={inputStyle} />
                </div>

                <ModeTabs mode={mode} setMode={setMode} />

                {mode === "files" ? (
                  <UploadScreen images={images} onAddFiles={onAddFiles} onRemove={onRemove} onRun={onRunFiles} dragOver={dragOver} setDragOver={setDragOver} error={error} screenLimit={screenLimit} />
                ) : (
                  <UrlScreen url={urlInput} setUrl={setUrlInput} onRun={onRunUrl} error={error} navLimit={navLimit} />
                )}

                <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 22, flexWrap: "wrap" }}>
                  {["Nielsen Heuristics", "WCAG", "Conversion", "Cognitive Load"].map((t) => (
                    <span key={t} style={{ fontSize: 11.5, color: C.muted, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.3 }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {analyzing && <LoadingScreen thumbs={images} progress={runProgress} onCancel={cancelRun} />}

            {!analyzing && report && (
              <ReportScreen
                report={report}
                images={images}
                source={source}
                auditedPages={auditedPages}
                auditScreenshot={auditScreenshot}
                visualEvidence={visualEvidence}
                onReset={onReset}
                isLoggedIn={!!user}
                onRequireLogin={requireLogin}
                onDownload={doDownloadPdf}
                mailtoHref={mailtoHref}
              />
            )}
          </>
        )}

        <Footer onOpenLegal={setLegalPage} />
      </main>

      {showDisclaimer && <DisclaimerModal onAccept={onAcceptDisclaimer} onCancel={() => { setShowDisclaimer(false); pendingRunRef.current = null; }} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuth={onAuthSuccess} reason={authReason} initialMode={authMode} />}
      {showHistory && <HistoryPanel entries={historyEntries} onOpen={openHistoryEntry} onClose={() => setShowHistory(false)} loading={historyLoading} />}

      {showDeck && report && (
        <DeckViewer report={report} source={source} auditedPages={auditedPages} auditScreenshot={auditScreenshot} auditScreenshots={auditScreenshots} visualEvidence={visualEvidence} theme={reportTheme} onClose={() => setShowDeck(false)} onTryPrint={tryExportDeck} exporting={exporting} />
      )}
      <SupportChat C={C} user={user} report={report} source={source} />
      <PrintableReport report={report} source={source} auditedPages={auditedPages} auditScreenshot={auditScreenshot} auditScreenshots={auditScreenshots} visualEvidence={visualEvidence} theme={reportTheme} />
    </div>
  );
}

const iconBtnStyle = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8,
  background: C.surface, border: `1px solid ${C.border}`, cursor: "pointer",
};
