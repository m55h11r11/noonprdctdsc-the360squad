import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Noon Listing Generator',
  description:
    'How the Noon Listing Generator handles your data, API keys, and Google sign-in info.',
  robots: { index: true, follow: true },
};

// Plain English privacy page. Kept short on purpose — Google's verification
// reviewer reads these, and the truthful answers really are short:
// we don't run analytics on user content, we don't sell anything, the user's
// own API key never touches our database.

export default function PrivacyPage() {
  return (
    <main
      lang="en"
      dir="ltr"
      className="mx-auto max-w-3xl px-6 py-16 text-zinc-800 dark:text-zinc-100"
    >
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-zinc-500">Last updated: April 2026</p>

      <section className="mt-8 space-y-4 text-base leading-relaxed">
        <p>
          The Noon Listing Generator (the &quot;app&quot;) at{' '}
          <a
            className="underline"
            href="https://noonprdctdsc-the360squad.vercel.app"
          >
            noonprdctdsc-the360squad.vercel.app
          </a>{' '}
          turns product URLs and images into Noon-compliant marketplace listings.
          This page describes what data the app sees and how it&apos;s handled.
        </p>

        <h2 className="mt-8 text-xl font-semibold">What we collect</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Your generations.</strong> When you sign in (anonymously or with
            Google), the app stores the listings you generate so they sync across
            your devices: source URLs, your free-text note, the AI provider/model
            you chose, image counts, and the resulting listing JSON.
          </li>
          <li>
            <strong>Your Google profile (only if you click &quot;Sign in with
            Google&quot;).</strong> We receive your email address, name, and
            profile picture URL via Google OAuth — only to identify your account.
            We do not request any other Google data.
          </li>
          <li>
            <strong>Anonymous usage analytics</strong> via Vercel Analytics
            (page views, region). No content of your generations is sent.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">What we do NOT collect</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Your AI-provider API key.</strong> The key you paste in
            Settings is stored in your own browser&apos;s localStorage. It is
            sent on each generation request to our server, used once to call the
            AI provider, and never written to our database or logs.
          </li>
          <li>The product images you upload — they pass through to the AI provider in-memory and are not stored.</li>
          <li>Payment information. The app is free to use with your own AI key.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Where data is stored</h2>
        <p>
          Generated listings are stored in a Supabase Postgres database hosted in
          the EU. Database access is enforced by row-level security: you can only
          read or delete rows tied to your own user ID.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Your rights</h2>
        <p>
          You can delete every listing tied to your account at any time from the
          ☁️ menu in the app — &quot;Delete all my data&quot;. This is
          irreversible and also signs you out. To delete your account itself,
          delete your data first, then email us (below) and we&apos;ll remove the
          auth record within 7 days.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Third parties</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Supabase</strong> — database and authentication.
          </li>
          <li>
            <strong>Vercel</strong> — hosting and analytics.
          </li>
          <li>
            <strong>Google</strong> — only if you choose &quot;Sign in with
            Google&quot;.
          </li>
          <li>
            <strong>The AI provider you chose</strong> (Anthropic, Google, OpenAI,
            Groq, Mistral, or OpenRouter) — receives your prompt + images on
            each generation, billed against your own key.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Contact</h2>
        <p>
          Questions or data requests:{' '}
          <a className="underline" href="mailto:miblackstores@gmail.com">
            miblackstores@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
