# Launch-day Creem refund reconciliation (manual mode)

**Scope:** The webhook records refund events; it does not reverse UXNest credits unless `CREEM_AUTOMATED_REFUNDS=enabled`. Do not set that variable for launch. A refund in Creem is **not** automatically a completed UXNest reconciliation.

## Authorized operator checklist

1. Identify a refund using its **Creem refund ID** and transaction ID. Confirm the refund actually succeeded in the Creem dashboard. Do not trust email or a user-provided screenshot alone.
2. Match the transaction to exactly one `audit_purchases` row and account. Confirm currency, original payment amount, refund amount, and whether the refund is partial. Unmatched or partial refunds require investigation, not automatic credit changes.
3. Check the customer's current credit balance, credits originally granted, credits already spent, previous refunds, and ledger entries. Do not assume the customer still holds all credits.
4. Decide and document the appropriate adjustment under an approved customer policy. If credits were consumed or balance is insufficient, escalate for manual resolution. **Never create a negative balance or reverse unrelated credits.**
5. Use only an approved, authenticated, audited administrative adjustment procedure once available. **Do not edit production tables manually or run unreviewed SQL.** Record operator, timestamp, purchase/refund IDs, adjustment amount, reason, and before/after balances.
6. Recheck the ledger and event status after reconciliation; ensure the same refund ID cannot be applied twice. Mark the case closed only after independent verification.
7. For repeated, malformed, or conflicting refund events, preserve evidence and escalate. Do not toggle automated refunds to clear a queue.

## Release gates

- Implement an audited admin adjustment/reconciliation capability (or formally approve a documented existing equivalent).
- Prove signed webhook handling with mocked tests for succeeded, duplicate, pending, partial, unmatched, and malformed refunds.
- Prove manual mode never invokes `apply_creem_refund` and does not modify balances; test checkout credit grants separately.
- Confirm refund events carry an explicit `mode` matching `CREEM_MODE` (`test` or `live`/`prod`). Missing/mismatched mode is recorded for review and cannot trigger automatic reversal; investigate real Creem payload shape before approving automatic refunds.
- Validate webhook-event replay does not overwrite a previously applied/closed record (PR #29 overlap).
- Confirm Preview and Production do not define `CREEM_AUTOMATED_REFUNDS=enabled`; confirm Preview database isolation before any state-changing E2E test.
- Reconcile overlapping payment PRs #23, #27, #29–#33 into one reviewed release candidate. Keep refund automation out of initial release.

**Status:** This runbook is a proposed operating procedure, not proof that the admin reconciliation capability exists.
