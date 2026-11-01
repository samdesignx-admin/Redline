# Password-reset replay prevention — proposed implementation (not deployed)

## Verified defect
`api/verify.js` signs `email.reset.code.expiry` with HMAC and updates `accounts.password_hash` after verifying it. No persistent consumption check occurs. The same signed reset token and code can therefore reset the password repeatedly before expiry, including from separate serverless instances.

## Proposed migration — review and approve before running
Create a dedicated `password_reset_consumptions` table with:
- `token_digest text primary key` (SHA-256 of the full signed token plus code and normalized email, never store raw codes/tokens)
- `account_id uuid not null` (verify actual accounts.id type before applying)
- `consumed_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- index on `expires_at` for cleanup.

**Important:** A simple insert-then-update is not atomic. Use a single PostgreSQL SECURITY DEFINER RPC with constrained EXECUTE grants and a transaction that (1) validates account identity and supplied digest, (2) inserts digest with `ON CONFLICT DO NOTHING`, (3) rejects conflicts, (4) updates exactly one account's password hash, and (5) commits together. Avoid exposing an arbitrary password-hash update RPC to clients; call only through authenticated server-side service credentials. Validate account ID types, permissions, and ownership before writing migration.

## Server behavior
- Keep existing HMAC, purpose, expiration, and constant-time checks.
- Compute the digest server-side only after code verification; never log codes, tokens, or password hashes.
- Invoke the atomic RPC with the account ID, digest, expiry, and already hashed password.
- On replay return a generic 400/409; do not update the password or last_login_at.
- On DB failure fail closed; do not report success.
- Rate limit send and reset attempts with a shared durable store; current in-memory Map is per-instance only.
- Consider avoiding user enumeration in the send/reset flow.

## Tests required before merge
1. Valid reset succeeds exactly once; replay is rejected.
2. Two simultaneous resets with identical token: exactly one succeeds, including across instances.
3. Failed DB update rolls back token consumption.
4. Wrong purpose, code, email, expiry, malformed signature fail.
5. Different valid reset token works after previous token consumed.
6. Production and Preview secrets are distinct; email delivery and complete flow pass in Preview.

## Release gate
No migration, production deploy, merge, or real email/payment actions are authorized by this document. Apply migration only after explicit approval, with rollback and backup plan. Preview currently lacks VERIFY_SECRET and RESEND_API_KEY, blocking end-to-end authentication testing.
