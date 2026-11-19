import test from "node:test";
import assert from "node:assert/strict";
import payment from "../api/payment.js";
import webhook from "../api/creem-webhook.js";

test("free beta rejects checkout and payment verification without DB or Creem configuration", async () => {
  const before = process.env.FREE_BETA_MODE;
  process.env.FREE_BETA_MODE = "true";
  try {
    for (const req of [
      { method: "POST", body: { action: "checkout" } },
      { method: "POST", body: { action: "verify" } },
      { method: "POST", body: {} },
      { method: "GET" },
      { method: "OPTIONS" },
    ]) {
      let status, payload;
      const headers = {};
      const res = {
        setHeader(k, v) { headers[k.toLowerCase()] = v; return this; },
        status(n) { status = n; return this; },
        json(v) { payload = v; return this; },
      };
      await payment(req, res);
      assert.equal(status, 503);
      assert.equal(payload.code, "PAYMENTS_DISABLED");
      assert.equal(headers["cache-control"], "no-store");
    }
  } finally {
    if (before === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = before;
  }
});

test("free beta still validates legacy Creem webhooks for refund reconciliation", async () => {
  const before = process.env.FREE_BETA_MODE;
  const beforeSecret = process.env.CREEM_WEBHOOK_SECRET;
  process.env.FREE_BETA_MODE = "true";
  delete process.env.CREEM_WEBHOOK_SECRET;
  try {
    let status, body;
    const res = {
      setHeader() { return this; },
      status(n) { status = n; return this; },
      send(v) { body = v; return this; },
    };
    await webhook({ method: "POST", headers: {} }, res);
    assert.equal(status, 503);
    assert.match(body, /webhook is not configured/);
  } finally {
    if (before === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = before;
    if (beforeSecret === undefined) delete process.env.CREEM_WEBHOOK_SECRET;
    else process.env.CREEM_WEBHOOK_SECRET = beforeSecret;
  }
});
