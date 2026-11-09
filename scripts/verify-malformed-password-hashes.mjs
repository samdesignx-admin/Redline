// Regression guard for malformed password hashes. Run: node scripts/verify-malformed-password-hashes.mjs
// This intentionally fails against vulnerable implementations; merge only with the corresponding fix.
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../api/_lib.js";

const password = "correct horse battery staple";
const stored = await hashPassword(password);
assert.equal(await verifyPassword(password, stored), true, "valid hash must verify");
assert.equal(await verifyPassword("wrong password", stored), false, "wrong password must fail");
const [salt, digest] = stored.split(":");
assert.match(salt, /^[0-9a-f]{32}$/);
assert.match(digest, /^[0-9a-f]{128}$/);
for (const malformed of [
  "", "not-a-hash", `${salt}:${digest}:extra`, `:${digest}`,
  `${salt}:`, `${salt}:${digest.slice(0, -2)}`,
  `${salt}:${"g".repeat(128)}`, `${"z".repeat(32)}:${digest}`,
]) {
  let result;
  try { result = await verifyPassword(password, malformed); }
  catch (error) { assert.fail(`malformed stored hash must not throw: ${String(error)}`); }
  assert.equal(result, false, `malformed stored hash was accepted: ${malformed.slice(0, 36)}`);
}
console.log("Malformed password hash regression checks passed");
