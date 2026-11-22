import test from "node:test";
import assert from "node:assert/strict";
import { safeMaxTokens } from "../api/audit.js";

test("Anthropic output token budget stays a positive integer within 4096", () => {
  for (const input of [undefined, null, "", -5, 0, "invalid", Infinity, NaN]) {
    assert.equal(safeMaxTokens(input), 1000);
  }
  assert.equal(safeMaxTokens(0.5), 1000);
  assert.equal(safeMaxTokens(1.9), 1);
  assert.equal(safeMaxTokens(2048), 2048);
  assert.equal(safeMaxTokens(100000), 4096);
});
