// Regression guard for Google ID token audience validation.
// This is a source-level check, not a mocked OAuth integration test.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../api/account.js", import.meta.url), "utf8");
const google = source.split('if (action === "google") {')[1];
assert.ok(google, "Google sign-in handler missing");
assert.match(google, /const expectedAud = process\.env\.GOOGLE_CLIENT_ID;/);
assert.match(google, /if \(!expectedAud\)\s*\{\s*res\.status\(503\)/, "missing client ID must fail closed");
assert.match(google, /if \(info\.aud !== expectedAud\)\s*\{\s*res\.status\(401\)/, "mismatched audience must fail closed");
assert.ok(google.indexOf("if (!expectedAud)") < google.indexOf('db.from("accounts")'), "configuration check must precede account access");
assert.ok(google.indexOf("if (info.aud !== expectedAud)") < google.indexOf('db.from("accounts")'), "audience check must precede account access");
console.log("Google OAuth audience source guard passed");
