import assert from "node:assert/strict";
import { buildTraceability } from "../src/utils/traceability.js";

const result = buildTraceability([
  { id: "F-001", why: "Users cannot find navigation", recommendation: "Improve navigation labels" },
  { id: "F-002", why: "Users cannot find navigation", recommendation: "Improve navigation labels" },
  { id: "F-003", why: "Checkout has unclear labels", recommendation: "Clarify checkout labels" },
]);

assert.equal(result.rootCauses.length, 2);
assert.equal(result.recommendations.length, 2);
assert.equal(result.links.length, 3);
// Findings that share a root cause and recommendation link to the same ids;
// only the finding id itself differs.
assert.equal(result.links[0].findingId, "F-001");
assert.equal(result.links[1].findingId, "F-002");
assert.equal(result.links[0].rootCauseId, result.links[1].rootCauseId);
assert.equal(result.links[0].recommendationId, result.links[1].recommendationId);
assert.notEqual(result.links[0].rootCauseId, result.links[2].rootCauseId);
assert.equal(result.rootCauses[0].findingIds.length, 2);
assert.equal(result.recommendations[0].findingIds.length, 2);
console.log("Finding traceability checks passed.");
