import assert from "node:assert/strict";
import { gateVisualEvidence, looksLikeAccessControl, shouldGeneratePreciseEvidence } from "../src/utils/evidenceGate.js";

const screenshot = "data:image/jpeg;base64,AAAA";

assert.equal(looksLikeAccessControl("Akamai Reference #18.7a3d"), true);
assert.equal(looksLikeAccessControl("Tesla homepage"), false);

const blocked = gateVisualEvidence({
  screenshot,
  retrievalStatus: "VISUAL_ONLY",
  diagnostics: "Browser renderer returned an access-control page. Akamai reference number.",
});
assert.equal(blocked.allowed, false);
assert.equal(blocked.state, "access-control");
assert.equal(blocked.status, "blocked");
assert.equal(shouldGeneratePreciseEvidence(blocked), false);

const usable = gateVisualEvidence({
  screenshot,
  screenshotState: "usable-page",
  retrievalStatus: "SUFFICIENT",
});
assert.equal(usable.allowed, true);
assert.equal(usable.status, "observed");
assert.equal(shouldGeneratePreciseEvidence(usable), true);

const missing = gateVisualEvidence({ screenshot: null });
assert.equal(missing.allowed, false);
assert.equal(missing.status, "insufficient");

console.log("Visual evidence gate checks passed.");
