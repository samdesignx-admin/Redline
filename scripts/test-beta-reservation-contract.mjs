import { test } from 'node:test';
import assert from 'node:assert/strict';
import audit from '../api/audit.js';
import audits from '../api/audits.js';

test('beta fail-closed contract: no provider call or legacy credit path before reservation integration', async () => {
  const previous = process.env.FREE_BETA_MODE;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.FREE_BETA_MODE = 'true';
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network call'); };
  try {
    for (const [handler, body] of [[audit, {messages:[{role:'user',content:'test'}]}], [audits,{action:'create'}], [audits,{action:'quota'}]]) {
      const result = {headers:{}};
      const res = {setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return this;},json(v){result.body=v;return this;}};
      await handler({method:'POST',body,headers:{}},res);
      assert.equal(result.status,503);
      assert.equal(result.body.code,'BETA_RESERVATION_NOT_READY');
      assert.equal(result.headers['cache-control'],'no-store');
    }
    assert.equal(calls,0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.FREE_BETA_MODE;
    else process.env.FREE_BETA_MODE = previous;
  }
});
