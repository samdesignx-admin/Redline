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
const MIN_TARGET_WORDS = 3;
const SUSPICIOUS_CLUSTER_DISTANCE = 1.25;
const VAGUE_TARGETS = new Set([
  "navigation", "nav", "header", "footer", "homepage", "home page", "page",
  "screen", "section", "content", "layout", "design", "image", "card",
  "whitespace", "blank space", "hero", "banner", "form", "button", "link",
]);

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

function targetWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function isSpecificVisibleTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target || target.length < 8) return false;
  if (VAGUE_TARGETS.has(target)) return false;
  if (targetWords(target).length < MIN_TARGET_WORDS) return false;
  return true;
}

function sameEvidenceSpace(a, b) {
  return String(a?.screenshotId || "") === String(b?.screenshotId || "") &&
    String(a?.pageUrl || "") === String(b?.pageUrl || "");
}

function targetDistance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
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
  if (!findingId || !hasTarget || !isSpecificVisibleTarget(target) || !explanation) return null;

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

/**
 * Reject evidence that is structurally suspicious even though it contains
 * syntactically valid coordinates. In particular, several unrelated findings
 * collapsing onto the same point is a common failure mode of vision output.
 */
function validateEvidenceCollection(items) {
  const accepted = [];
  const rejected = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) {
      rejected.push({ item, reason: "invalid" });
      continue;
    }
    const collision = accepted.find((existing) =>
      existing.findingId !== item.findingId &&
      sameEvidenceSpace(existing, item) &&
      targetDistance(existing, item) < SUSPICIOUS_CLUSTER_DISTANCE &&
      existing.target.toLowerCase() !== item.target.toLowerCase()
    );
    if (collision) {
      rejected.push({ item, reason: "suspicious-coordinate-cluster", conflictsWith: collision.findingId });
      continue;
    }
    accepted.push(item);
  }
  return { accepted, rejected };
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

  return validateEvidenceCollection(normalized).accepted;
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
  MIN_TARGET_WORDS,
  SUSPICIOUS_CLUSTER_DISTANCE,
  VAGUE_TARGETS,
  clampPercent,
  normalizeStatus,
  normalizeRadius,
  normalizeFindingId,
  isSpecificVisibleTarget,
  normalizeEvidenceTarget,
  validateEvidenceCollection,
  normalizeEvidenceCollection,
  evidenceCanSupportScoring,
};
