import test from "node:test";
import assert from "node:assert/strict";
import auditProxy from "../api/audit.js";
import auditRecords from "../api/audits.js";

test("free beta audit endpoints fail closed until separately enabled", async () => {
  const oldBeta = process.env.FREE_BETA_MODE;
  const oldEnabled = process.env.FREE_BETA_AUDITS_ENABLED;
  process.env.FREE_BETA_MODE = "true";
  delete process.env.FREE_BETA_AUDITS_ENABLED;
  try {
    for (const handler of [auditProxy, auditRecords]) {
      for (const req of [{method:"POST",body:{action:"create"}},{method:"POST",body:{action:"quota"}},{method:"GET"}]) {
        let status, payload;
        const headers = {};
        const res = {
          setHeader(k,v) { headers[k.toLowerCase()] = v; return this; },
          status(v) { status = v; return this; },
          json(v) { payload = v; return this; },
        };
        await handler(req,res);
        assert.equal(status,503);
        assert.equal(payload.code,"BETA_AUDITS_NOT_READY");
        assert.equal(headers["cache-control"],"no-store");
      }
    }
  } finally {
    if(oldBeta===undefined) delete process.env.FREE_BETA_MODE; else process.env.FREE_BETA_MODE=oldBeta;
    if(oldEnabled===undefined) delete process.env.FREE_BETA_AUDITS_ENABLED; else process.env.FREE_BETA_AUDITS_ENABLED=oldEnabled;
  }
});

test("beta AI proxy rejects unauthenticated calls before contacting Anthropic", async () => {
  const oldBeta=process.env.FREE_BETA_MODE;
  const oldEnabled=process.env.FREE_BETA_AUDITS_ENABLED;
  process.env.FREE_BETA_MODE="true";
  process.env.FREE_BETA_AUDITS_ENABLED="true";
  const oldProxy=process.env.FREE_BETA_AI_PROXY_ENABLED;
  process.env.FREE_BETA_AI_PROXY_ENABLED="true";
  try {
    let status,payload;
    const res={status(n){status=n;return this;},json(v){payload=v;return this;}};
    await auditProxy({method:"POST",headers:{},body:{messages:[{role:"user",content:"test"}]}},res);
    assert.equal(status,401);
    assert.equal(payload.code,"BETA_LOGIN_REQUIRED");
  } finally {
    if(oldBeta===undefined)delete process.env.FREE_BETA_MODE;else process.env.FREE_BETA_MODE=oldBeta;
    if(oldEnabled===undefined)delete process.env.FREE_BETA_AUDITS_ENABLED;else process.env.FREE_BETA_AUDITS_ENABLED=oldEnabled;
    if(oldProxy===undefined)delete process.env.FREE_BETA_AI_PROXY_ENABLED;else process.env.FREE_BETA_AI_PROXY_ENABLED=oldProxy;
  }
});

test("beta AI proxy fails closed without quota reservation activation", async () => {
  const prior = [process.env.FREE_BETA_MODE,process.env.FREE_BETA_AUDITS_ENABLED,process.env.FREE_BETA_AI_PROXY_ENABLED];
  process.env.FREE_BETA_MODE="true";
  process.env.FREE_BETA_AUDITS_ENABLED="true";
  delete process.env.FREE_BETA_AI_PROXY_ENABLED;
  try {
    let status, payload;
    const headers={};
    const res={setHeader(k,v){headers[k.toLowerCase()]=v;return this;},status(n){status=n;return this;},json(v){payload=v;return this;}};
    await auditProxy({method:"POST",headers:{},body:{}},res);
    assert.equal(status,503);
    assert.equal(payload.code,"BETA_AI_PROXY_NOT_READY");
    assert.equal(headers["cache-control"],"no-store");
  } finally {
    for(const [key,val] of [["FREE_BETA_MODE",prior[0]],["FREE_BETA_AUDITS_ENABLED",prior[1]],["FREE_BETA_AI_PROXY_ENABLED",prior[2]]]){
      if(val===undefined)delete process.env[key];else process.env[key]=val;
    }
  }
});

test("enabling all beta flags cannot bypass missing atomic AI reservation", async () => {
  const keys=["FREE_BETA_MODE","FREE_BETA_AUDITS_ENABLED","FREE_BETA_AI_PROXY_ENABLED"];
  const prior=keys.map(k=>process.env[k]);
  keys.forEach(k=>process.env[k]="true");
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("Unexpected provider call"); };
  try {
    // A syntactically signed token must pass readSession; use actual issuer.
    const { issueSession } = await import("../api/_lib.js");
    const oldSecret=process.env.SESSION_SECRET;
    process.env.SESSION_SECRET="test-only-secret-not-for-production";
    try {
      const token=issueSession("00000000-0000-4000-8000-000000000001");
      let status,payload;
      const headers={};
      const res={setHeader(k,v){headers[k.toLowerCase()]=v;return this;},
        status(n){status=n;return this;},json(v){payload=v;return this;}};
      await auditProxy({method:"POST",headers:{"x-uxnest-session":token},body:{messages:[{role:"user",content:"hello"}]}},res);
      assert.equal(status,503);
      assert.equal(payload.code,"BETA_RESERVATION_NOT_READY");
      assert.equal(headers["cache-control"],"no-store");
      assert.equal(providerCalls,0,"beta must never invoke Anthropic without an atomic reservation");
    } finally {
      if(oldSecret===undefined)delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET=oldSecret;
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});
  }
});

test("enabling every beta flag cannot create an audit without atomic reservation", async () => {
  const keys=["FREE_BETA_MODE","FREE_BETA_AUDITS_ENABLED","FREE_BETA_AI_PROXY_ENABLED","SESSION_SECRET"];
  const prior=keys.map(k=>process.env[k]);
  process.env.FREE_BETA_MODE="true";
  process.env.FREE_BETA_AUDITS_ENABLED="true";
  process.env.FREE_BETA_AI_PROXY_ENABLED="true";
  process.env.SESSION_SECRET="test-only-secret-not-for-production";
  try {
    const { issueSession } = await import("../api/_lib.js");
    const token=issueSession("00000000-0000-4000-8000-000000000001");
    let status,payload;
    const headers={};
    const res={
      setHeader(k,v){headers[k.toLowerCase()]=v;return this;},
      status(n){status=n;return this;},
      json(v){payload=v;return this;}
    };
    await auditRecords({method:"POST",body:{action:"create",token,audit:{title:"test"}}},res);
    assert.equal(status,503);
    assert.equal(payload.code,"BETA_RESERVATION_NOT_READY");
    assert.equal(headers["cache-control"],"no-store");
  } finally {
    keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});
  }
});
