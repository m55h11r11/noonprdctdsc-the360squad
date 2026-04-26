import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer, supabaseServerConfigured } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

// Re-parent listings from an anonymous session to the now-authenticated user.
// Called from the client right after `SIGNED_IN` fires when the previous user
// was anonymous. The actual authorization happens inside the SQL function
// `migrate_anon_listings` which checks:
//   1. caller is authenticated (auth.uid() is not null)
//   2. the source user_id refers to an `is_anonymous=true` row
// So an authenticated user can NOT claim another authenticated user's
// listings by passing in that user's UUID — the SQL refuses.

const Body = z.object({ anonUserId: z.string().uuid() });

export async function POST(req: NextRequest) {
  if (!supabaseServerConfigured) {
    return NextResponse.json({ error: 'cloud_not_configured' }, { status: 503 });
  }
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: 'cloud_not_configured' }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // Idempotent no-op if the client mistakenly sends the new id back to us.
  if (parsed.data.anonUserId === user.id) {
    return NextResponse.json({ moved: 0 });
  }

  const { data, error } = await supabase.rpc('migrate_anon_listings', {
    old_user_id: parsed.data.anonUserId,
  });
  if (error) {
    // Don't echo the SQL error message to the wire — it can leak DB internals
    // (function names, search_path quirks, internal raise() strings). Log it
    // server-side so the owner can debug from Vercel logs.
    console.warn(
      `[listings:migrate] rpc failed for user=${user.id} anon=${parsed.data.anonUserId}: ${error.message}`,
    );
    return NextResponse.json(
      { error: 'migration_failed' },
      { status: 400 },
    );
  }
  return NextResponse.json({ moved: data ?? 0 });
}
