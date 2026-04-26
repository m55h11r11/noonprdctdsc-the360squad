import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// OAuth redirect landing page. Supabase bounces the user here after Google
// finishes authentication — we exchange the `?code=...` for a session,
// then redirect back to /. The session cookie set here is what subsequent
// API calls read via getSupabaseServer().

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const rawNext = url.searchParams.get('next') ?? '/';

  // Open-redirect defense: only allow same-origin relative paths. Without
  // this, `?next=https://evil.com` would bounce the just-signed-in user
  // off-site. `//evil.com` is also a protocol-relative URL — both blocked.
  const safeNext =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  if (code) {
    const supabase = await getSupabaseServer();
    if (supabase) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
