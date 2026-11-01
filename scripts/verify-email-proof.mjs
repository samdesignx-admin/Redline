import assert from "node:assert/strict";
import { issueEmailProof, validateEmailProof } from "../api/_lib.js";

process.env.VERIFY_SECRET = "local-test-secret-do-not-use-in-production";
const email = "Example@Example.com";
const proof = issueEmailProof(email);
assert.equal(validateEmailProof(email, proof), true, "fresh proof should validate");
assert.equal(validateEmailProof("example@example.com", proof), true, "email normalization");
assert.equal(validateEmailProof("other@example.com", proof), false, "proof is email-bound");
assert.equal(validateEmailProof(email, ""), false);
assert.equal(validateEmailProof(email, "not-a-proof"), false);
const [expiry, sig] = proof.split(".");
assert.equal(validateEmailProof(email, `${expiry}.${"0".repeat(64)}`), false, "forgery");
assert.equal(validateEmailProof(email, `${Date.now() - 1000}.${sig}`), false, "expired proof");
assert.equal(validateEmailProof(email, `${Date.now() + 60 * 60 * 1000}.${sig}`), false, "far-future proof");
console.log("Email proof regression tests passed");
