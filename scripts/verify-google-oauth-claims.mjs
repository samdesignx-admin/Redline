import assert from "node:assert/strict";
import { googleTokenClaimsStatus } from "../api/_google-claims.js";
const valid = { aud: "expected-client", email_verified: true };
for (const clientId of [undefined, null, "", "  "]) {
  assert.equal(googleTokenClaimsStatus(valid, clientId), "misconfigured");
}
assert.equal(googleTokenClaimsStatus(valid, "different-client"), "wrong_audience");
assert.equal(googleTokenClaimsStatus(null, "expected-client"), "wrong_audience");
for (const value of [false, "false", undefined, null, 0, "TRUE"]) {
  assert.equal(googleTokenClaimsStatus({ ...valid, email_verified: value }, "expected-client"), "unverified");
}
for (const value of [true, "true"]) {
  assert.equal(googleTokenClaimsStatus({ ...valid, email_verified: value }, "expected-client"), "valid");
}
console.log("Google OAuth claim validation regression passed");
