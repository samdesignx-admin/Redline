# Creem refund concurrency review — 2026-11-02

## Evidence (read-only production inspection)
The deployed public.apply_creem_refund(p_transaction_id,p_refund_id,p_amount_cents) PL/pgSQL function first resolves the purchase account, locks public.accounts row FOR UPDATE, then locks the matching public.audit_purchases row FOR UPDATE. It returns true without another credit reversal for the same refund ID if refund_status='refunded'; a different refund ID raises an exception. It updates paid_audits/credit_debt, audit_purchases, audit_refund_requests, and inserts an audit_credit_ledger entry within one PostgreSQL function transaction. This makes a blanket claim that the RPC has no concurrency protection inaccurate. No production mutation was performed to inspect it.

## Residual concurrency gap
api/creem-webhook.js separately reads creem_refund_events.state, upserts 'received', calls the refund RPC, and upserts 'applied'. Two simultaneous deliveries of the same event can both observe a non-applied state; the RPC serializes credit reversal, but a late 'received' upsert may overwrite 'applied' after the first request completes. A failed final event-state upsert can also leave an applied credit reversal with a stale event status. The existing four tests mock DB calls and do not exercise this interleaving or the deployed SQL function.

## Proposed safe release gate
1. Add an isolated concurrent webhook test with controlled barriers that demonstrates an out-of-order received/applied write and confirms the credit RPC is called at most once per *effective* refund.
2. Add an isolated PostgreSQL integration test that runs two transactions against a seeded, disposable database; assert one credit reversal and one ledger entry, identical refund IDs idempotent, different refund IDs rejected, and no negative balance. Do not run against production.
3. Introduce monotonic event-state transitions (e.g. a guarded update or database RPC) so 'applied' cannot be replaced by 'received'. Keep the purchase/account lock behavior and verify transaction rollback on ledger errors.
4. Confirm the event table unique constraint on event_id and the ledger source_key uniqueness before approving changes. A mock-only green build is insufficient.

## Release decision
BLOCKED for refund concurrency acceptance pending the isolated tests and monotonic event-state fix. The SQL RPC already has meaningful locking/idempotency; the unresolved risk is primarily event-state race/reconciliation, not necessarily double credit reversal.
