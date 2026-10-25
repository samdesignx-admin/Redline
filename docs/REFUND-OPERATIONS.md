# UXNest payment, credits and refunds — operator runbook

## Customer purchase history
- Signed-in customers open **Billing & Purchases**.
- The server authenticates their UXNest session and fetches only their own purchases and refund requests.
- Price is $5 per audit credit; historical Stripe purchases remain in the existing table.

## Refund flow
1. Customer submits a reason and requests a refund for a purchase.
2. Administrator opens the UXNest **Admin → Refund requests & reconciliation** panel.
3. If the payment has a valid Creem transaction and enough unused credits, approve the request.
4. Full refund: use the Creem dashboard by default. Optionally enable the **Issue full refund in Creem** button with the Vercel server-only environment variable `CREEM_ENABLE_API_REFUNDS=true` **only after test-mode validation**. This action explicitly confirms the transaction and will not retry ambiguous refund POSTs.
5. Creem sends `refund.created` to the existing signed endpoint `https://uxnest.ai/api/creem-webhook`. Configure this event in Creem Developers → Webhooks alongside `checkout.completed`.
6. Only full successful USD refunds with a refunded transaction are applied automatically. Partial/unconfirmed refund events are retained for manual review.
7. The database atomically sets the purchase to refunded and reclaims audit credits. If the credit balance is below the refunded quantity, the shortfall goes into `accounts.credit_debt` and offsets subsequent paid purchases. It never makes `paid_audits` negative.
8. Repeated signed webhook deliveries are idempotent; duplicate refund attempts cannot reclaim credits twice.

## Reconciliation
- The admin panel lists Creem purchases without a recorded transaction ID. **Sync from Creem** checks the original completed checkout against the account and product, then links its order and transaction.
- Unresolved signed refund events are listed in the same panel. The **Verify and reconcile** action rechecks the refunded transaction with Creem before calling the idempotent database refund function.
- API refund submission errors leave the purchase status at `processing` to avoid potentially issuing duplicate refunds. Reconcile with Creem before changing this state manually.
- A purchased credit can be spent only by the atomic `create_uxnest_audit` RPC; never decrement `accounts.paid_audits` through a browser-side read/modify/write.

## Production configuration
- `CREEM_API_KEY`, `CREEM_PRODUCT_ID`, `CREEM_WEBHOOK_SECRET` and `CREEM_MODE` stay in Vercel server-side environment variables.
- `CREEM_ENABLE_API_REFUNDS` is **off by default**. Do not enable live refunds before successfully testing checkout → approval → provider refund → signed webhook → credit reversal in Creem test mode.
- Service-role database operations are server-only. SQL RPC grants are restricted to `service_role`; publicly exposed tables have row-level security enabled.
- Partial refunds require manual credit reconciliation because money refunded does not necessarily represent a whole number of audit credits.
- Ledger entries start with this change; historical credit movements are not automatically backfilled. Existing `audit_purchases` remain authoritative for past purchases.

## Test coverage so far
- A database transaction was rolled back after checking new grants, duplicate grants, free and paid audit consumption, repeated refunds, refund shortfalls, and offsetting those shortfalls with a new purchase.
- Production Vercel deployments have built successfully.
- **Not yet verified:** an actual Creem test-mode full refund and webhook delivery. No real refund has been issued during implementation.
