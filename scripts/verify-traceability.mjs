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
assert.deepEqual(result.links[0], result.links[1]);
assert.equal(result.rootCauses[0].findingIds.length, 2);
assert.equal(result.recommendations[0].findingIds.length, 2);
console.log("Finding traceability checks passed.");
