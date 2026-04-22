import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://noonprdctdsc-the360squad.vercel.app'),
  title: 'Noon Product Description Generator — The360Squad',
  description:
    'Turn AliExpress product URLs and images into Noon.com-ready bilingual listings (English + Arabic). Noon-compliant, multi-product, CSV export.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Noon Product Description Generator — The360Squad',
    description:
      'Turn AliExpress product URLs and images into Noon-compliant bilingual listings (English + Arabic).',
    type: 'website',
    url: 'https://noonprdctdsc-the360squad.vercel.app',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
