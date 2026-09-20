import assert from "node:assert/strict";
import {
  MAX_ITEMS,
  MAX_RADIUS,
  MIN_RADIUS,
  normalizeEvidenceCollection,
  normalizeEvidenceTarget,
} from "../src/utils/evidenceModel.js";

const normalized = normalizeEvidenceTarget({
  id: "F-1-0",
  findingIndex: 1,
  targetX: 12.5,
  targetY: 34.5,
  targetRadius: 99,
  target: "Primary navigation menu",
  explanation: "The navigation control is visibly present at the marked point.",
});

assert.equal(normalized.findingId, "F-001");
assert.equal(normalized.id, "F-1-0");
assert.equal(normalized.x, 12.5);
assert.equal(normalized.y, 34.5);
assert.equal(normalized.radius, MAX_RADIUS);
assert.equal(normalized.target, "Primary navigation menu");

assert.equal(normalizeEvidenceTarget({
  findingIndex: 1,
  targetX: 10,
  target: "Missing Y coordinate",
  explanation: "Not renderable without an exact point.",
}), null);

const collection = normalizeEvidenceCollection([
  { findingIndex: 1, targetX: 10, targetY: 20, target: "A", explanation: "A" },
  { findingIndex: 1, targetX: 10, targetY: 20, target: "A", explanation: "A" },
  ...Array.from({ length: MAX_ITEMS + 2 }, (_, i) => ({
    findingIndex: i + 2,
    targetX: i + 1,
    targetY: i + 2,
    target: `Target ${i + 2}`,
    explanation: `Evidence ${i + 2}`,
  })),
]);

assert.equal(collection.length, MAX_ITEMS);
assert.equal(collection[0].findingId, "F-001");
assert.ok(collection.every((item) => item.radius >= MIN_RADIUS && item.radius <= MAX_RADIUS));
assert.equal(new Set(collection.map((item) => `${item.findingId}|${item.x}|${item.y}`)).size, collection.length);

console.log("Canonical evidence model checks passed.");
