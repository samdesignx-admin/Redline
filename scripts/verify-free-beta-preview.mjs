import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");
assert.match(source, /<h2 style=\{h2\}>Free public beta<\/h2>/);
assert.match(source, /Three monthly audits planned; secure enforcement pending/);
assert.match(source, /\{false && user && \(\s*<details className="audit-credit-widget"/);
assert.doesNotMatch(source, /Simple, pay-as-you-go pricing|Buy 1–20 audit credits per purchase|Additional audits are \$5 each during beta/);
assert.match(source, /page === "billing"/, "Existing users retain direct access to historical billing records");
console.log("Free-beta preview copy and checkout entry-point checks passed");
