// Static security guardrails for the Google OAuth tokeninfo trust boundary.
// No network, credentials or database access required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/account.js', import.meta.url), 'utf8');
const google = source.split('if (action === "google") {')[1]?.split('res.status(400).json({ error: "Unknown action" })')[0];
assert.ok(google, 'Google sign-in handler must exist');

test('Google audience configuration is required before comparing the token audience', () => {
  assert.match(google, /if\s*\(!expectedAud\)\s*\{[\s\S]*?return\s*;[\s\S]*?\}/);
  assert.match(google, /if\s*\(info\.aud\s*!==\s*expectedAud\)/);
  assert.doesNotMatch(google, /if\s*\(expectedAud\s*&&\s*info\.aud/);
});

test('Google email_verified must explicitly be true, not merely non-false', () => {
  assert.match(google, /info\.email_verified\s*!==\s*true\s*&&\s*info\.email_verified\s*!==\s*["']true["']/);
  assert.doesNotMatch(google, /info\.email_verified\s*===\s*["']false["']/);
});


test('Google issuer must match an explicit trusted issuer allowlist', () => {
  assert.match(google, /info\.iss\s*!==\s*["']accounts\.google\.com["']/);
  assert.match(google, /info\.iss\s*!==\s*["']https:\/\/accounts\.google\.com["']/);
  assert.match(google, /Google sign-in issuer was not recognized/);
});

test('account API catches internal errors without exposing exception details to clients', () => {
  const handler = source.split('export default async function handler')[1];
  assert.ok(handler, 'Account handler must exist');
  const catchBlock = handler.slice(handler.lastIndexOf('} catch (e) {'));
  assert.match(catchBlock, /res\.status\(500\)\.json\(\{ error: ["']Account request failed\. Please try again later\.["'] \}\)/);
  assert.doesNotMatch(catchBlock, /res\.status\(500\)[\s\S]*?\.json\([^\n]*(?:e\.message|String\(e\)|error\.message)/);
  assert.doesNotMatch(catchBlock, /console\.error\([^\n]*(?:e\.message|String\(e\)|JSON\.stringify\(e\))/);
});
