import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../api/_lib.js";

const password = "correct horse battery staple";
const hash = await hashPassword(password);
assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
assert.equal(await verifyPassword(password, hash), true);
assert.equal(await verifyPassword("wrong password", hash), false);
assert.equal(await verifyPassword(password, ""), false);
assert.equal(await verifyPassword(password, "invalid"), false);
const second = await hashPassword(password);
assert.notEqual(hash, second, "Each password must have a unique random salt");
assert.equal(await verifyPassword(password, second), true);
console.log("Async password hashing and verification tests passed.");
