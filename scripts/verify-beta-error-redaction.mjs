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

test("Claude upstream errors are redacted before reaching clients", () => {
  const source = fs.readFileSync(new URL("../api/audit.js", import.meta.url), "utf8");
  const errorBranch = source.match(/if \(!upstream\.ok\) \{([\s\S]*?)\n    \}\n\n    res\.status\(upstream\.status\)\.json\(data\);/);
  assert.ok(errorBranch, "upstream failure handler must exist before successful response");
  const failure = errorBranch[1];
  assert.match(failure, /code: "AUDIT_PROVIDER_ERROR"/);
  assert.match(failure, /retryable,/);
  assert.match(failure, /requestId,/);
  assert.doesNotMatch(failure, /res\.status\([^)]*\)\.json\(data\)/);
  assert.doesNotMatch(failure, /JSON\.stringify\(data\)/);
});

test("legacy audit API redacts database errors too", () => {
  const source = fs.readFileSync(new URL("../api/audits.js", import.meta.url), "utf8");
  assert.match(source, /code: "AUDIT_INTERNAL_ERROR"/);
  assert.doesNotMatch(source, /Audit request failed:.*e\.message/);
  assert.match(source, /console\.error\("audit_request_error", e\)/);
});
