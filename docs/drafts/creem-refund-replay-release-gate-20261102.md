# Creem refund webhook replay release gate (2026-11-02)

Source inspected: `api/creem-webhook.js` on main. This is a **test plan**, not proof of production correctness.

## P0 replay and persistence scenarios

1. Deliver a valid signed `refund.created` event with status `succeeded` and an exact full-amount refund for a linked purchase. Assert `apply_creem_refund` executes once, the credit ledger reverses exactly once, and `creem_refund_events.state` becomes `applied`.
2. Deliver the *same event ID* again after success. Assert event state remains `applied`, credit balance and ledger unchanged, and HTTP 2xx. **Current code calls `saveRefundEvent(..., 'received')` before attempting application, overwriting an existing `applied` state.** A subsequent RPC failure could leave it downgraded.
3. Deliver two concurrent copies of the same signed event. Assert only one reversal; enforce idempotency in a database transaction or RPC, not just a read-before-write in JavaScript.
4. Simulate a transient DB failure after the event is saved but before `apply_creem_refund` commits. Assert HTTP 5xx, safe retry, and no double reversal.
5. Simulate successful RPC followed by failed final `saveRefundEvent(..., 'applied')`. On retry, assert ledger remains unchanged and event reaches `applied`.
6. Deliver a partial refund, wrong currency, unknown transaction, malformed IDs, and a mismatched payment mode. Assert zero credit reversals and correct review/pending state. **Current refund branch does not check `event.object.mode` or transaction mode against `CREEM_MODE`; assess Creem's actual payload contract before enforcing a field.**
7. Confirm the purchase-history UI reflects actual settled refund status rather than only `audit_refund_requests.status`.

## Required safe remediation

- Make refund application idempotent and atomic inside `apply_creem_refund` with an appropriate uniqueness constraint; inspect the existing SQL definition before changing it.
- Do not downgrade terminal `applied` event state on replay; make state transitions monotonic, ideally in a database RPC with refund application.
- Confirm Creem's refund webhook payload mode fields against provider documentation and fixtures.
- Add integration tests using an isolated disposable database, not production Supabase.
- Require manual approval before any production schema/data changes, real refunds, or merging.

## Scope

No real payments, refunds, production DB writes, schema changes, or deployment are authorized by this plan.
