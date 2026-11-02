# Atomic reset RPC: review gates (2026-11-01)

Reviewed `docs/drafts/password-reset-atomic-rpc.sql` at commit `0aec30a2`. This is a **design review, not a tested migration**.

## Findings

1. The unique `token_digest` insert with `ON CONFLICT DO NOTHING` provides atomic exclusion for **the same digest**, assuming the insert and password update run in the same transaction. Keep the digest rows after expiry (or ensure token uniqueness and retention guarantees) to avoid reopening replay.
2. **Different valid tokens for one account can both succeed.** Decide whether reset issuance invalidates older tokens; if yes, add an account-scoped reset generation/epoch check or compare-and-swap condition on the current password state inside the transaction. A unique digest alone cannot enforce that policy.
3. **Session revocation must be reconciled with PR #2.** The draft updates only `password_hash`. If PR #2 introduces `session_epoch` revocation, the atomic RPC must increment that epoch in the same update, or existing sessions may remain valid after reset.
4. Ensure the endpoint never accepts caller-supplied `account_id`, `expires_at`, or precomputed digest without independently verifying the signed reset token's purpose, account/email binding and expiry. The database RPC is a consumption primitive, not token authentication.
5. Before production: run parallel same-token and different-token tests in an isolated database, inspect grants and `SECURITY INVOKER` permissions, test absent-account rollback, and confirm no direct-update fallback.

No schema or production changes were made.