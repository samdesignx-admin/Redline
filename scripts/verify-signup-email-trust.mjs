// Static regression guard: signup must never persist client-asserted email verification.
// This does not replace mocked API or isolated end-to-end tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../api/account.js", import.meta.url), "utf8");
const signup = source.split('if (action === "signup") {')[1]?.split('/* ---------------- Log in ---------------- */')[0];
assert.ok(signup, "Signup handler must exist");
assert.match(signup, /email_verified:\s*false\s*,/, "Signup must default email_verified to false");
assert.doesNotMatch(signup, /email_verified:\s*(?:!!)?emailVerified/, "Client verification flag must not be trusted");
assert.doesNotMatch(signup, /(?:req\.body\.emailVerified|\{[^}]*emailVerified[^}]*\}\s*=\s*req\.body)/, "Signup must not read client verification status");
console.log("PASS: signup does not trust client-supplied emailVerified");
