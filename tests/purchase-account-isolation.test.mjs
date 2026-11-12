// Source-level regression gate; does not replace browser account-switch testing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/UxnestApp.jsx", import.meta.url), "utf8");

test("logout and authentication invalidate purchase session data", () => {
  assert.match(src, /const clearPurchaseSession = \(\) => \{/);
  assert.match(src, /purchaseSessionRef\.current \+= 1/);
  for (const field of ["setPurchaseHistory(null)", "setHistoryError(\"\")", "setRefundPurchaseId(null)", "setRefundReason(\"\")"]) {
    assert.ok(src.includes(field), `Missing state cleanup: ${field}`);
  }
  assert.match(src, /const onLogout = \(\) => \{\s*clearPurchaseSession\(\)/);
  assert.match(src, /const onAuthSuccess = async \(u\) => \{\s*clearPurchaseSession\(\)/);
});

test("stale purchase and refund responses cannot update new account state", () => {
  assert.match(src, /if \(session === purchaseSessionRef\.current\) setPurchaseHistory/);
  assert.match(src, /if \(session !== purchaseSessionRef\.current\) return;/);
  assert.match(src, /if \(session === purchaseSessionRef\.current\) setHistoryError/);
});
