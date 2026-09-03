/**
 * Canonical UXNest report model.
 *
 * This layer normalizes parsed report data without changing the existing
 * prompt contract or score semantics. It is intentionally backward-compatible:
 * legacy reports that only contain the original section fields receive the
 * canonical fields at parse time, while existing consumers can continue using
 * summary/usability/visual/etc.
 */

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

  // Phase 1 deliberately preserves existing score behavior. Phase 2 will make
  // overallScore deterministic from canonical dimension scores.
  normalized.overallScore = normalized.summary?.score ?? scorecard.overall ?? null;
  normalized.modelVersion = 1;

  return normalized;
}

export {
  DIMENSION_KEYS,
  DIMENSION_META,
  FINDING_SECTION_ORDER,
  normalizeReportModel,
};
