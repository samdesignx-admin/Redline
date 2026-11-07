# Creem refund replay safety — proposed atomic persistence (NOT DEPLOYED)

Status: design for review; no database migration has been applied. Source: `api/creem-webhook.js` on `safety/manual-refund-launch-gate-20261106`, and read-only inspection of `public.creem_refund_events` on 2026-11-07.

## Verified defect

`saveRefundEvent()` unconditionally upserts by `event_id`. A replay of the same signed `refund.created` webhook can reset `applied` or `review_required` to `received`. The primary key on `event_id` prevents duplicate rows, **not state regression**. Current mock tests construct a new database for each replay, so they do not detect this.

## Required invariants

1. `applied` is terminal: neither replay nor a concurrent request can downgrade it.
2. `review_required` is sticky until an explicitly authorized operator reconciliation action; ordinary webhook processing cannot downgrade it.
3. `pending_link` can advance to `review_required` or `applied` only after the matching purchase is verified; it cannot be reset to `received`.
4. Identifiers and amount/currency for a given `event_id` are immutable; conflicting signed payloads are flagged for review rather than silently overwriting records.
5. Only a verified successful, full USD refund with matching provider transaction and local purchase can enter any automated financial RPC. Default remains manual.
6. Replay must not trigger a second financial operation; event persistence and financial effects must be coordinated transactionally when automated refunds are eventually enabled.

## Proposed implementation (requires separate approval before DB migration)

Replace application-level `upsert` with a narrowly granted PostgreSQL RPC using a single `INSERT ... ON CONFLICT (event_id) DO UPDATE ... WHERE` statement. Under PostgreSQL's row lock, concurrent deliveries serialize at the conflicting key. The `WHERE` clause must reject terminal-state downgrades and payload identity changes. Return the persisted state and a boolean indicating whether a transition occurred; do not interpret a no-op as a fresh refund.

Suggested transition policy for webhook-originated writes:

| Existing | Incoming | Decision |
|---|---|---|
| absent | any valid state | insert |
| received | pending_link / review_required / applied | advance |
| received | received | no-op |
| pending_link | review_required / applied | advance after validation |
| pending_link | received | no-op |
| review_required | any webhook state | no-op (operator-only resolution) |
| applied | any webhook state | no-op |
| any | conflicting immutable event fields | reject / alert |

**Caution:** The current handler writes `received` before validation, then a second state. A single atomic state write after validation is preferable; otherwise a crash can strand an event at `received`. Do not enable `CREEM_AUTOMATED_REFUNDS` until a database transaction makes financial application idempotent and consistent with event state.

## Tests to add before integration

- Persist the same `event_id` across two handler invocations in a stateful mock: terminal `review_required` must not regress.
- Replay an already `applied` event; assert no additional financial RPC.
- Race two identical deliveries against disposable PostgreSQL; assert one event row and monotonic state.
- Race `received` against `review_required`; final state must be `review_required`.
- Send conflicting transaction/refund IDs for the same event ID; assert rejection and no financial effect.
- Simulate an RPC failure and retry; assert no duplicate credit reversal.
- Verify an unlinked purchase remains `pending_link` until a verified link exists.
- Confirm unsigned/invalid signature and wrong Creem mode cannot mutate tables.

## Release gate

Keep PR draft and `CREEM_AUTOMATED_REFUNDS` disabled. First isolate Preview from Production Supabase, then run disposable-DB tests and verify DB permissions/RLS for the new RPC. Review migration and rollback plan explicitly before any production schema change. Do not run state-changing Preview tests while shared Supabase credentials remain configured.
