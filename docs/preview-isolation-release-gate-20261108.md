# Preview isolation release gate (2026-11-08)

**Status: BLOCKED.** This document is a non-production checklist, not evidence of isolation. Do not execute payment, refund, webhook replay, or customer-account tests against Preview until all gates below pass.

## Observed configuration (Vercel project `redline`, metadata-only inspection)

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` have been reported as scoped across Preview and Production. Environment scope alone does not prove that values are equal or different. Treat Preview as **potentially production-connected** until verified.
- `VERIFY_SECRET` and `CREEM_WEBHOOK_SECRET` have been reported as Production-only. Preview must have its own non-production secrets where the application requires them.
- `CREEM_MODE=test` is configured across environments. A test-mode setting does **not** make a shared database safe.
- Creem API keys have separately scoped Preview and Production entries. Their actual values and behavior were **not** verified.
- The Supabase project `cocuvdjcxmkhcdzzszxo` is ACTIVE_HEALTHY; its development branch list was empty on 2026-11-08. Do not treat this project as an isolated test database.

## Release checklist

1. Provision a **separate non-production Supabase project or branch**, with its own project reference, URL, anon key and service-role key. Supabase branch creation can incur charges: obtain cost approval before creating it. Never clone customer data or production secrets into the test environment.
2. Configure **Preview-only** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` using that isolated project. Remove Preview scope from any production-targeted entries **only after** Preview replacements are ready; avoid unintended service interruption. Check any other database URLs, JWT secrets, service credentials and branch-specific overrides.
3. Generate unique Preview `VERIFY_SECRET` and `CREEM_WEBHOOK_SECRET`, and ensure session/signing secrets are distinct from Production. Do not place values in source control, PR comments, or test logs.
4. Confirm Creem Preview uses **test-mode API endpoint, API key, product and webhook**. Keep all real charge/refund execution disabled until separately approved.
5. Build/redeploy **Preview only** after env changes. Verify that the deployment resolves to the isolated Supabase project reference without printing secret values. A READY deployment alone is insufficient.
6. Run disposable-account authentication tests and **non-charge** webhook validation in isolated Preview; then run authorized test-mode checkout/refund scenarios only after isolation is proven. Record CI/deployment evidence and redact IDs/tokens.
7. Confirm no production schema/data change, customer credit adjustment, actual charge/refund, or production deployment occurred. Record reviewer approval before lifting the launch gate.

## Other tracked launch work

- Authentication PRs #2 and #14 are open with merge conflicts; PR #16 is draft. Reconcile overlapping auth changes and verify regressions before any merge.
- Draft PR #35 contains refund replay/concurrency/rollback regression work; CI success does not establish isolated Preview behavior or production readiness.
- Claude audit findings, report/PDF quality, legal policies, and end-to-end Creem testing remain separate launch gates.

**Exit criterion:** A reviewer can identify a distinct Preview Supabase project reference, verify Preview-only credentials and secrets without exposing them, and demonstrate that non-production test activity cannot write to the production project. Until then, **NO-GO**.
