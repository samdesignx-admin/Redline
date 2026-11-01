import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Prevent a regression where verification succeeds but signup omits the
// server-issued proof (or substitutes an untrusted browser boolean).
const frontend = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");
const signup = frontend.match(/const \{ account, token \} = await api\.signup\(\{([\s\S]*?)\}\);/);
assert.ok(signup, "signup payload must be present");
assert.match(signup[1], /emailProof:\s*body\.emailProof\b/, "signup must forward verified server proof");
assert.doesNotMatch(signup[1], /emailVerified\s*:/, "signup must not trust a client-side verified flag");
console.log("Frontend signup proof contract passed");
