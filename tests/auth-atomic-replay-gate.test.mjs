// Release gate: intentionally fails until durable single-use token consumption is implemented.
// Run: node --test tests/auth-atomic-replay-gate.test.mjs
// Static guard only; an isolated-DB concurrency integration test is also required.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../api/verify.js', import.meta.url), 'utf8');

test('password reset consumes verification proof through an atomic database operation', () => {
  // A read followed by an update, or a process-local Set, cannot guarantee
  // exactly one success across concurrent serverless instances.
  assert.match(source, /(?:\\.rpc\\(\\s*['\"](?:consume|redeem|reset)[\\w]*token|\\.rpc\\(\\s*['\"](?:consume|redeem|reset)[\\w]*proof)/i,
    'P0 #44: replace reusable stateless reset proof with a DB-atomic consume operation');
});

test('verification send rate limits are not solely process-local', () => {
  assert.match(source, /\\.rpc\\(\\s*['\"][\\w]*(?:rate_limit|rate_limit_check|throttle)[\\w]*['\"]/i,
    'P0 #44: enforce rate limits in shared durable storage, not only a Map');
});
