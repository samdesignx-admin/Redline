# Redline — Senior UX Audit

AI-powered UX audit tool. Upload screenshots/PDFs or enter a website URL and
get a structured audit (Nielsen heuristics, WCAG, trust, conversion, cognitive
load) styled as feedback from a senior UX design director — including a
12-slide presentation deck.

## Stack
- React + Vite frontend (single-component app: `src/RedlineApp.jsx`)
- Vercel serverless proxy (`api/audit.js`) that holds the Anthropic API key

## Deploy (Vercel)
1. Import this repo at vercel.com
2. In Project Settings → Environment Variables, add `ANTHROPIC_API_KEY`
   (create one at console.anthropic.com)
3. Deploy. Vercel auto-detects Vite and the `api/` function.

## Local development
```bash
npm install
npm run dev            # frontend only
# For the proxy locally: npx vercel dev (with ANTHROPIC_API_KEY in .env)
```

## Known prototype limitations (backend work pending)
- Auth/history use in-browser fallbacks — replace with Supabase or similar
- "Simulate Pro" is a demo toggle — real plans need Stripe
- Email report opens a mailto: draft — real delivery needs Resend/SendGrid
- Legal pages are placeholder templates — get lawyer review before charging
- Rate limiting in `api/audit.js` is in-memory per instance — add Redis
  (e.g. Upstash) before public launch

## Version
v1.0 benchmark — see git tags.

## Google sign-in (optional)

Set `VITE_GOOGLE_CLIENT_ID` in Vercel's Environment Variables to a Google OAuth
Web client ID (console.cloud.google.com → APIs & Services → Credentials), with
your deployed origin listed under "Authorised JavaScript origins". The Google
button only renders when this variable is present; otherwise the email/password
form is used on its own.

Note: the ID token returned by Google is currently decoded client-side for the
user's email and name. It is NOT signature-verified, which requires a server.
Treat Google sign-in as sign-in convenience, not identity proof, until the
backend verifies tokens.

## Email verification

Signup sends a 6-digit code before the account is created. Requires these
environment variables in Vercel:

| Variable | Where from |
|---|---|
| `RESEND_API_KEY` | resend.com → API Keys (free tier: 3,000 emails/month) |
| `VERIFY_SECRET` | any long random string you generate |
| `VERIFY_FROM` | a verified sender, e.g. `Redline <noreply@yourdomain.com>`. Resend allows `onboarding@resend.dev` for testing, which only delivers to your own account email. |

Codes are never stored server-side: `api/verify.js` issues an HMAC-signed token
carrying the expiry, and validates the submitted code by recomputing the
signature (10 minute TTL, rate limited per IP and per address).

Known limit: the `emailVerified` flag is stored in browser storage along with
the rest of the account, so a determined user could set it locally. The code
exchange genuinely proves control of the address at signup; making that
tamper-proof requires the account database.
