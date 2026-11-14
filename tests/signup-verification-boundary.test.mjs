// Security regression: signup must not accept an email-verification claim from the browser.
// Run: node --test tests/signup-verification-boundary.test.mjs
// Intentionally fails against vulnerable main; no database, network, or secrets required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/account.js', import.meta.url), 'utf8');
const signup = source.split('if (action === "signup") {')[1]?.split('/* ---------------- Log in')[0];
assert.ok(signup, 'signup handler must be located for this regression test');

test('signup must not read a client-provided emailVerified claim', () => {
  assert.doesNotMatch(signup, /(?:req\.body\.emailVerified|\{[^}]*\bemailVerified\b[^}]*\}\s*=\s*req\.body)/,
    'Email verification must be established server-side, never from req.body');
});

test('signup must not persist a browser-provided verification boolean', () => {
  assert.doesNotMatch(signup, /email_verified\s*:\s*!!\s*emailVerified\b/,
    'Persist unverified by default until a server-validated proof is consumed');
});
