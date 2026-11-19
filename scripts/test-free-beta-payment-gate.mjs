// Run with: node --test scripts/test-free-beta-payment-gate.mjs
import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/payment.js";

test("free beta blocks checkout and verification before database or provider access", async () => {
  const previous = process.env.FREE_BETA_MODE;
  process.env.FREE_BETA_MODE = "true";
  try {
    for (const action of ["checkout", "verify", "unexpected"]) {
      let status;
      let payload;
      const headers = {};
      const res = {
        setHeader(name, value) { headers[name.toLowerCase()] = value; return this; },
        status(value) { status = value; return this; },
        json(value) { payload = value; return this; },
      };
      // No session, database, or Creem configuration: a successful test proves
      // the beta gate returns before those dependencies are accessed.
      await handler({ method: "POST", body: { action } }, res);
      assert.equal(status, 503, action);
      assert.equal(payload?.code, "PAYMENTS_DISABLED", action);
      assert.equal(headers["cache-control"], "no-store", action);
      assert.equal(payload?.checkout_url, undefined, action);
    }
  } finally {
    if (previous === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = previous;
  }
});
