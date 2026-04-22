# Noon Product Description Generator — The360Squad

A zero-signup web tool that turns AliExpress URLs + product images into
**Noon.com-compliant bilingual listings** (English + Arabic). Multi-product,
CSV export, BYOK for unlimited use.

**Live**: https://noonprdctdsc-the360squad.vercel.app

---

## What it does

- Drop one or more products (URL text + image uploads per product)
- Click **Generate** → get Noon-compliant title, description, and 5 feature bullets in **both English and Arabic**
- **Rules enforced at the prompt level**, matching Noon's published QC policies:
  - Title: 20–200 chars, Title Case, no symbols, no emojis
  - Description: 250–4000 chars, plain text only (no bold/italic/HTML/emoji/links)
  - Features: exactly 5 bullets, ≤250 chars each, no emojis, 4+1 framework (3 benefit + 1 differentiation + 1 technical)
  - Arabic: natural Khaleeji-friendly MSA, Western digits
- **Add more products** in the same session → **Export all as one CSV** (RFC 4180 compliant with UTF-8 BOM so Excel opens Arabic cleanly)
- **Model**: Claude Haiku 4.5 via Vercel AI Gateway (default) or your own Anthropic / Google Gemini key

## Free quota + BYOK

- **10 free generations per IP** (tracked server-side)
- When the quota runs out, users can click **Settings** and paste their own API key:
  - Anthropic (Claude Haiku 4.5) — get a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
  - Google (Gemini 2.5 Flash) — free tier available at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- **BYOK keys stay in the user's browser** — the server pass-throughs them to the provider and never stores them

---

## Stack

| Piece | Tool |
|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind 4 |
| AI SDK | [`ai`](https://ai-sdk.dev) v6 with `@ai-sdk/gateway`, `@ai-sdk/anthropic`, `@ai-sdk/google` |
| Structured output | Zod schemas on `generateObject` |
| Rate limiting | Upstash Redis + `@upstash/ratelimit` (with in-memory fallback for dev) |
| Runtime | Vercel Fluid Compute (Node.js, 60s) |
| Hosting | Vercel |

---

## Deploy from scratch

```bash
git clone <this repo>
cd NoonPrdctDsc-The360Squad
npm install
npm run dev          # local: http://localhost:3000
# or
vercel link --yes --project=noonprdctdsc-the360squad
vercel --prod
```

### Post-deploy — enable the free quota (recommended)

The free-10-per-IP quota uses Upstash Redis. Without it, the counter runs in-memory and resets each time Fluid Compute rotates an instance.

1. Go to the **Vercel project → Storage → Marketplace**
2. Click **Upstash Redis** → **Add Integration** → select this project
3. The two env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) are injected automatically
4. Redeploy (`vercel --prod`) — the `checkQuota` helper detects Upstash and switches from memory to Redis

### Post-deploy — enable the Gateway default path

The default model route (Haiku via AI Gateway) needs a credit card on file for your Vercel team — you then get **$5 free AI Gateway credit** (~2,500 generations) before any charges.

- Add a card at: https://vercel.com/\[your-team\]/~/ai
- Or skip this entirely — BYOK mode works without any Vercel billing

---

## Noon compliance notes

This tool's prompts are distilled from official Noon Seller Center documentation:

- [Title Requirements & Rejection Reasons](https://support.noon.partners/portal/en/kb/articles/title-requirements-and-rejection-reasons-for-the-seller-sku)
- [Feature Bullets & Description](https://support.noon.partners/portal/en/kb/articles/feature-bullets-product-highlights-and-description-for-the-seller-sku)
- [Product Listing Policy](https://support.noon.partners/portal/en/kb/articles/product-listing-policy)

**If you want to lock output even more tightly** (e.g. category-specific attribute requirements, brand-prefixed titles for certain categories, Arabic-Indic digits instead of Western), edit `src/lib/prompt.ts` and the Zod constraints in `src/lib/schema.ts`.

---

## File map

```
src/
├── app/
│   ├── api/generate/route.ts   API — rate limit + model call + Zod validation
│   ├── layout.tsx               Metadata, fonts
│   ├── page.tsx                 Full UI: multi-product state, dropzone, code blocks
│   └── globals.css              Tailwind + RTL helper
└── lib/
    ├── prompt.ts                Noon system prompt (the rules engine in plain English)
    ├── schema.ts                Zod schema — enforces Noon's numeric constraints
    ├── providers.ts             Gateway default, Anthropic/Google BYOK overrides
    ├── ratelimit.ts             Upstash with in-memory fallback; 10-per-IP lifetime + 5/min burst
    ├── image.ts                 Client-side resize to 1280px / JPEG quality 0.85
    └── csv.ts                   RFC 4180 + UTF-8 BOM for Excel-safe Arabic
```
