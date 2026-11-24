// Run with: node --test scripts/test-free-beta-payment-gate.mjs
import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/payment.js";

test("free beta blocks checkout and verification before database or provider access", async () => {
  const previous = process.env.FREE_BETA_MODE;
  process.env.FREE_BETA_MODE = "true";
  try {
    for (const scenario of [
      { method: "POST", body: { action: "checkout" } },
      { method: "POST", body: { action: "verify" } },
      { method: "POST", body: { action: "unexpected" } },
      { method: "POST", body: {} },
      { method: "GET" },
      { method: "OPTIONS" },
    ]) {
      const label = `${scenario.method}:${scenario.body?.action ?? "no-action"}`;
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
      await handler(scenario, res);
      assert.equal(status, 503, label);
      assert.equal(payload?.code, "PAYMENTS_DISABLED", label);
      assert.equal(headers["cache-control"], "no-store", label);
      assert.equal(payload?.checkout_url, undefined, label);
    }
  } finally {
    if (previous === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = previous;
  }
});
