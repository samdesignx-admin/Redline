import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../api/_lib.js";

const password = "correct horse battery staple";
const stored = await hashPassword(password);
assert.equal(await verifyPassword(password, stored), true);
assert.equal(await verifyPassword("wrong password", stored), false);
const [salt, digest] = stored.split(":");
assert.match(salt, /^[0-9a-f]{32}$/);
assert.match(digest, /^[0-9a-f]{128}$/);
for (const malformed of [
  "", "not-a-hash", `${salt}:${digest}:extra`, `:${digest}`,
  `${salt}:`, `${salt}:${digest.slice(0, -2)}`,
  `${salt}:${"g".repeat(128)}`, `${"z".repeat(32)}:${digest}`,
  `${salt.toUpperCase()}:${digest}`, `${salt}:${digest.toUpperCase()}`,
  null, undefined, 42, {}, [],
]) {
  let result;
  try { result = await verifyPassword(password, malformed); }
  catch (error) { assert.fail(`malformed stored hash must not throw: ${String(error)}`); }
  assert.equal(result, false, `malformed stored hash accepted: ${String(malformed).slice(0, 36)}`);
}
console.log("Async authentication malformed-hash regression passed");
