# UXNest — Senior UX Audit

AI-powered UX audit tool. Upload screenshots/PDFs or enter a website URL and
get a structured audit (Nielsen heuristics, WCAG, trust, conversion, cognitive
load) styled as feedback from a senior UX design director — including a
12-slide presentation deck.

## Stack
- React + Vite frontend (`src/UxnestApp.jsx`)
- Vercel serverless functions in `api/` (accounts, audits, AI proxy, payments)
- Supabase (Postgres) for accounts, audits, purchases and rate limits
- Anthropic API for the audit model, Creem for payments, Resend for email

## Local development
```bash
npm install
npm run dev            # frontend only
npx vercel dev         # frontend + api/ functions (needs the env vars below)
npm test               # all checks (see "Testing")
```

## Deploying
1. **Database** — in the Supabase SQL editor run `db/schema.sql`, then every file
   in `supabase/migrations/` in filename order. Always apply new migrations
   **before** deploying the code that uses them.
2. Import the repo at vercel.com and set the environment variables below.
3. Deploy. Vercel auto-detects Vite and the `api/` functions.
4. In Creem, point the webhook at `https://<your-domain>/api/creem-webhook`.

### Environment variables
| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Audit model. Create at console.anthropic.com |
| `ANTHROPIC_MODEL` | no | Overrides the model (default `claude-sonnet-5-5`). The model is fixed server-side; clients cannot choose it |
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Never expose to the browser |
| `SESSION_SECRET` | yes | Long random string that signs session tokens. Use a different value from `VERIFY_SECRET` |
| `VERIFY_SECRET` | yes | Long random string that signs emailed codes |
| `RESEND_API_KEY` | yes | Verification, password-reset and support email |
| `VERIFY_FROM` | recommended | Verified sender, e.g. `UXNest <noreply@yourdomain.com>` (`onboarding@resend.dev` only delivers to your own Resend account) |
| `SUPPORT_EMAIL` | yes | Where support tickets are sent |
| `ADMIN_KEY` | yes | Key typed at `/#admin` |
| `GOOGLE_CLIENT_ID` | for Google sign-in | Server checks every Google token was issued for this client. If unset, Google sign-in is refused |
| `VITE_GOOGLE_CLIENT_ID` | for Google sign-in | Same client id, for the browser button |
| `CREEM_API_KEY`, `CREEM_PRODUCT_ID`, `CREEM_WEBHOOK_SECRET` | for payments | Creem checkout + webhook. `CREEM_API_BASE_URL` optionally overrides the API host |
| `SITE_URL` | recommended | Canonical origin for checkout return URLs (default `https://uxnest.ai`) |
| `BROWSERLESS_TOKEN` | optional | Rendering/screenshot providers for URL audits. Also `BROWSERLESS_BASE_URL`, `BROWSERLESS_PROXY`, `BROWSERLESS_PROXY_COUNTRY` |
| `SCREENSHOTONE_API_KEY`, `MICROLINK_API_KEY` | optional | Additional screenshot providers |

## How it works

### Accounts and sessions
- Passwords are hashed server-side with scrypt; the browser never sees a hash.
- **Signup requires the emailed 6-digit code, and the server checks it itself.**
  A client-side "verified" flag is never trusted.
- Sessions are HMAC-signed tokens valid for 30 days. Each carries the account's
  `session_epoch`, so a password reset revokes every earlier session.
- Password-reset codes are single-use (bound to the current password hash).
  Unknown addresses get an identical response and no email.
- Google sign-in verifies the ID token with Google **and** its audience/issuer.

### Rate limiting
Limits (login, code guessing, signup, previews, AI calls, URL fetches, admin key
guesses) are stored in Postgres via `hit_rate_limit()`, so they hold across
serverless instances. If the database or function is unavailable the code falls
back to per-instance memory, which is much weaker — apply the migration.

### Audit quota and payments
- Each account includes one free audit; more cost $5 each during beta (1–20 per purchase).
- `create_audit_with_credit()` spends a credit and saves the audit in one
  transaction, so concurrent requests cannot double-spend.
- The AI proxy (`/api/audit`) and URL fetcher (`/api/fetch-url`) require a
  signed-in account that still has an audit available, plus per-account hourly
  and daily caps. Known limitation: the credit is consumed when the finished
  audit is *saved*, so a user can run a limited number of AI calls without
  saving; the caps bound that cost.
- The landing-page preview and the support chat are unauthenticated but tiny,
  tool-restricted and limited per IP.
- Credits are granted by the Creem webhook and, as a fallback, when the customer
  returns from checkout. Both go through `grant_creem_audit_purchase()`, which
  is idempotent per checkout. The webhook verifies the signature over the
  **raw** request body.

### URL audits and SSRF
`api/_net.js` fetches user-supplied URLs. Every connection — including each
redirect hop and every robots.txt/sitemap request — is validated at connect
time against loopback, private, link-local, CGNAT, multicast and IPv6 special
ranges (including IPv4-mapped IPv6), which also defeats DNS rebinding.

### Database privileges
Functions are `security definer` and callable only by `service_role`. Postgres
grants EXECUTE to PUBLIC by default and Supabase exposes `public` functions over
its REST API, so the migration explicitly revokes access from `anon` and
`authenticated`. Keep doing that for any function you add.

## Testing
`npm test` runs, in order: the evidence/report model checks, the SSRF guard and
HTTP client, end-to-end API flows against an in-memory fake Supabase
(`--experimental-test-module-mocks`, Node 22+), and the SQL migrations against a
real Postgres engine (PGlite). CI runs the same on every push and PR.

## Admin analytics
Visit `/#admin` and enter `ADMIN_KEY`. Shows signups, audits over time, score
distribution, findings by severity, most-audited domains and an account table
with CSV export. Reads up to the latest 1000 accounts and audits; the response
includes true totals so truncation is visible. Guesses are rate limited.

## Vercel Analytics
`@vercel/analytics` is wired into `src/main.jsx`. Enable it in the Vercel
dashboard (project → Analytics) for site-wide traffic data.

## Naming convention

**UXNest** is the company and platform (uxnest.ai). Individual products carry
the **Nest** prefix:

| Product | Status |
|---|---|
| Nest Audit | Live |
| Nest Research | Planned |
| Nest Design | Planned |
| Nest Strategy | Planned |
| Nest Testing | Planned |
| Nest Copilot | Planned |

Reports, slide decks and emails are branded "Nest Audit"; the site chrome,
legal pages and account emails are branded "UXNest".

## AI Assistant

A chat widget appears on every page. It answers from a fixed knowledge base in
`src/SupportChat.jsx` — deliberately explicit so the agent can't invent
features, prices or policies. When it can't resolve something it emits an
`[ESCALATE]` token, the widget asks for the user's email, and `api/support.js`
emails the full conversation to you via Resend. Requires `SUPPORT_EMAIL`.

When a report is open it is passed to the assistant as a compact brief
(`buildReportBrief`) so users can ask "what should I fix first?" and get
answers grounded in their own audit.

**Keep `SUPPORT_CONTEXT` in sync with pricing, limits and policies** — it is
what the agent tells customers about billing.
