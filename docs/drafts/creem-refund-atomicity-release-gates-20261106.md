# Creem refund atomicity: integration and release gates (2026-11-06)

Status: **design proposal only**. No production migration or financial changes are authorized by this document.

## Problem and integration scope

Review draft PRs #23, #27, #29, #30 and #31 together before merging. PR #29 protects immutable webhook event identity; PR #30 validates exact full-refund amounts; PR #31 demonstrates a proposed unique refund_id constraint in a disposable fixture. None of these alone proves exactly-once credit reversal when *different event IDs* describe one provider refund. A blanket UNIQUE(refund_id) on an append-only event table could reject valid lifecycle notifications.

Keep two distinct identities:

- `event_id`: unique provider delivery/event identity, retained in an append-only or monotonic event history.
- `refund_id`: provider refund identity, used to guard the *financial effect* once, independent of event count.

Never treat a successful event insert as proof that the credit reversal committed.

## Proposed atomic transaction (requires review and explicit approval before production use)

Implement a single server-side transactional RPC for verified, normalized refund payloads:

1. Verify the Creem webhook signature **before** invoking the RPC; validate event type, currency, refund and transaction identifiers, amount as an exact integer, and association to the recorded purchase. Reject partial, excessive, mismatched and unknown refunds for manual review.
2. In the transaction, acquire a deterministic lock on the purchase (or a dedicated refund-effect row), then check for an already-applied financial effect keyed by provider + refund_id. Ensure a database uniqueness constraint covers this identity. An existing applied effect returns a no-op even for a different event_id.
3. If not yet applied, check eligibility and original credit grant, reverse credits **once** (define insufficient-spendable-credit behavior explicitly), append a unique reversal ledger source key, record the refund effect, and transition purchase/refund state monotonically.
4. Record event receipt/status without permitting a late `received` event to downgrade an `applied` status. Preserve distinct legitimate event IDs for one refund.
5. Commit all financial changes together or none. On an error, retry must be safe; external webhook response should distinguish retryable failures from permanently rejected payloads.

Avoid a check-then-update sequence outside a transaction. Use unique constraints and row locks inside the same PostgreSQL transaction. Validate database function privileges and RLS/service-role boundaries before deployment.

## Required disposable PostgreSQL regression matrix

| Case | Expected invariant |
| --- | --- |
| Same event ID replay, same payload | One reversal and ledger entry; unchanged final status |
| Same event ID, modified amount/currency/transaction/refund ID | Reject without mutating original identity or balances |
| Two different event IDs, same refund ID, sequential | Both delivery identities may be preserved; only one financial effect |
| Two different event IDs, same refund ID, **concurrent** | Exactly one reversal and one ledger source key, regardless of interleaving |
| Concurrent same-event deliveries | No double reversal, no deadlock, stable terminal status |
| Failure injected after ledger insert but before purchase update | Whole transaction rolls back; retry applies exactly once |
| Failure injected after credit update but before event status update | Whole transaction rolls back; retry applies exactly once |
| Late `received` after `applied` | No terminal-state regression |
| Partial, excessive, wrong currency, unknown purchase, mismatched transaction | No financial effect; deterministic manual-review outcome |
| Two distinct legitimate refunds for same purchase | Follow explicit business rule (e.g. full refund only); no duplicate original-credit reversal |

Use two independent database connections and a barrier (or advisory-lock coordination) to force actual overlap; sequential calls do **not** prove concurrency safety. Run fixtures only against disposable PostgreSQL 17 with transaction rollback/teardown. Never point CI at Supabase production credentials.

## Acceptance evidence before release

- CI logs showing real concurrent connections and every invariant above.
- Reviewed database DDL/RPC diff, permissions, migration/backfill plan, and rollback plan; explicit approval before any production schema/data change.
- Reconcile overlapping auth PRs #2/#14/#16 and Preview secret isolation separately.
- Creem **test-mode** end-to-end checkout, purchase history, refund lifecycle and ledger reconciliation only after Preview isolation is confirmed. No live charges/refunds.
- Claude audit defects, report/PDF accuracy, and legal policies tracked as separate launch gates.

**Release decision:** BLOCKED until atomic financial effects and the regression matrix are implemented and verified.
