import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-side Supabase client for API routes. Reads the session cookie set by
// the browser client, so `auth.uid()` matches the visitor's current session
// inside the database's RLS policies.
//
// This function is `async` because `cookies()` in Next.js 16 App Router returns
// a Promise — the old synchronous API is deprecated.

export const supabaseServerConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function getSupabaseServer() {
  if (!supabaseServerConfigured) return null;

  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              store.set(name, value, options);
            });
          } catch {
            // setAll throws inside Server Components — safe to ignore because
            // the middleware/route layer will write cookies on its own path.
          }
        },
      },
    },
  );
}
