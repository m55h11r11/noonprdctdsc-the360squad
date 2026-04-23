'use client';

import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client. Reads the public anon key — this is safe to
// expose client-side because Row Level Security on the listings table enforces
// auth.uid() = user_id for every query.
//
// The three env vars are injected by the Vercel Supabase Marketplace integration.
// If they're missing (e.g. during local dev without Supabase wired up), the
// `supabaseConfigured` flag lets the UI degrade gracefully — the ☁️ icon stays
// hidden and we never try to sign in.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = !!(url && anonKey);

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!supabaseConfigured) return null;
  if (!_client) {
    _client = createBrowserClient(url!, anonKey!);
  }
  return _client;
}
