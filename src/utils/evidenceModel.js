/**
 * Canonical visual-evidence model.
 *
 * Evidence is normalized at one boundary so every renderer consumes the same
 * target-centered contract. Finding identity is deliberately kept separate
 * from evidence identity so legacy parser ids cannot break traceability.
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

function normalizeFindingId(value, findingIndex) {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  return Number.isFinite(findingIndex) && findingIndex > 0
    ? `F-${String(findingIndex).padStart(3, "0")}`
    : "";
}

function normalizeEvidenceTarget(item, index = 0, options = {}) {
  if (!item || typeof item !== "object") return null;

  const rawFindingIndex = Number(item.findingIndex);
  const findingIndex = Number.isFinite(rawFindingIndex) && rawFindingIndex > 0
    ? Math.round(rawFindingIndex)
    : null;
  const findingId = normalizeFindingId(item.findingId, findingIndex);
  const evidenceId = String(item.evidenceId || item.id || "").trim() || `E-${String(index + 1).padStart(2, "0")}`;
  const screenshotId = String(item.screenshotId || options.screenshotId || "").trim();
  const pageUrl = String(item.pageUrl || item.url || options.pageUrl || "").trim();

  const rawX = item.x ?? item.targetX ?? item.cx;
  const rawY = item.y ?? item.targetY ?? item.cy;
  const hasTarget = Number.isFinite(Number(rawX)) && Number.isFinite(Number(rawY));
  const x = clampPercent(rawX, 50);
  const y = clampPercent(rawY, 50);
  const radius = normalizeRadius(item.radius ?? item.targetRadius);
  const target = String(item.target || "").trim().slice(0, 160);
  const explanation = String(item.explanation || "").trim().slice(0, 280);

  // A canonical evidence record must be traceable to a finding and a visible
  // target. Without both coordinates, the renderer cannot truthfully place it.
  if (!findingId || !hasTarget || !target || !explanation) return null;

  const status = normalizeStatus(item.status, options.status || DEFAULT_STATUS);
  const confidence = String(item.confidence || "").trim().toLowerCase() || (
    status === "observed" || status === "visual-only" ? "high" : status === "inferred" ? "medium" : "low"
  );

  return {
    id: evidenceId,
    findingId,
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
  normalizeFindingId,
  normalizeEvidenceTarget,
  normalizeEvidenceCollection,
  evidenceCanSupportScoring,
};
