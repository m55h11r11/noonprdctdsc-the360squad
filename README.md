# Noon Product Description Generator — The360Squad

A zero-signup, zero-cost-to-operator web tool that turns AliExpress URLs +
product images into **Noon.com-compliant bilingual listings** (Arabic +
English). Multi-product, CSV export, **bring-your-own-key** — every visitor
pays their own way.

**Live**: https://noonprdctdsc-the360squad.vercel.app

---

## What it does

- Drop one or more products (URL text + image uploads per product)
- Click **Generate** → get Noon-compliant title, description, and 5 feature bullets in **both Arabic (shown first) and English**
- **Rules enforced at the prompt level**, matching Noon's published QC policies:
  - Title: 20–200 chars, Title Case, no symbols, no emojis
  - Description: 250–4000 chars, plain text only (no bold/italic/HTML/emoji/links)
  - Features: exactly 5 bullets, ≤250 chars each, no emojis, 4+1 framework (3 benefit + 1 differentiation + 1 technical)
  - Arabic: natural Khaleeji-friendly MSA, Western digits
- **Add more products** in the same session → **Export all as one CSV** (RFC 4180 compliant with UTF-8 BOM so Excel opens Arabic cleanly)

## Why BYOK only

Running the default model path for all visitors would expose the deploy owner to
abuse spikes and viral-traffic surprise bills. BYOK flips that: each visitor
brings their own API key, the server just forwards requests. **The deploy owner
pays $0 per generation regardless of traffic.**

The onboarding card points users at **Google Gemini's free tier** (a real key
takes ~30 seconds, has a meaningful free quota, no credit card). Other providers
live in the Settings modal.

Supported BYOK providers:

| Provider | Default model | Get a key |
|---|---|---|
| Google (Gemini) | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com/app/apikey) — free tier |
| Anthropic (Claude) | `claude-haiku-4-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI (GPT) | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Groq (Llama / Mixtral) | `llama-3.3-70b-versatile` | [console.groq.com](https://console.groq.com/keys) — free tier |
| Mistral | `mistral-small-latest` | [console.mistral.ai](https://console.mistral.ai/api-keys) |
| OpenRouter | `anthropic/claude-haiku-4-5` | [openrouter.ai/keys](https://openrouter.ai/keys) |

**All 6 supported with 3 SDKs**: Anthropic and Google use native SDKs;
OpenAI/Groq/Mistral/OpenRouter share `@ai-sdk/openai` with a `baseURL` swap
(they all speak the OpenAI Chat Completions wire protocol).

**Keys never touch disk**: stored in the user's browser (`localStorage`) and
forwarded as a pass-through header on each request. The server does not log or
persist the key.

---

## Stack

| Piece | Tool |
|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind 4, Arabic-first RTL |
| AI SDK | [`ai`](https://ai-sdk.dev) v6 with `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai` |
| Structured output | Zod schemas on `generateObject` |
| Runtime | Vercel Fluid Compute (Node.js, 60s) |
| Hosting | Vercel |
| Analytics | `@vercel/analytics` |

---

## Deploy from scratch

```bash
git clone https://github.com/m55h11r11/noonprdctdsc-the360squad
cd noonprdctdsc-the360squad
npm install
npm run dev          # http://localhost:3000
# or
vercel link --yes --project=noonprdctdsc-the360squad
vercel --prod
```

No environment variables required. No billing to set up. No Redis to
provision. It just runs.

---

## Noon compliance notes

Prompts are distilled from official Noon Seller Center documentation:

- [Title Requirements & Rejection Reasons](https://support.noon.partners/portal/en/kb/articles/title-requirements-and-rejection-reasons-for-the-seller-sku)
- [Feature Bullets & Description](https://support.noon.partners/portal/en/kb/articles/feature-bullets-product-highlights-and-description-for-the-seller-sku)
- [Product Listing Policy](https://support.noon.partners/portal/en/kb/articles/product-listing-policy)

To tighten further (category-specific attributes, brand-prefixed titles,
Arabic-Indic digits instead of Western), edit `src/lib/prompt.ts` and the Zod
constraints in `src/lib/schema.ts`.

---

## File map

```
src/
├── app/
│   ├── api/generate/route.ts   API — requires x-byok-provider + x-byok-key;
│   │                            routes to provider SDK; Zod-validated output
│   ├── layout.tsx               Arabic-first metadata, dir="rtl" lang="ar"
│   ├── page.tsx                 Full UI: multi-product, unified paste input,
│   │                            onboarding card, flexible BYOK modal
│   ├── opengraph-image.tsx      Dynamic social card (1200×630)
│   ├── icon.svg                 Noon-yellow monogram favicon
│   └── globals.css              Tailwind + .rtl / .ltr utility classes
└── lib/
    ├── prompt.ts                Noon system prompt (the compliance engine)
    ├── schema.ts                Zod — enforces Noon's numeric constraints
    ├── providers.ts             6 providers via 3 SDKs (anthropic, google,
    │                            openai-compat with baseURL swap)
    ├── image.ts                 Client-side resize to 1280px / JPEG 0.85
    └── csv.ts                   RFC 4180 + UTF-8 BOM for Excel-safe Arabic
```
