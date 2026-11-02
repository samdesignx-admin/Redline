# Atomic password-reset RPC — adversarial verification plan (2026-11-01)

Status: **not executed**. Run only against an isolated disposable Supabase/Postgres database after reviewing the draft migration in `docs/drafts/password-reset-atomic-rpc.sql`. Never point this test at production.

## Release-gating scenarios

1. **Same token, concurrent:** Create a disposable account and valid 64-character lowercase hex digest. From two independent database sessions invoke `consume_password_reset` simultaneously with the same account ID, digest, expiry, and *different* password hashes. Assert exactly one call returns true, the other returns false, exactly one consumption row exists, and the account password hash equals the winning call's hash.
2. **Different tokens, same account:** Decide whether a newer reset must invalidate all older reset tokens. The current SQL does **not** enforce this: two distinct valid digests can each reset the same account. Document intended policy and add an account-level issuance epoch or version check if required.
3. **Nonexistent account:** A valid digest for an unknown UUID must fail and leave no consumption record; confirm exception rolls back the insert.
4. **Expired / too-far-future:** Expired timestamps and expiry > 10 minutes in the future return false, with no writes.
5. **Invalid digest:** Empty, uppercase, malformed, and non-64-character digests return false, with no writes.
6. **Authorization:** Verify `anon` and `authenticated` cannot execute the RPC or read the consumption table; verify `service_role` can execute only with expected privileges. Check default EXECUTE privileges for newly created functions.
7. **Transactional failure:** Force an account update error in an isolated transaction and verify the token claim rolls back.
8. **API integration:** Verify HMAC, purpose, expiry and email/account binding **before** calling the RPC; derive digest server-side from the complete signed reset token with domain separation. Never accept a client-provided digest or password hash.
9. **Fail closed:** If RPC is unavailable, times out, or returns false, API must not fall back to direct `accounts.update`; it must not report success.
10. **Observability:** Logs and responses must not contain raw reset tokens, codes, HMAC secrets, password hashes, or provider error internals.

## Design review flags

- This draft's token digest is the uniqueness key. It prevents replay of **the same token** but does not invalidate *other* outstanding reset tokens for the same account.
- The SQL checks expiry relative to the database clock; test clock skew between token issuance and RPC execution.
- Confirm the service-role PostgREST RPC is callable under RLS and grants in a disposable environment; a READY Vercel build is not proof of SQL correctness.
- Do not deploy the migration until its rollback, retention policy, concurrent test results, and approval are recorded.

## Evidence needed before release

Attach the disposable-database test output, API regression results, code review, preview end-to-end results, and explicit approval for any production migration to draft PR #21.
