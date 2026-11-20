import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const api = readFileSync(new URL("../api/audit.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");
test("Claude proxy rejects missing or invalid signed sessions before calling provider", () => {
  assert.match(api, /const session = readSession\(req\.headers\?\.\["x-uxnest-session"\]\)/);
  assert.match(api, /if \(!session\)\s*\{[\s\S]*?res\.status\(401\)/);
  assert.ok(api.indexOf("const session = readSession") < api.indexOf('fetch("https://api.anthropic.com/v1/messages"'));
});
test("Nest Audit supplies signed session", () => {
  assert.match(ui, /"X-UXNest-Session": getToken\(\)/);
});
