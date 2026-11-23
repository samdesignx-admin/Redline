import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const config = await import(pathToFileURL(process.cwd() + '/src/config/app.js').href);
assert.doesNotMatch(config.QUOTA_MESSAGE, /purchase|buy|checkout|\\$\\s*\\d|paid audit/i,
  'Free beta quota copy must not invite a payment');
// Until the server-side atomic quota is shipped, the legacy client display
// limit must not be presented as proof of the promised 3/month allowance.
assert.equal(config.AUDIT_QUOTA, 1,
  'Do not increase the client quota without verified server enforcement');
const source = readFileSync('src/config/app.js', 'utf8');
assert.match(source, /server.*enforce/i);
console.log('Free-beta quota copy guard passed (does not validate checkout gating or quota enforcement).');
