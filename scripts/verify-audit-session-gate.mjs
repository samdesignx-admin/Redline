import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const api = readFileSync(new URL("../api/audit.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");
test("Claude proxy rejects missing or invalid signed sessions before calling provider", () => {
  assert.match(api, /const session = readSession\(req\.headers\?\.\["x-uxnest-session"\]\)/);
  assert.match(api, /if \(!session\)\s*\{[\s\S]*?res\.status\(401\)/);
  assert.ok(api.indexOf("const session = readSession") < api.indexOf('fetch("https://api.anthropic.com/v1/messages"'));
});
test("Nest Audit supplies signed session", () => {
  assert.match(ui, /"X-UXNest-Session": getToken\(\)/);
});

test("runtime rejects anonymous Claude requests without calling Anthropic", async () => {
  const { default: auditProxy } = await import("../api/audit.js");
  const prior = process.env.FREE_BETA_MODE;
  delete process.env.FREE_BETA_MODE;
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("Unexpected provider call"); };
  try {
    let status, payload;
    const res = { setHeader() { return this; }, status(n) { status = n; return this; }, json(v) { payload = v; return this; } };
    await auditProxy({ method: "POST", headers: {}, body: { messages: [{ role: "user", content: "hello" }] } }, res);
    assert.equal(status, 401);
    assert.equal(payload.code, "AUDIT_LOGIN_REQUIRED");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prior === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = prior;
  }
});
test("signed session passes auth gate without invoking provider when key absent", async () => {
  const { default: auditProxy } = await import("../api/audit.js");
  const { issueSession } = await import("../api/_lib.js");
  const names = ["FREE_BETA_MODE", "SESSION_SECRET", "ANTHROPIC_API_KEY"];
  const prior = names.map(k => process.env[k]);
  delete process.env.FREE_BETA_MODE;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.SESSION_SECRET = "local-test-only-secret";
  try {
    let status, payload;
    const res = { setHeader() { return this; }, status(n) { status = n; return this; }, json(v) { payload = v; return this; } };
    await auditProxy({ method: "POST", headers: { "x-uxnest-session": issueSession("test-account") }, body: { messages: [{ role: "user", content: "hello" }] } }, res);
    assert.equal(status, 503);
    assert.equal(payload.code, "AUDIT_PROVIDER_NOT_CONFIGURED");
    assert.doesNotMatch(JSON.stringify(payload), /ANTHROPIC_API_KEY|SESSION_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    names.forEach((k,i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; });
  }
});
