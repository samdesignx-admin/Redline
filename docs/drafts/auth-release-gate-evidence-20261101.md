# Authentication release gate — 2026-11-01 (read-only verification)

## Evidence

- GitHub default branch `main`, `api/verify.js`: password reset validates a signed code and then updates `accounts.password_hash` directly. There is no durable attempt counter or consumed-token claim. The `sendHits` Map throttles only `send` and is process-local, not shared across serverless instances.
- GitHub `fix/verified-email-proof-20261101`: error sanitization and affected-row verification are present, but the reset path still calls `accounts.update` directly. Do not treat those fixes as atomic token consumption.
- Vercel `redline` environment metadata (values not decrypted): `VERIFY_SECRET` and `RESEND_API_KEY` target **production only**; `VERIFY_FROM` targets production and preview. Thus preview reset/email delivery is blocked until preview-scoped secrets are supplied and a new preview deployment is verified.
- Supabase project `cocuvdjcxmkhcdzzszxo`, public table listing: `accounts`, `audits`, `audit_purchases`, `audit_refund_requests`, `audit_credit_ledger`, `creem_refund_events`. No `password_reset_consumptions` table was listed. No SQL was executed.
- Vercel latest inspected deployment: READY, commit `29116811c10ef6167339a09198991f92a4be6f8c`, branch `docs/reset-token-replay-design-20261101`. READY means build completed, **not** that auth tests passed.

## Required next engineering work

1. Implement durable per-email and per-IP **verification attempt** limits with atomic increments, a bounded window, and generic client errors. Do not rely on a per-process Map or on `x-forwarded-for` as an untrusted identity without proxy validation.
2. Integrate a server-only atomic token-consumption RPC with the reset API, including same-token concurrency and replay tests. The draft SQL in this branch is **not applied** and must undergo privilege/RLS review.
3. Reconcile PR #2 session invalidation and define whether a new reset request invalidates earlier valid reset tokens for the same account.
4. Provision preview-scoped secrets through an approved secrets-management path; never commit secret values. Rebuild preview and test send, verify, reset, replay, wrong code, expiration and session revocation end-to-end.
5. Review PRs #2/#14/#16 and payment/PDF/legal readiness separately; this note does not assert those workflows pass.

**Change control:** no production merge, deployment, schema/data modification, charge or refund is authorized by this document.
