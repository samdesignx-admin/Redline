# UXNest free-beta Preview environment gate (2026-11-19)

This is a release checklist, not evidence of a working audit. Do not enable beta flags or deploy production until each gate is verified.

## Verified configuration inventory (values not decrypted)

- `ANTHROPIC_API_KEY` is scoped to Production and separately to Preview branch `refactor/platform-foundation`, **not** the active beta branch `feature/free-beta-monthly-quota-20261119`. The active Preview currently returns HTTP 500 `ANTHROPIC_API_KEY is not set` for Costco audit attempts.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are single Vercel entries shared by Preview and Production. This is a **P0 isolation blocker**: do not run Preview signup, audit-record creation, or refund/payment integration tests against potentially production-connected data. See #43.
- `SESSION_SECRET` is also shared by Preview and Production. Separate it as part of #43. Never paste or commit secret values.
- `FREE_BETA_MODE` and `FREE_BETA_AUDITS_ENABLED` are Production-scoped and beta remains disabled. Do not enable them until the quota ledger and atomic reservation flow are verified.
- Supabase security advisor reports six public application tables with RLS enabled and no policies (INFO). This can be appropriate for a server-side service-role access model; do not create permissive policies merely to silence the advisory. See #56.
- Supabase table `public.free_beta_audit_usage` is absent (read-only information_schema query). Quota enforcement is not ready.

## Safe setup order

1. Provision an isolated non-production Supabase project/branch after reviewing cost/ownership; use separate Preview-scoped URL and service-role key, and verify project references differ. Keep Production entries untouched.
2. Set distinct Preview `SESSION_SECRET` and `VERIFY_SECRET` and audit other shared privileged credentials.
3. Create a separate spending-limited Anthropic key in a test workspace, then scope `ANTHROPIC_API_KEY` to the active beta Preview branch. Do **not** copy the Production Anthropic key or change Production scope.
4. Trigger a **Preview-only** rebuild and verify the deployment commit and state. Vercel READY means the build succeeded, not that the runtime audit works.
5. Run mocked tests for unauthorized requests (401), signed-session validation, missing-key failure (500), beta fail-closed (503), malformed inputs, and provider timeout; avoid paid provider calls until approved.
6. Design and test atomic monthly quota reservations and settlement in the isolated database, including concurrent requests, retry idempotency, failed-audit release, deletion, and UTC rollover. Never activate quota flags before this passes.
7. Only then perform a cost-controlled full Costco URL audit and validate score, evidence, and downloadable PDF. Capture request ID and failing stage on any error.
8. Verify beta disables checkout while retaining existing signed Creem webhook reconciliation. Review legal pages, security, rollback, and PR #2/#14/#16 overlaps before requesting production release approval.

## Current change status

- Development commit `6a03c846` adds mock runtime tests of Claude proxy authentication; Vercel Preview reported READY for that commit. No real Anthropic request was validated.
- Authentication currently rejects anonymous Claude requests. The landing-page anonymous preview/support-chat path may require separate explicitly budgeted design; do not reopen the unrestricted proxy.
- This checklist does not authorize production merges, deployments, database writes/schema, charges, refunds, or sharing credentials.
