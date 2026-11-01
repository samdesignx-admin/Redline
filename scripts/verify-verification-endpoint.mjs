import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../api/verify.js";

process.env.VERIFY_SECRET = "test-only-verification-secret";
const email = "tester@example.com";
const code = "123456";
const sign = (purpose, expires, inputCode = code) => crypto.createHmac("sha256", process.env.VERIFY_SECRET)
  .update(`${email}.${purpose}.${inputCode}.${expires}`).digest("hex");
const invoke = async (action, token, suppliedCode = code) => {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
  await handler({ method: "POST", body: { action, email, code: suppliedCode, token } }, res);
  return res;
};
const expiry = Date.now() + 5 * 60_000;
const signupToken = `signup.${expiry}.${sign("signup", expiry)}`;
const valid = await invoke("verify", signupToken);
assert.equal(valid.statusCode, 200);
assert.equal(valid.body.verified, true);
assert.equal(typeof valid.body.emailProof, "string");
assert.equal((await invoke("verify", signupToken, "999999")).statusCode, 400);
assert.equal((await invoke("verify", `unknown.${expiry}.${sign("unknown", expiry)}`)).statusCode, 400);
assert.equal((await invoke("verify", `signup.${Date.now() - 60_000}.deadbeef`)).statusCode, 400);
const farExpiry = Date.now() + 60 * 60_000;
assert.equal((await invoke("verify", `signup.${farExpiry}.${sign("signup", farExpiry)}`)).statusCode, 400);
const resetToken = `reset.${expiry}.${sign("reset", expiry)}`;
const reset = await invoke("verify", resetToken);
assert.equal(reset.statusCode, 200);
assert.equal(reset.body.emailProof, undefined, "reset must not grant signup proof");
console.log("Verification endpoint regression tests passed");
