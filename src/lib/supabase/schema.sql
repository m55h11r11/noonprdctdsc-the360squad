-- Run this ONCE in your Supabase SQL editor after installing the
-- Vercel Supabase Marketplace integration.
-- Project: noonprdctdsc-the360squad

-- ─── listings table ──────────────────────────────────────────────────────────
-- One row per successful generation. user_id points to auth.users; covers both
-- anonymous sessions and Google-signed-in users (Supabase keeps the same
-- user_id across the anon → Google upgrade via linkIdentity).

create table if not exists listings (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  source_urls   jsonb not null default '[]'::jsonb,
  note          text,
  provider      text,          -- which BYOK was used: anthropic/google/openai/groq/mistral/openrouter
  model_id      text,          -- optional model override entered in Settings
  image_count   int not null default 0,
  generation_ms int,           -- how long the model call took end-to-end
  result        jsonb not null, -- the full {en, ar} bilingual Listing object
  created_at    timestamptz not null default now()
);

-- Fast pagination per user, newest-first.
create index if not exists listings_user_created_idx
  on listings(user_id, created_at desc);

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- Enforces per-user isolation at the DB level, so even if a client-side bug
-- asked for someone else's rows Postgres would reject it.

alter table listings enable row level security;

create policy "read own listings"
  on listings for select
  using (auth.uid() = user_id);

create policy "insert own listings"
  on listings for insert
  with check (auth.uid() = user_id);

create policy "delete own listings"
  on listings for delete
  using (auth.uid() = user_id);

-- No UPDATE policy on purpose — regenerating a listing creates a new row
-- rather than mutating an old one. This preserves history for data analysis
-- ("did the user retry 3 times with different notes?").

-- ─── Useful analytics queries (for the owner, run ad-hoc) ────────────────────
-- Top providers used:
--   select provider, count(*) from listings group by provider order by 2 desc;
-- Top source domains:
--   select regexp_replace(url::text, '.+://([^/]+).*', '\1') as domain, count(*)
--   from listings, jsonb_array_elements_text(source_urls) as url
--   group by 1 order by 2 desc;
-- Generations per day:
--   select date_trunc('day', created_at) as day, count(*)
--   from listings group by 1 order by 1 desc;
-- Slow calls (>15s):
--   select id, provider, model_id, generation_ms from listings
--   where generation_ms > 15000 order by generation_ms desc limit 50;
