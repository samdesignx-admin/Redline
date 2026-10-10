import assert from "node:assert/strict";
import { buildEvidenceIndex, normalizeReportModel } from "../src/utils/reportModel.js";
import { parseIssues } from "../src/utils/reportParser.js";

const report = normalizeReportModel({
  usability: {
    issues: [
      { title: "Navigation is unclear" },
      { title: "Search is hard to find" },
    ],
  },
  visual: { issues: [] },
  accessibility: { issues: [] },
  trust: { issues: [] },
  conversion: { issues: [] },
  cognitive: { issues: [] },
  scorecard: { usability: 70, accessibility: 80, visual: 75, trust: 72, conversion: 68 },
  evidence: [
    { id: "E-01", findingId: "F-001", x: 18, y: 22, target: "Primary navigation menu", explanation: "Primary navigation" },
    { id: "E-02", findingId: "F-002", x: 44, y: 55, target: "Header search input field", explanation: "Search control" },
    { id: "E-03", findingId: "F-999", x: 80, y: 80, target: "Footer legal links row", explanation: "Should be rejected: no such finding" },
  ],
});

assert.equal(report.modelVersion, 5);
assert.equal(report.findings.length, 2);
assert.equal(report.evidence.length, 2);
assert.equal(report.evidenceByFinding["F-001"].length, 1);
assert.equal(report.evidenceByFinding["F-002"].length, 1);
assert.equal(report.evidenceByFinding["F-999"], undefined);
assert.equal(report.scoringEvidence.length, 2);

const index = buildEvidenceIndex(report.evidence, report.findings);
assert.deepEqual(index.valid.map((item) => item.findingId), ["F-001", "F-002"]);

const incomplete = normalizeReportModel({
  usability: { issues: [] }, visual: { issues: [] }, accessibility: { issues: [] },
  trust: { issues: [] }, conversion: { issues: [] },
  scorecard: { usability: 70, accessibility: 80, visual: null, trust: 72, conversion: 68 },
});
assert.equal(incomplete.dimensions[2].score, null);
assert.equal(incomplete.overallScore, null);
assert.equal(incomplete.summary.score, null);

const driftedIssues = parseIssues(`Context intro must remain visible.
Issue: First finding
Severity: High
Why it matters: First rationale.
Recommendation: First fix.

Issue: Second finding
Severity: Medium
Why it matters: Second rationale with a colon: still text.
Recommendation: Second fix.

Issue: Third finding
Severity: Low
Why it matters: Third rationale.
Recommendation: Third fix.`);
assert.match(driftedIssues.intro, /Context intro/);
assert.equal(driftedIssues.issues.length, 3);
assert.equal(driftedIssues.issues[1].title, "Second finding");
assert.equal(driftedIssues.issues[2].recommendation, "Third fix");

console.log("Canonical report-model, null-score, and tolerant-parser checks passed.");
