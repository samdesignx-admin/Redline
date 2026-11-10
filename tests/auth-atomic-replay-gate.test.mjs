// Static release gates: fail until DB-atomic reset proof consumption and distributed throttling exist.
// These checks are necessary but not sufficient; isolated concurrency integration tests are required.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../api/verify.js', import.meta.url), 'utf8');

test('password reset has a database-backed atomic proof-consumption call', () => {
  assert.match(source, /\.rpc\(\s*['"][\w]*(?:consume|redeem)[\w]*(?:token|proof)[\w]*['"]/i,
    'P0 #44: implement atomic one-time reset proof consumption in a database transaction');
});

test('verification send throttling uses shared database-backed enforcement', () => {
  assert.match(source, /\.rpc\(\s*['"][\w]*(?:rate_limit|throttle)[\w]*['"]/i,
    'P0 #44: use shared durable rate limiting rather than only a process-local Map');
});
