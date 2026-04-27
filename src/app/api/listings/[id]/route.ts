import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer, supabaseServerConfigured } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

// Delete a single listing owned by the current user. RLS enforces ownership;
// attempting to delete someone else's row returns 0 affected rows from Postgres
// rather than an error — we translate that into 404 so the client can clean up.

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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

  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const { error, count } = await supabase
    .from('listings')
    .delete({ count: 'exact' })
    .eq('id', numeric)
    .eq('user_id', user.id);

  if (error) {
    // Don't echo Postgres error.message back to the client — it can leak
    // schema details (column names, constraint identifiers) which is mild
    // info-disclosure. Server logs keep the full context for debugging.
    console.error('[listings/:id] delete failed', { id: numeric, error });
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
