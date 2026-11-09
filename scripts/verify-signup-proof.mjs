import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validSignupProof } from "../api/_signup-proof.js";
const secret = "test-only-secret-that-is-long-enough";
const now = Date.now();
const email = "person@example.com";
const code = "123456";
function proof(purpose="signup", e=email, c=code, expiry=now+300000) {
  const sig=crypto.createHmac("sha256",secret).update(`${e}.${purpose}.${c}.${expiry}`).digest("hex");
  return `${purpose}.${expiry}.${sig}`;
}
assert.equal(validSignupProof(email,proof(),code,secret,now),true);
for (const [token,c,s,e,t] of [
  [proof(),"000000",secret,email,now],
  [proof("reset"),code,secret,email,now],
  [proof(),code,secret,"other@example.com",now],
  [proof(),code,"",email,now],
  [proof(),code,secret,email,now+600000],
  [proof("signup",email,code,now-1),code,secret,email,now],
  [proof().replace(/.$/,"x"),code,secret,email,now],
  [undefined,code,secret,email,now],
]) assert.equal(validSignupProof(e,token,c,s,t),false);
console.log("Signup proof positive/negative tests passed");
