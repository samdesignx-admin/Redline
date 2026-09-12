import assert from "node:assert/strict";
import { buildEvidenceIndex, normalizeReportModel } from "../src/utils/reportModel.js";

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
    { id: "E-01", findingId: "F-001", x: 18, y: 22, target: "nav", explanation: "Primary navigation" },
    { id: "E-02", findingId: "F-002", x: 44, y: 55, target: "search", explanation: "Search control" },
    { id: "E-03", findingId: "F-999", x: 80, y: 80, target: "unknown", explanation: "Should be rejected" },
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
console.log("Canonical report-model evidence checks passed.");
