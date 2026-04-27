import type { Metadata } from 'next';
import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Geist's Arabic glyph coverage is weak; IBM Plex Sans Arabic ships a proper
// hand-tuned Naskh that matches Geist's geometric vibe and reads naturally
// at body sizes. Loaded on the `--font-arabic` CSS variable so globals.css
// can wire it up as the first family for Arabic content.
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: '--font-arabic',
  subsets: ['arabic'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://noonprdctdsc-the360squad.vercel.app'),
  title: 'مولد أوصاف منتجات نون — The360Squad',
  description:
    'حوّل روابط المنتجات من أي متجر (AliExpress، Amazon، Shopify، Salla…) وصورها إلى قوائم نون جاهزة بالعربية والإنجليزية. متوافق مع قواعد نون، يدعم عدة منتجات، وتصدير CSV.',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'مولد أوصاف منتجات نون — The360Squad',
    description: 'أنشئ أوصاف منتجات متوافقة مع نون بالعربية والإنجليزية من أي مصدر.',
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
      lang="ar"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexArabic.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider delayDuration={120}>
          {children}
          {/* Toaster — branded surface to match the cream/yellow palette.
              `richColors` was dropped: it forces emerald success / red error
              backgrounds that fight with the Noon yellow brand. We use the
              defaults (Sonner's neutral toast + small icon) and override
              the surface to our cream card. */}
          <Toaster
            position="top-center"
            dir="rtl"
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  'rounded-2xl border border-[color:var(--border-stronger)] bg-[color:var(--surface)] text-foreground shadow-2xl',
                description: 'text-muted-foreground',
              },
            }}
          />
        </TooltipProvider>
        <Analytics />
      </body>
    </html>
  );
}
