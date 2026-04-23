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
  const next = url.searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await getSupabaseServer();
    if (supabase) {
      await supabase.auth.exchangeCodeForSession(code);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
