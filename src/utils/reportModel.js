/** Canonical UXNest report model. */
import { normalizeEvidenceCollection, evidenceCanSupportScoring } from "./evidenceModel.js";
import { buildTraceability } from "./traceability.js";

const DIMENSION_KEYS = ["usability", "accessibility", "visual", "trust", "conversion"];
const DIMENSION_META = {
  usability: { id: "usability", label: "Usability" }, accessibility: { id: "accessibility", label: "Accessibility" },
  visual: { id: "visual", label: "Visual Design" }, trust: { id: "trust", label: "Trust" }, conversion: { id: "conversion", label: "Conversion" },
};
const FINDING_SECTION_ORDER = ["usability", "visual", "accessibility", "seo", "trust", "conversion", "cognitive"];

function normalizeIssue(issue, id, section) { return { ...issue, id, section }; }
function normalizeIssueSection(sectionData, section, nextFindingNumber) {
  const data = sectionData || {};
  const issues = Array.isArray(data.issues) ? data.issues : [];
  return { ...data, issues: issues.map((issue, index) => normalizeIssue(issue, `F-${String(nextFindingNumber + index).padStart(3, "0")}`, section)) };
}

function buildEvidenceIndex(evidence, findings) {
  const findingIds = new Set(findings.map((finding) => String(finding?.id || "").trim()).filter(Boolean));
  const byFinding = {};
  const valid = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const findingId = String(item?.findingId || "").trim();
    if (!findingId || !findingIds.has(findingId)) continue;
    valid.push(item);
    if (!byFinding[findingId]) byFinding[findingId] = [];
    byFinding[findingId].push(item);
  }
  return {
    valid,
    byFinding,
    scoring: valid.filter(evidenceCanSupportScoring),
  };
}

function normalizeReportModel(report) {
  if (!report || typeof report !== "object") return report;
  let findingNumber = 1;
  const normalized = { ...report };
  for (const section of FINDING_SECTION_ORDER) {
    const current = report[section] || { intro: "", issues: [] };
    const issues = Array.isArray(current.issues) ? current.issues : [];
    normalized[section] = normalizeIssueSection(current, section, findingNumber);
    findingNumber += issues.length;
  }
  const scorecard = normalized.scorecard || {};
  // A number assigned by the model without any accompanying findings or
  // explicit "no material issues" assessment is not a defensible score.
  // Mark such sections N/A rather than silently portraying them as tested.
  normalized.dimensions = DIMENSION_KEYS.map((key) => {
    const data = normalized[key] || {};
    const observedIssues = Array.isArray(data.issues) ? data.issues.length : 0;
    const note = String(data.intro || "").toLowerCase();
    // A scored, clean section still needs an explicit evidence-based
    // assessment; omission is never treated as a zero-finding success.
    const explicitlyAssessedWithoutIssues =
      /\bno\s+(?:(?:additional|material|significant|verified|substantial|notable|major)\s+){0,4}(?:[\w-]+\s+){0,3}(?:issues?|findings?|problems?|concerns?)\b.{0,110}\b(?:identified|observed|detected|found|evident)\b/i.test(note) ||
      /\b(?:no issues? to report|no material concerns|no significant findings)\b/i.test(note);
    const assessed = observedIssues > 0 || explicitlyAssessedWithoutIssues;
    const raw = scorecard[key];
    const parsed = raw == null || raw === "" ? null : Number(raw);
    const score = assessed && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? Math.round(parsed) : null;
    return { ...DIMENSION_META[key], score, assessed, findingCount: observedIssues };
  });
  normalized.findings = FINDING_SECTION_ORDER.flatMap((section) => normalized[section]?.issues || []);
  const dimensionScores = normalized.dimensions
    .filter((dimension) => dimension.score !== null)
    .map((dimension) => dimension.score);
  normalized.scoreCoverage = {
    assessed: dimensionScores.length,
    total: DIMENSION_KEYS.length,
    complete: dimensionScores.length === DIMENSION_KEYS.length,
  };
  // A numerical overall UX score is meaningful only if all five scored
  // dimensions were assessed; partial-coverage averages mislead buyers.
  normalized.overallScore = normalized.scoreCoverage.complete
    ? Math.round(dimensionScores.reduce((sum, score) => sum + score, 0) / dimensionScores.length)
    : null;
  normalized.summary = {
    ...(normalized.summary || {}),
    score: normalized.overallScore,
    assessment: normalized.overallScore == null ? "Incomplete" : normalized.summary?.assessment,
  };
  normalized.scorecard = {
    ...scorecard,
    ...Object.fromEntries(normalized.dimensions.map(({ id, score }) => [id, score])),
    overall: normalized.overallScore,
  };

  const evidence = normalizeEvidenceCollection(normalized.evidence || []);
  const evidenceIndex = buildEvidenceIndex(evidence, normalized.findings);
  normalized.evidence = evidenceIndex.valid;
  normalized.evidenceByFinding = evidenceIndex.byFinding;
  normalized.scoringEvidence = evidenceIndex.scoring;
  normalized.traceability = buildTraceability(normalized.findings);
  normalized.modelVersion = 7;
  return normalized;
}

export { DIMENSION_KEYS, DIMENSION_META, FINDING_SECTION_ORDER, buildEvidenceIndex, normalizeReportModel };
