// Static security regression gate for the Creem return URL. No network or payment calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../api/payment.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /req\.headers\.origin/i, "checkout must not trust request Origin");
assert.match(source, /const origin = trustedSite\.origin;/, "checkout must use validated origin");
assert.match(source, /success_url:\s*`\$\{origin\}\/payment\/success\?payment=success`/);
assert.match(source, /trustedSite\.username\s*\|\|\s*trustedSite\.password/);
assert.match(source, /trustedSite\.search\s*\|\|\s*trustedSite\.hash/);
assert.match(source, /trustedSite\.pathname\s*!==\s*"\/"/);

function validateSiteUrl(siteUrl) {
  let url;
  try { url = new URL(siteUrl); } catch { throw new Error("invalid URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("invalid origin");
  return url.origin;
}
assert.equal(validateSiteUrl("https://uxnest.ai"), "https://uxnest.ai");
assert.equal(validateSiteUrl("https://uxnest.ai/"), "https://uxnest.ai");
for (const invalid of [
  "http://uxnest.ai", "https://attacker.test/path", "https://uxnest.ai/?next=evil",
  "https://uxnest.ai/#evil", "https://user:pass@uxnest.ai", "not-a-url",
]) assert.throws(() => validateSiteUrl(invalid), invalid);
console.log("Creem redirect static security checks passed (not an endpoint integration test).");
