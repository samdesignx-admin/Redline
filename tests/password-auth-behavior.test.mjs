// Credential-free behavioral tests for password authentication session gates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../api/account.js", import.meta.url), "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*["']\.\/_lib\.js["'];?/, "")
  .replace("export const maxDuration", "const maxDuration")
  .replace("export default async function handler", "async function handler");

async function invoke(action, { verified = false, passwordValid = true, sessionValid = true, signupVerified = true } = {}) {
  let issued = 0;
  let inserted = null;
  let updates = 0;
  const account = { id: "account-1", email: "person@example.com", email_verified: verified, password_hash: "fake-hash" };
  const db = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: action === "signup" ? null : account }; },
        insert(value) { inserted = value; return this; },
        single() { return Promise.resolve({ data: { ...inserted, id: "new-account" }, error: null }); },
        update() { updates++; return this; },
      };
    },
  };
  const sandbox = {
    requireDb: () => db,
    readSession: () => sessionValid ? { accountId: "account-1" } : null,
    cleanEmail: x => String(x || "").trim().toLowerCase(),
    isEmail: x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x),
    verifyPassword: () => passwordValid,
    hashPassword: () => "hashed",
    publicAccount: x => x,
    issueSession: () => { issued++; return "fake-token"; },
    console,
  };
  const handler = vm.runInNewContext(source + "\nhandler", sandbox);
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
  await handler({ method: "POST", body: {
    action, email: "person@example.com", password: "password123",
    token: "fake-token", name: "Test", email_verified: signupVerified,
  } }, res);
  return { status: res.statusCode, body: res.body, issued, inserted, updates };
}

test("signup ignores client-supplied verification and issues no session", async () => {
  const r = await invoke("signup");
  assert.equal(r.status, 202);
  assert.equal(r.inserted.email_verified, false);
  assert.equal(r.issued, 0);
  assert.equal(r.body.verificationRequired, true);
  assert.equal(r.body.token, undefined);
});

test("unverified password account cannot log in", async () => {
  const r = await invoke("login", { verified: false });
  assert.equal(r.status, 403);
  assert.equal(r.issued, 0);
  assert.equal(r.updates, 0);
});

test("verified password account can log in", async () => {
  const r = await invoke("login", { verified: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, "fake-token");
  assert.equal(r.issued, 1);
});

test("incorrect password cannot log in even when verified", async () => {
  const r = await invoke("login", { verified: true, passwordValid: false });
  assert.equal(r.status, 401);
  assert.equal(r.issued, 0);
});

test("unverified account cannot restore an existing session", async () => {
  const r = await invoke("session", { verified: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.account, null);
});

test("verified account can restore an existing session", async () => {
  const r = await invoke("session", { verified: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.account.id, "account-1");
});

test("invalid session returns no account", async () => {
  const r = await invoke("session", { sessionValid: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.account, null);
});
