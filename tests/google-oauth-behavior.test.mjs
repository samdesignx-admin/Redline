// Credential-free behavioral tests for Google sign-in trust boundary.
// Loads the handler with injected fakes; never contacts Supabase or Google.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../api/account.js", import.meta.url), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*["']\.\/_lib\.js["'];?/, "")
  .replace("export const maxDuration", "const maxDuration")
  .replace("export default async function handler", "async function handler");

async function invoke({ clientId, audience, verified = "true", tokenOk = true }) {
  let fetchCalls = 0;
  let dbCalls = 0;
  const db = {
    from() {
      dbCalls++;
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { id: "existing", email: "test@example.com" } }; },
        update() { return this; },
      };
    },
  };
  const sandbox = {
    process: { env: clientId ? { GOOGLE_CLIENT_ID: clientId } : {} },
    fetch: async () => {
      fetchCalls++;
      return { ok: tokenOk, json: async () => ({
        aud: audience, email: "test@example.com", email_verified: verified,
      }) };
    },
    requireDb: () => db,
    cleanEmail: x => String(x || "").trim().toLowerCase(),
    isEmail: x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x),
    publicAccount: x => x,
    issueSession: () => "fake-session",
    console,
  };
  const handler = vm.runInNewContext(source + "\nhandler", sandbox);
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ method: "POST", body: { action: "google", credential: "fake-token" } }, res);
  return { status: res.statusCode, body: res.body, fetchCalls, dbCalls };
}

test("missing client ID fails before network and database access", async () => {
  const r = await invoke({ audience: "expected" });
  assert.equal(r.status, 503);
  assert.equal(r.fetchCalls, 0);
  assert.equal(r.dbCalls, 0);
});

test("mismatched audience is rejected before database access", async () => {
  const r = await invoke({ clientId: "expected", audience: "other" });
  assert.equal(r.status, 401);
  assert.equal(r.fetchCalls, 1);
  assert.equal(r.dbCalls, 0);
});

test("matching audience and verified email can authenticate", async () => {
  const r = await invoke({ clientId: "expected", audience: "expected" });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, "fake-session");
  assert.ok(r.dbCalls > 0);
});

test("Google tokeninfo failure denies access", async () => {
  const r = await invoke({ clientId: "expected", audience: "expected", tokenOk: false });
  assert.equal(r.status, 401);
  assert.equal(r.dbCalls, 0);
});

test("unverified Google email is rejected before database access", async () => {
  for (const verified of ["false", false, undefined, null, "unexpected"]) {
    const r = await invoke({ clientId: "expected", audience: "expected", verified });
    assert.equal(r.status, 401, `email_verified=${String(verified)} must be rejected`);
    assert.equal(r.dbCalls, 0);
  }
});

test("boolean true Google email verification is accepted", async () => {
  const r = await invoke({ clientId: "expected", audience: "expected", verified: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, "fake-session");
});
