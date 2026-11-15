import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("verification endpoint does not echo Resend upstream response bodies", () => {
  const source = readFileSync(new URL("../api/verify.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /detail\.slice\s*\(/);
  assert.doesNotMatch(source, /error:\s*`[^\`]*\$\{detail/);
  assert.match(source, /if \(!r\.ok\)\s*\{[\s\S]*?res\.status\(502\)\.json\(\{ error: "Couldn't send the verification email\. Please try again later\." \}\)/);
});
