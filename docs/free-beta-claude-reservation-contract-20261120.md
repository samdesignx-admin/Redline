# Free-beta Claude quota: reservation/settlement implementation contract (review only)

Status: design proposal; **not implemented or approved for production**. Applies to draft PR #69. Do not apply the existing `create_free_beta_audit` SQL as a substitute for pre-Claude reservation.

## Safety invariant

A billable Claude call may start only after the server has atomically reserved one of the account's three monthly audit slots. Never accept account ID, quota state, provider model, or token budget from the client. The current `free_beta_audit_usage` function counts completed audits only; it does **not** satisfy this invariant.

## Proposed durable state machine

Use a separate reservation ledger in an isolated development database. Store account ID, stable opaque request ID, UTC quota month, state (`reserved`, `provider_started`, `completed`, `failed_before_provider`, `failed_after_provider`), timestamps, provider attempt ID, and optional audit ID. Do not store raw prompts, OTPs, API keys, or payment data in the ledger.

- **reserve:** Authenticate session, validate request and per-account rate limit, then lock the account row in one transaction. Look up the request ID before checking quota. Existing requests return their prior state, never a second provider authorization. Count `reserved`, `provider_started`, `completed`, and `failed_after_provider` toward the three-slot limit. Insert a reservation only if fewer than three counted slots exist.
- **start:** Atomically transition `reserved` to `provider_started` with a single-use claim. Only the successful claimant may initiate Claude. Retries observing `provider_started` must not call Claude again.
- **complete:** Persist the audit and mark `completed` in one transaction, linking its audit ID. Repeated completion is idempotent.
- **failure:** Release a slot only when the provider was *provably not invoked* (`failed_before_provider`). After a request may have reached Claude, retain the slot as `failed_after_provider` to prevent repeated billable calls. A timed-out request must not be automatically refunded to quota without reliable provider-side evidence.
- **recovery:** Expired `reserved` rows can be released only if the provider-start claim was never acquired. An ambiguous `provider_started` row requires reconciliation; do not automatically retry the provider request.
- **month boundary:** Bind each reservation to the UTC month at creation; retries preserve the original month and request identity. Do not silently treat the same request ID as a new audit next month.

## Required isolated tests

1. Four concurrent distinct requests on the same account yield at most three reservations and at most three provider starts.
2. Ten concurrent retries with the same request ID yield exactly one reservation and at most one provider start.
3. A crash before provider start safely releases the slot; a crash or timeout after start does not trigger another billable call.
4. Completion persists an audit and settles the reservation atomically; retry returns the same audit.
5. Month-end crossing and retries preserve the original UTC accounting month.
6. Two accounts remain isolated; anonymous and cross-account requests fail.
7. Client-supplied model/token/quota overrides are ignored; payment endpoints remain gated.
8. Simulated provider 429/500/timeout responses return redacted errors without secrets or upstream bodies.
9. Preview and Production use distinct Supabase projects and service credentials before any write-enabled E2E run.

## Launch gates

Implement and review SQL/functions plus server call sequence on the draft branch; add automated tests and run them against an isolated Supabase development project. Confirm credential separation tracked in issue #43 first. Verify full audit, screenshots, report/PDF, authentication and legal pages afterward. Preserve the existing paid/refund implementation for later release. No merge, production deploy, schema/data write, charge or refund is authorized by this document.
