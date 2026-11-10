# Authentication release gates (2026-11-10)

Status: **BLOCKED — not production-ready**. This document records review requirements; it does not certify a fix.

## Evidence and reconciliation
- `main:api/verify.js` signs email/purpose/code/expiry using a stateless HMAC. A successful `verify` call does not persist consumption, and `reset` updates an account after checking the same reusable token.
- `main:api/verify.js` limits `send` with a process-local `Map`; separate serverless instances cannot share its counters.
- PR #2 proposes database rate limiting and reset-token password-hash binding, but is conflicted; binding to the previous hash alone does **not** make two simultaneous reset requests atomic.
- PR #42 validates signup proofs and has targeted CI, but its `validSignupProof` is stateless. PR #42 is stacked on #40/#38/#16; do not merge it independently.
- PR #16 is a distinct async-scrypt change, not a substitute for replay protection.

## Required implementation
1. Use a durable token identifier (random, opaque; store only a cryptographic hash) with purpose, normalized email/account, expiry, and consumed timestamp in an **isolated development database**. Do not create or alter production schema without approval.
2. Perform **atomic consume** with one database operation that succeeds only when token is unconsumed and unexpired. Verify exactly one winner across concurrent requests; failed consumption must not mutate credentials or create an account.
3. Ensure password change and token consumption are in one transaction or equivalent single atomic database operation; handle failed updates and retries without losing a valid token or allowing duplicate success.
4. Implement distributed per-IP and per-email rate limiting, with explicit fail-closed behavior when the limiter is unavailable for sensitive operations. Do not trust unvalidated client-supplied forwarding headers.
5. Keep signup and reset tokens purpose-bound and email-bound. Do not log codes, tokens, secrets, or password hashes.
6. Isolate Vercel Preview credentials, Supabase project, and auth secrets from Production before integration tests (Issue #43).

## Deterministic acceptance tests
- Sequential replay: first valid token use succeeds, second fails; exactly one account mutation.
- Concurrent replay: launch >=20 simultaneous requests with identical token; exactly one succeeds, including across separate API instances.
- Expired, tampered, wrong-purpose, wrong-email, malformed tokens fail without mutation.
- Failed DB transaction does not falsely report success; retry semantics are documented and tested.
- Rate limit shared across two instances; reset after window; unavailable store follows documented safe behavior.
- Verify signup, login, Google OAuth, reset, and session invalidation on isolated Preview; check no production data access.
- Run CI on integrated auth branch, then request security review. Green build alone is not end-to-end validation.

## Release dependencies
- Issues #43 (Preview isolation), #44 (reset replay/rate limiting), #45 (Creem configuration).
- Reconcile PRs #2/#14/#16 and stacked auth PRs before merging.
- Separately validate Creem checkout/webhooks, credit idempotency, refunds, report/PDF output, Claude audit defects, and legal policies.

No production changes are authorized by this document.
