import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — Noon Listing Generator',
  description: 'Plain-English terms for using the Noon Listing Generator.',
  robots: { index: true, follow: true },
};

// Short, honest TOS. The app is a free BYOK tool — there's not much to
// disclaim beyond "use it responsibly and we make no warranty."

export default function TermsPage() {
  return (
    <main
      lang="en"
      dir="ltr"
      className="mx-auto max-w-3xl px-6 py-16 text-zinc-800 dark:text-zinc-100"
    >
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
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
          is a free bring-your-own-key tool that converts product URLs and
          images into Noon-compliant listings. By using it you agree to the
          terms below.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Use of the app</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>You must own or have permission to publish the products and images you submit.</li>
          <li>
            You bring your own AI provider API key. You&apos;re responsible for
            any usage charges your provider bills against that key.
          </li>
          <li>
            Don&apos;t use the app to generate listings that violate Noon&apos;s
            policies, infringe trademarks, or misrepresent products.
          </li>
          <li>
            Don&apos;t try to attack, overload, or reverse-engineer the service.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Generated content</h2>
        <p>
          The AI-generated text and image briefs are provided as-is. You should
          review every listing before publishing on Noon — large language models
          can hallucinate facts. You retain full rights to listings you create
          here; we claim no copyright over your output.
        </p>

        <h2 className="mt-8 text-xl font-semibold">No warranty</h2>
        <p>
          The app is provided &quot;as is&quot; with no warranty of any kind.
          We don&apos;t guarantee uptime, accuracy, fitness for any particular
          purpose, or that your generated listings will be approved by Noon. Use
          at your own risk.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Privacy</h2>
        <p>
          See our{' '}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>{' '}
          for what we do (and don&apos;t) collect.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Changes &amp; termination</h2>
        <p>
          We may update these terms or shut the service down at any time. If we
          change anything material, the &quot;Last updated&quot; date above will
          change. You can stop using the app and delete your data via the ☁️
          menu at any time.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Contact</h2>
        <p>
          Questions:{' '}
          <a className="underline" href="mailto:miblackstores@gmail.com">
            miblackstores@gmail.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
