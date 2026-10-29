import assert from "node:assert/strict";
import { expectedBatchSections, generatedReportSections, missingBatchSections } from "../src/utils/reportCompleteness.js";

const template = `# Executive Summary
Describe the audit, score and strongest concerns.

# Usability Analysis
State evidence-supported usability findings.

# Visual Design Analysis
State evidence-supported visual design findings.`;
const partial = `# Executive Summary
This sample report has a useful factual overview and sufficient context.

# Visual Design Analysis
No material visual design issues identified from the available evidence.`;
assert.deepEqual(expectedBatchSections(template).map((item) => item.heading), [
  "Executive Summary", "Usability Analysis", "Visual Design Analysis",
]);
assert.deepEqual(missingBatchSections(template, partial).map((item) => item.heading), ["Usability Analysis"]);

const headerOnly = partial + "\n\n# Usability Analysis\n";
assert.deepEqual(missingBatchSections(template, headerOnly).map((item) => item.heading), ["Usability Analysis"]);

const repaired = headerOnly + "\nThe primary navigation has ambiguous category names and unclear feedback.";
assert.equal(missingBatchSections(template, repaired).length, 0);
assert.equal(generatedReportSections(repaired).size, 3);

// Markdown heading depth is normalized before parsing.
const variant = `## Usability Analysis
Navigation is visible and can be assessed from the recorded page evidence.`;
assert.equal(missingBatchSections("# Usability Analysis\nAudit navigation.", variant).length, 0);
console.log("AI report section completeness and retry guard checks passed.");
