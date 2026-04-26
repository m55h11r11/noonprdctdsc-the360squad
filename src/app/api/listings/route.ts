import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer, supabaseServerConfigured } from '@/lib/supabase/server';
import { ListingSchema } from '@/lib/schema';
import { LIST_FETCH_LIMIT } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 20;

function dbMissing() {
  return NextResponse.json(
    {
      error: 'cloud_not_configured',
      message:
        'Cross-device sync is not enabled yet. The owner needs to install Supabase via Vercel Marketplace.',
    },
    { status: 503 },
  );
}

// POST body — client sends the bits needed to persist a completed generation.
// user_id is NOT accepted from the client; it's always taken from the session
// cookie server-side.
const SaveBodySchema = z.object({
  name: z.string().min(1).max(120),
  sourceUrls: z.array(z.string().url()).max(20).default([]),
  note: z.string().max(2000).nullable().optional(),
  provider: z
    .enum(['anthropic', 'google', 'openai', 'groq', 'mistral', 'openrouter'])
    .nullable()
    .optional(),
  modelId: z.string().max(120).nullable().optional(),
  imageCount: z.number().int().min(0).max(20).default(0),
  generationMs: z.number().int().min(0).max(300_000).nullable().optional(),
  listing: ListingSchema,
});

export async function GET() {
  if (!supabaseServerConfigured) return dbMissing();
  const supabase = await getSupabaseServer();
  if (!supabase) return dbMissing();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('listings')
    .select('id, name, source_urls, note, provider, model_id, image_count, generation_ms, result, created_at')
    .order('created_at', { ascending: false })
    .limit(LIST_FETCH_LIMIT);

  if (error) {
    return NextResponse.json(
      { error: 'db_error', message: error.message },
      { status: 500 },
    );
  }

  // Defensive read: even though POST validates against ListingSchema, rows
  // can drift out of shape — schema evolution, manual DB inserts, future
  // migrations. Filter out malformed rows here so one bad row can't crash
  // the client when it dereferences result.ar.title etc. Log skipped rows
  // so the owner notices and can clean them up.
  const rows = data ?? [];
  const items = rows.filter((row) => {
    const parsed = ListingSchema.safeParse(row.result);
    if (!parsed.success) {
      console.warn(
        `[listings:get] skipping malformed row id=${row.id} user=${user.id}: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      return false;
    }
    return true;
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!supabaseServerConfigured) return dbMissing();
  const supabase = await getSupabaseServer();
  if (!supabase) return dbMissing();

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
  const parsed = SaveBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const { data, error } = await supabase
    .from('listings')
    .insert({
      user_id: user.id,
      name: d.name,
      source_urls: d.sourceUrls,
      note: d.note ?? null,
      provider: d.provider ?? null,
      model_id: d.modelId ?? null,
      image_count: d.imageCount,
      generation_ms: d.generationMs ?? null,
      result: d.listing,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'db_error', message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ item: data });
}

// Nuke everything for the current user — invoked by the "Delete my data"
// button in the sync modal. PDPL / GDPR right-to-erasure. Idempotent.
export async function DELETE() {
  if (!supabaseServerConfigured) return dbMissing();
  const supabase = await getSupabaseServer();
  if (!supabase) return dbMissing();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { error } = await supabase.from('listings').delete().eq('user_id', user.id);
  if (error) {
    return NextResponse.json(
      { error: 'db_error', message: error.message },
      { status: 500 },
    );
  }
  // Also sign them out so the next session is fresh.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
