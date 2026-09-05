/**
 * Canonical UXNest report model.
 *
 * This layer normalizes parsed report data without changing the existing
 * prompt contract or score semantics. It is intentionally backward-compatible:
 * legacy reports that only contain the original section fields receive the
 * canonical fields at parse time, while existing consumers can continue using
 * summary/usability/visual/etc.
 */

import { normalizeEvidenceCollection } from "./evidenceModel.js";

const DIMENSION_KEYS = ["usability", "accessibility", "visual", "trust", "conversion"];

const DIMENSION_META = {
  usability: { id: "usability", label: "Usability" },
  accessibility: { id: "accessibility", label: "Accessibility" },
  visual: { id: "visual", label: "Visual Design" },
  trust: { id: "trust", label: "Trust" },
  conversion: { id: "conversion", label: "Conversion" },
};

const FINDING_SECTION_ORDER = [
  "usability",
  "visual",
  "accessibility",
  "trust",
  "conversion",
  "cognitive",
];

function normalizeIssue(issue, id, section) {
  return {
    ...issue,
    id,
    section,
  };
}

function normalizeIssueSection(sectionData, section, nextFindingNumber) {
  const data = sectionData || {};
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const normalizedIssues = issues.map((issue, index) =>
    normalizeIssue(
      issue,
      `F-${String(nextFindingNumber + index).padStart(3, "0")}`,
      section
    )
  );

  return {
    ...data,
    issues: normalizedIssues,
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
  normalized.dimensions = DIMENSION_KEYS.map((key) => ({
    ...DIMENSION_META[key],
    score: scorecard[key] ?? null,
  }));

  normalized.findings = FINDING_SECTION_ORDER.flatMap((section) =>
    normalized[section]?.issues || []
  );

  const dimensionScores = normalized.dimensions
    .map((dimension) => Number(dimension.score))
    .filter((score) => Number.isFinite(score));

  normalized.overallScore = dimensionScores.length
    ? Math.round(dimensionScores.reduce((sum, score) => sum + score, 0) / dimensionScores.length)
    : null;

  normalized.summary = {
    ...(normalized.summary || {}),
    score: normalized.overallScore,
  };
  normalized.scorecard = {
    ...scorecard,
    overall: normalized.overallScore,
  };

  // Canonical evidence is optional for legacy reports. When evidence is later
  // attached by the audit pipeline, every renderer can consume the same shape.
  normalized.evidence = normalizeEvidenceCollection(normalized.evidence || []);

  normalized.modelVersion = 3;

  return normalized;
}

export {
  DIMENSION_KEYS,
  DIMENSION_META,
  FINDING_SECTION_ORDER,
  normalizeReportModel,
};
