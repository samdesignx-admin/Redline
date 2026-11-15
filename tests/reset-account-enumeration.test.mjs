import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../api/verify.js", import.meta.url), "utf8");

test("password reset does not explicitly reveal account existence", () => {
  assert.doesNotMatch(source, /No account exists with that email address/i);
  assert.match(source, /if \(!account\)\s*\{\s*res\.status\(400\)\.json\(\{ error: "Unable to reset the password with this code\./);
});

test("password reset still requires a valid signed reset token before account lookup", () => {
  const reset = source.slice(source.indexOf('if (action === "reset")'));
  assert.ok(reset.indexOf('const ok = a.length === b.length && crypto.timingSafeEqual(a, b);') >= 0);
  assert.ok(reset.indexOf('if (!ok)') < reset.indexOf('const db = requireDb(res);'));
});
