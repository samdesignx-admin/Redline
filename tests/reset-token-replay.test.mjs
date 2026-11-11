// Regression gate for password-reset replay protection.
// Run: node --test tests/reset-token-replay.test.mjs
// This static gate intentionally fails until the reset handler atomically consumes
// a durable, single-use token. It is NOT an executable concurrency test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/verify.js', import.meta.url), 'utf8');
const reset = source.split('if (action === "reset")')[1]?.split('res.status(200).json({ reset: true })')[0];

test('password reset requires durable atomic token consumption before password update', () => {
  assert.ok(reset, 'password reset handler must exist');
  // A stateless HMAC signature validates authenticity but does not prevent replay.
  // Implementation must replace this static gate with a mocked concurrency test
  // proving exactly one successful reset for two simultaneous uses of one token.
  assert.match(reset, /(?:consumeResetToken|consumePasswordResetToken|redeemResetToken)\s*\(/,
    'Missing atomic durable one-time reset token consumption');
  const consume = reset.search(/(?:consumeResetToken|consumePasswordResetToken|redeemResetToken)\s*\(/);
  const update = reset.indexOf('.update({');
  assert.ok(update > consume, 'Consume reset token before updating password');
});

test('reset flow must not rely solely on signature validation', () => {
  assert.ok(reset, 'password reset handler must exist');
  assert.doesNotMatch(reset, /const expected = sign\([^;]+;[\s\S]*?\.update\(\{/,
    'Stateless signature validation alone allows reuse until expiration');
});
