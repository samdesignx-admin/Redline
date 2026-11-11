// Release gate for issue #41. Static inspection only: NOT proof of end-to-end security.
// Run with: node --test tests/signup-trust-boundary.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const account = readFileSync(new URL('../api/account.js', import.meta.url), 'utf8');
const signup = account.split('if (action === "signup")')[1]?.split('/* ---------------- Log in')[0];

test('signup must not trust a client-provided emailVerified flag', () => {
  assert.ok(signup, 'signup handler must exist');
  assert.doesNotMatch(signup, /email_verified\s*:\s*!!\s*emailVerified\b/, 'Client boolean must never set verified status');
  assert.doesNotMatch(signup, /email_verified\s*:\s*emailVerified\b/, 'Client boolean must never set verified status');
});

test('signup must explicitly validate email proof on the server before session issuance', () => {
  assert.ok(signup, 'signup handler must exist');
  // Intentional conservative release gate. Any alternate implementation requires updating
  // this gate with an executable mocked endpoint test, not simply removing the assertion.
  assert.match(signup, /(?:validSignupProof|verifySignupProof|consumeSignupProof|validateSignupProof)\s*\(/,
    'Require server-side, email-bound, signup-purpose proof validation');
});
