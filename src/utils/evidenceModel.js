/**
 * Canonical visual-evidence model.
 *
 * Evidence is deliberately normalized at one boundary so renderers do not
 * need to interpret AI coordinates, legacy rectangles, or missing metadata.
 * The renderer contract is a small target-centered pin on a known screenshot.
 */

const EVIDENCE_STATUSES = Object.freeze([
  "observed",
  "inferred",
  "unverified",
  "visual-only",
  "blocked",
  "insufficient",
]);

const DEFAULT_STATUS = "observed";
const MIN_RADIUS = 1.5;
const MAX_RADIUS = 4.5;
const MAX_ITEMS = 6;

function clampPercent(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
}

function normalizeStatus(value, fallback = DEFAULT_STATUS) {
  const status = String(value || "").trim().toLowerCase();
  return EVIDENCE_STATUSES.includes(status) ? status : fallback;
}

function normalizeRadius(value, fallback = 2.5) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, n)) : fallback;
}

function normalizeEvidenceTarget(item, index = 0, options = {}) {
  if (!item || typeof item !== "object") return null;

  const findingId = String(item.findingId || item.id || "").trim();
  const findingIndex = Number.isFinite(Number(item.findingIndex))
    ? Math.round(Number(item.findingIndex))
    : null;
  const screenshotId = String(item.screenshotId || options.screenshotId || "").trim();
  const pageUrl = String(item.pageUrl || item.url || options.pageUrl || "").trim();

  const hasTarget = Number.isFinite(Number(item.x)) || Number.isFinite(Number(item.targetX)) || Number.isFinite(Number(item.cx));
  const x = clampPercent(item.x ?? item.targetX ?? item.cx, 50);
  const y = clampPercent(item.y ?? item.targetY ?? item.cy, 50);
  const radius = normalizeRadius(item.radius ?? item.targetRadius);
  const target = String(item.target || "").trim().slice(0, 160);
  const explanation = String(item.explanation || "").trim().slice(0, 280);

  if (!hasTarget || !explanation) return null;

  const status = normalizeStatus(item.status, options.status || DEFAULT_STATUS);
  const confidence = String(item.confidence || "").trim().toLowerCase() || (
    status === "observed" || status === "visual-only" ? "high" : status === "inferred" ? "medium" : "low"
  );

  return {
    id: findingId || `E-${findingIndex || index + 1}`,
    findingId: findingId || (findingIndex ? `F-${String(findingIndex).padStart(3, "0")}` : ""),
    findingIndex,
    screenshotId,
    pageUrl,
    x,
    y,
    radius,
    target,
    explanation,
    confidence,
    status,
  };
}

function normalizeEvidenceCollection(items, options = {}) {
  const input = Array.isArray(items) ? items : [];
  const seen = new Set();
  const normalized = [];

  for (let i = 0; i < input.length && normalized.length < MAX_ITEMS; i++) {
    const item = normalizeEvidenceTarget(input[i], i, options);
    if (!item) continue;
    const key = `${item.findingId}|${item.screenshotId}|${item.pageUrl}|${item.x.toFixed(2)}|${item.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }

  return normalized;
}

function evidenceCanSupportScoring(evidence) {
  const status = normalizeStatus(evidence?.status, "insufficient");
  return status === "observed" || status === "visual-only";
}

export {
  EVIDENCE_STATUSES,
  DEFAULT_STATUS,
  MIN_RADIUS,
  MAX_RADIUS,
  MAX_ITEMS,
  clampPercent,
  normalizeStatus,
  normalizeRadius,
  normalizeEvidenceTarget,
  normalizeEvidenceCollection,
  evidenceCanSupportScoring,
};
