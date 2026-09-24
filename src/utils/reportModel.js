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
  normalized.dimensions = DIMENSION_KEYS.map((key) => ({ ...DIMENSION_META[key], score: scorecard[key] ?? null }));
  normalized.findings = FINDING_SECTION_ORDER.flatMap((section) => normalized[section]?.issues || []);
  const dimensionScores = normalized.dimensions.map((dimension) => Number(dimension.score)).filter((score) => Number.isFinite(score));
  normalized.overallScore = dimensionScores.length ? Math.round(dimensionScores.reduce((sum, score) => sum + score, 0) / dimensionScores.length) : null;
  normalized.summary = { ...(normalized.summary || {}), score: normalized.overallScore };
  normalized.scorecard = { ...scorecard, overall: normalized.overallScore };

  const evidence = normalizeEvidenceCollection(normalized.evidence || []);
  const evidenceIndex = buildEvidenceIndex(evidence, normalized.findings);
  normalized.evidence = evidenceIndex.valid;
  normalized.evidenceByFinding = evidenceIndex.byFinding;
  normalized.scoringEvidence = evidenceIndex.scoring;
  normalized.traceability = buildTraceability(normalized.findings);
  normalized.modelVersion = 5;
  return normalized;
}

export { DIMENSION_KEYS, DIMENSION_META, FINDING_SECTION_ORDER, buildEvidenceIndex, normalizeReportModel };
