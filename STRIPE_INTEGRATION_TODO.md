# Stripe Integration TODO

This file is the single source of truth for the remaining Stripe setup and launch steps for UXNest.

## Values to Replace

There are **no Stripe Checkout placeholder Price IDs** in the current integration. The existing line_items implementation uses a real UXNest one-time amount through Stripe price_data, so it was preserved as required.

**Files containing placeholders:**
- None.

Before going live, verify that the Stripe account/environment is the intended one (Test vs Live) and that the server and browser environment variables below are configured.

## Configured Parameters

These parameters were configured for the Checkout Form integration and are already set in the code.

**Files containing these parameters:**
- [api/payment.js](api/payment.js)
- [src/UxnestApp.jsx](src/UxnestApp.jsx)
- [index.html](index.html)

| Parameter | Value |
|-----------|-------|
| ui_mode | form |
| mode | payment |
| billing_address_collection | auto |
| phone_number_collection.enabled | false |
| automatic_tax.enabled | false |
| payment_method_collection | Not included because this is a one-time payment |
| submit_type | auto |
| name_collection.individual.enabled | true |
| name_collection.business.enabled | true |
| name_collection.business.optional | true |
| integration_identifier | custom_embedded_web_0002 |
| Stripe API version | 2026-03-25.dahlia; custom_checkout_payment_form_preview=v1 |
| Checkout beta | custom_checkout_payment_form_1 |
| Beta audit price | $5 USD |
| Regular audit price | $10 USD |

## Setup and Next Steps

### 1. Configure environment variables

For the Vite frontend, set:

    VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

For the Vercel/serverless backend, set:

    STRIPE_SECRET_KEY=sk_test_...

Use the corresponding Live keys only when moving UXNest to production payments.

Do not commit either key to GitHub.

### 2. Stripe test mode

Start with Stripe Test mode. The browser loads Stripe.js directly from https://js.stripe.com/dahlia/stripe.js.

### 3. Payment flow

1. A signed-in UXNest user consumes the included free audit.
2. UXNest displays Buy audit — $5 during beta.
3. The browser calls /api/payment with the existing authenticated session.
4. The server creates a one-time Checkout Session.
5. The server returns client_secret and session_id as JSON.
6. Stripe's hosted Checkout Form is rendered in the UXNest modal.
7. The customer confirms payment.
8. UXNest verifies the Checkout Session server-side.
9. A verified payment creates an audit_purchases record and grants one paid_audits credit.
10. The user can immediately run the additional audit.

### 4. Test payment

Use Stripe's official test cards in Test mode.

- Successful payment: 4242 4242 4242 4242
- Use any future expiration date, any CVC, and a valid-looking ZIP/postal code.

Do not use real card numbers in Test mode.

### 5. Verify the database

UXNest already uses accounts.paid_audits for available paid audit credits and audit_purchases for idempotent Stripe Checkout Session tracking.

The payment verification endpoint checks that the Checkout Session is paid, belongs to the current account, and has the expected amount/currency before granting the credit.

### 6. Vercel deployment

After setting the environment variables in Vercel, redeploy the application so both the frontend publishable key and server secret are available in the correct environments.

### 7. Before switching to Live payments

- Vercel Production has the Live STRIPE_SECRET_KEY.
- Vercel Production has the Live VITE_STRIPE_PUBLISHABLE_KEY.
- Stripe Dashboard is in the intended Live environment.
- The $5 beta amount is intentional.
- The beta discount and one-time purchase language are still accurate.
- A successful live payment grants exactly one audit credit.
- A cancelled/failed payment grants no credit.
- Repeating the success/verification flow does not grant duplicate credit.

## Project Structure

No new server route was introduced. The existing payment endpoint and frontend were updated:

- [api/payment.js](api/payment.js) — creates and verifies Stripe Checkout Sessions.
- [src/UxnestApp.jsx](src/UxnestApp.jsx) — initializes and mounts the Stripe Checkout Form.
- [index.html](index.html) — loads Stripe's required Dahlia build directly.
- [db/schema.sql](db/schema.sql) — existing paid-audit purchase/credit storage.

## Important Implementation Notes

- This is a one-time payment, not a subscription.
- payment_method_collection is intentionally omitted because Checkout Studio specifies it only for subscription mode.
- The existing real UXNest line-item amount was preserved rather than replacing it with a placeholder Price ID.
- Stripe secrets remain server-side.
- The browser uses VITE_STRIPE_PUBLISHABLE_KEY; server-only secrets use STRIPE_SECRET_KEY.
- The Checkout Form uses the required beta flag custom_checkout_payment_form_1.

## Resources

- Stripe Support: https://support.stripe.com
- Stripe documentation: https://docs.stripe.com/mcp
- Stripe test cards: https://docs.stripe.com/testing