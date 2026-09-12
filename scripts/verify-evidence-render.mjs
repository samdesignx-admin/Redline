import assert from "node:assert/strict";
import { projectEvidenceTarget, markerStyle, focusedEvidenceStyle } from "../src/utils/evidenceRender.js";

const target = projectEvidenceTarget({ findingId: "F-007", screenshotId: "shot-1", cx: 87, cy: 12, radius: 9, target: "Buy button", explanation: "Visible CTA" });
assert.deepEqual(target, {
  findingId: "F-007",
  screenshotId: "shot-1",
  cx: 87,
  cy: 12,
  radius: 4.5,
  target: "Buy button",
  explanation: "Visible CTA",
});

const geometry = markerStyle(target);
assert.equal(geometry.left, "87%");
assert.equal(geometry.top, "12%");
assert.equal(geometry.width, "9%");
assert.equal(geometry.transform, "translate(-50%, -50%)");

const focused = focusedEvidenceStyle(target);
assert.equal(focused.objectPosition, "87% 12%");
assert.equal(focused.markerLeft, "50%");
assert.equal(focused.markerTop, "50%");

console.log("Evidence render projection checks passed.");
