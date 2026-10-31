# UXNest launch security audit — 2026-10-31

Scope: read-only review of `main` at `54907de61d95c0df2d68e115ebf9264f4eb6856f`, older security PR #2 and refund PR #14. This document does not certify production security.

## Verified findings

1. **HIGH — synchronous password hashing:** `api/_lib.js` uses `crypto.scryptSync` in `hashPassword` and `verifyPassword`. This blocks the Node.js event loop per login attempt and can amplify request-flood impact. PR #2 contains an async scrypt implementation, but its branch is 120 commits behind `main`. Do not transplant the entire old PR. Change the helper and all call sites together; add regression tests for valid, invalid, malformed and oversized inputs.
2. **HIGH — session revocation:** `api/_lib.js` signs 30-day session tokens without a revocation epoch. PR #2 adds `accounts.session_epoch` and `authenticate`, requiring a migration and endpoint-by-endpoint adoption. Review deployment and session-logout implications before enabling.
3. **ACCESS MODEL — RLS:** Supabase advisor reports six `public` tables have RLS enabled and zero policies. Current server helper uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Confirm all data access is server-side, each endpoint authorizes account ownership, and no privileged key is shipped to the browser. No RLS policies should be added blindly.
4. **STALE PRs:** PR #2 is 120 commits behind `main`; PR #14 is 108 behind. Both diverged. Current `api/creem-webhook.js` already includes refund-event reconciliation functions, so assess current code before porting older refund logic.
5. **REPORT QUALITY:** Recent commits include report-completeness and scoring regressions. Run `npm run test:report-model` and `npm run test:report-completeness`, plus 20-URL browser/AI/PDF regression, before treating Claude's defects as closed.

## Required safe follow-up

- Inventory every `hashPassword`, `verifyPassword`, `readSession`, and `issueSession` call site and check auth failure handling.
- Compare PR #2's security migration against the live schema without executing it.
- Review `api/fetch-url.js` SSRF/redirect handling and webhook signature verification on current `main`.
- Trace purchase/refund/credit idempotency and account ownership across API endpoints.
- Prepare small isolated fixes on fresh branches with tests and PRs. Do not merge/deploy, change production database, or execute live payments without approval.

## Release gates

No high/critical auth or payment defects; all regression tests pass; audit evidence and PDFs manually verified; legal policies reviewed; explicit approval before production deployment.
