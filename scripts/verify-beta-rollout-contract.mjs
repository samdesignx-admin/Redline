import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const records = readFileSync(new URL("../api/audits.js", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../api/audit.js", import.meta.url), "utf8");
const sql = readFileSync(new URL("../docs/free-beta-monthly-quota-review.sql", import.meta.url), "utf8");

test("beta audit create is blocked before unverified AI reservation rollout", () => {
  const create = records.slice(records.indexOf('if (action === "create")'));
  assert.match(create, /if \(isFreeBeta\) \{/);
  assert.doesNotMatch(create.slice(0, create.indexOf("BETA_RESERVATION_NOT_READY")), /FREE_BETA_AI_PROXY_ENABLED/);
  assert.match(create, /BETA_RESERVATION_NOT_READY/);
  assert.ok(create.indexOf("BETA_RESERVATION_NOT_READY") < create.indexOf('db.rpc('));
});

test("AI proxy still refuses all beta traffic until reservation is implemented", () => {
  assert.match(proxy, /BETA_RESERVATION_NOT_READY/);
  assert.match(proxy, /readSession/);
  assert.ok(proxy.indexOf("BETA_RESERVATION_NOT_READY") < proxy.indexOf('fetch("https:\/\/api.anthropic.com'));
});

test("draft SQL retains deletion-safe usage and service-role-only RPC", () => {
  assert.match(sql, /audit_id uuid references public\.audits\(id\) on delete set null/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /unique \(account_id, request_id\)/i);
  assert.match(sql, /revoke execute on function public\.create_free_beta_audit/i);
  assert.match(sql, /grant execute on function public\.create_free_beta_audit[\s\S]*to service_role/i);
});
