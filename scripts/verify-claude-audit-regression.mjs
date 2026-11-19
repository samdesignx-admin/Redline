import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");

test("Claude request body is executable and uses a sufficient output budget", () => {
  const declaration = /^\s*const body = \{ model: "claude-sonnet-5-5", max_tokens: (\d+), messages \};\s*$/m.exec(source);
  assert.ok(declaration, "Claude request body must remain on its own code line");
  assert.ok(Number(declaration[1]) >= 2000, "Report response budget unexpectedly reduced");
  assert.match(source, /body: JSON\.stringify\(body\)/);
});

test("core report batch failures retain actionable cause and stage", () => {
  assert.match(source, /uxnest_audit_core_batch_failed/);
  assert.match(source, /const detail = cause\?\.code === "AUDIT_INCOMPLETE"/);
  assert.match(source, /Ranking and scoring were not generated\. No audit credit was used\./);
});
