# UXNest.ai free public beta — release gate

Status: **NOT READY / NO PRODUCTION DEPLOYMENT AUTHORIZED**  
Decision: 2026-11-18. Scope owner: product owner. Related: #66, #43, #41, #44, #56.

## Product scope
- [ ] Server-controlled `FREE_BETA_MODE` flag, **off by default** until reviewed and enabled explicitly in the target environment.
- [ ] When enabled, server rejects all checkout/session-creation, payment-intent, credit-purchase and refund execution endpoints with a clear non-billable response, irrespective of hidden UI or direct HTTP calls.
- [ ] Hide pricing, buy credits, upgrade, checkout and refund actions in the beta UI; keep billing code intact for future use.
- [ ] Free audits are authorized and counted **server-side**; provisional policy: 3 audits per account per calendar month, pending product-owner confirmation. Never accept a client-provided credit/quota value as authority.
- [ ] Quota consumption is atomic/idempotent under retries and concurrency; no Creem request is made on the free path.
- [ ] Add anonymous/IP and authenticated-user rate limits and abuse protections; audit submission remains protected against SSRF and unsafe URL targets.

## Authentication / data protection (release blockers)
- [ ] Consolidate the overlapping authentication changes in #2, #16 and #60–#65. Verify that password signup cannot create a session before server-side email proof is consumed.
- [ ] Verify OTP issuance, expiry, one-time consumption, resend, login and session restore; do not treat client-supplied email verification as proof (#41).
- [ ] Verify password-reset replay and concurrency behavior (#44).
- [ ] Validate Google token audience and verified email; fail closed when required configuration is absent.
- [ ] Review Supabase RLS and service-role access boundaries (#56).
- [ ] Isolate Preview database credentials from Production (#43). **Do not run database-writing Preview tests until isolation is confirmed.**

## Core Nest Audit quality
- [ ] On safe test URLs, verify submission, screenshot/evidence capture, audit completion, persisted results, report traceability, and download.
- [ ] Compare PDF output against the on-screen report for missing sections, clipping, blank pages, illegible text and evidence placement.
- [ ] Resolve release-critical Claude audit defects; document any noncritical known limitations.

## Legal and operational readiness
- [ ] Publish accurate Privacy Policy and Terms for a free beta; no paid promises.
- [ ] Display beta label and feedback/report-issue channel.
- [ ] Verify secrets, logs, errors, monitoring, rate-limit alerts and an operational rollback plan.
- [ ] Confirm the deployed **production** build SHA and execute post-deployment smoke tests **only after explicit production approval**.

## Safe test matrix (no live charges)
| Scenario | Expected result |
| --- | --- |
| Direct POST to checkout with free-beta mode enabled | Rejected before calling Creem |
| Direct POST to refund endpoint | Rejected before refund execution |
| Free user completes an audit | No charge; server records one free usage |
| Replayed/concurrent audit submission | No double counting or unauthorized unlimited use |
| Exhausted free quota | Clear limit response; no payment requirement |
| Unverified password signup/login | No authenticated session |
| Expired/replayed verification or reset token | Rejected |
| Private/localhost/metadata URL audit | Blocked |
| Valid public URL audit | Screenshot, findings, evidence and report complete |
| PDF download | Matches report; no clipping/blank pages |

## Deferred from beta, not completed
Creem integration, paid credits, subscriptions, payment history, refund workflow (including PR #14), commercial billing policies and company formation. Do not mark these as fixed.

**Release rule:** A READY Preview build is insufficient. Do not merge, deploy production, alter production database schema/data, or execute financial transactions without explicit approval.
