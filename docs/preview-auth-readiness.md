# UXNest preview authentication readiness

Status checked: 2026-11-01. This checklist applies to the Vercel **Preview** environment of project `redline`, especially branch `fix/verified-email-proof-20261101`. Do not put secret values in this repository.

## Configuration gate

- [ ] Configure `VERIFY_SECRET` in Vercel Preview (use a distinct high-entropy value from Production). Without it, `/api/verify` returns HTTP 500 for all actions.
- [ ] Configure `RESEND_API_KEY` in Preview using an appropriately scoped key. Without it, verification-code email sending fails.
- [ ] Confirm `VERIFY_FROM` uses a verified sender/domain. The default `onboarding@resend.dev` may not deliver to arbitrary recipients.
- [ ] Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SESSION_SECRET` are present for Preview. Do not expose service-role credentials to browser bundles.
- [ ] Trigger a new **preview-only** deployment after updating environment variables. Existing immutable deployments do not inherit subsequent changes.

## Manual verification (non-production test accounts)

1. Request a signup code, receive it, and verify it; confirm signup sends server-issued `emailProof`, not client-supplied `emailVerified`.
2. Attempt signup with no proof, tampered proof, expired proof, and proof for a different email. Each must fail.
3. Sign in with a valid password, then reject an incorrect password.
4. Request a password-reset code, verify it, reset the password, and confirm old-password login fails and new-password login succeeds.
5. Try using the same reset token twice. **Known blocker:** current reset tokens are not persistently single-use; do not consider this test passed until fixed.
6. Verify Google sign-in rejects an invalid audience and an unverified email.
7. Check preview deployment logs for runtime errors, and record test results against the exact commit SHA.

## Release gates

Do not merge/deploy production until preview secrets are configured, tests run, reset-token replay is addressed with a concurrency-safe persistent mechanism, and payment/refund, report/PDF, legal, and security checks are reconciled. Any production DB schema/data changes, payments/refunds, or production release require explicit approval.
