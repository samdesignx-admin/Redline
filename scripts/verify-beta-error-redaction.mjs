import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("beta audit API does not echo raw database error messages", () => {
  const source = fs.readFileSync(new URL("../api/audits.js", import.meta.url), "utf8");
  assert.match(source, /if \(isFreeBeta\) \{\s*console\.error\(/);
  assert.match(source, /code: "BETA_AUDIT_INTERNAL_ERROR"/);
  assert.match(source, /res\.status\(500\)\.json\(\{\s*error: "We couldn't complete the audit request/);
});

test("beta AI proxy remains fail-closed pending atomic quota reservation", () => {
  const source = fs.readFileSync(new URL("../api/audit.js", import.meta.url), "utf8");
  assert.match(source, /code: "BETA_RESERVATION_NOT_READY"/);
});
