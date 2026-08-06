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
