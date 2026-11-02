import test from "node:test";
import assert from "node:assert/strict";
import { trustedPaymentSuccessUrl } from "../api/_payment-url.js";

test("uses trusted production origin by default", () => {
  assert.equal(trustedPaymentSuccessUrl(""), "https://uxnest.ai/payment/success?payment=success");
});
test("supports configured HTTPS preview origin", () => {
  assert.equal(trustedPaymentSuccessUrl("https://preview.example.com/"), "https://preview.example.com/payment/success?payment=success");
});
test("rejects unsafe or malformed configuration", () => {
  for (const url of ["http://evil.example", "javascript:alert(1)", "https://user:pass@example.com/", "https://example.com/redirect", "https://example.com/?next=evil", "https://example.com/#frag", "not a url"]) {
    assert.throws(() => trustedPaymentSuccessUrl(url));
  }
});
