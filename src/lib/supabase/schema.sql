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

-- Drop-then-create so this script is idempotent on re-runs. Postgres has no
-- `create policy if not exists` syntax — this is the closest equivalent.
drop policy if exists "read own listings" on listings;
create policy "read own listings"
  on listings for select
  using (auth.uid() = user_id);

drop policy if exists "insert own listings" on listings;
create policy "insert own listings"
  on listings for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete own listings" on listings;
create policy "delete own listings"
  on listings for delete
  using (auth.uid() = user_id);

-- No UPDATE policy on purpose — regenerating a listing creates a new row
-- rather than mutating an old one. This preserves history for data analysis
-- ("did the user retry 3 times with different notes?").

-- ─── Anonymous → authenticated migration ─────────────────────────────────────
-- Re-parent listings created under an anonymous session to the new authenticated
-- user. Without this, anon listings stay orphaned under the dead anon user_id
-- (invisible under RLS) when the user signs in with Google.
--
-- Runs as `security definer` because RLS would otherwise block the UPDATE
-- (auth.uid() no longer matches the old user_id). Guarded so it only moves
-- rows whose source owner was an anonymous user — prevents one authenticated
-- user from claiming another's listings by passing in their UUID.
create or replace function migrate_anon_listings(old_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  moved int;
  was_anon boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if old_user_id = auth.uid() then
    return 0;
  end if;
  -- Lock the source row FOR UPDATE so concurrent migrate calls serialize
  -- on it. Without the lock, two callers could both pass the is_anonymous
  -- check and both attempt the UPDATE — the loser would silently move zero
  -- rows but we'd have a brief race window where both succeeded the auth
  -- check on the same anon user.
  select coalesce(is_anonymous, false) into was_anon
    from auth.users where id = old_user_id for update;
  if not coalesce(was_anon, false) then
    raise exception 'source_not_anonymous';
  end if;
  update listings set user_id = auth.uid() where user_id = old_user_id;
  get diagnostics moved = row_count;
  -- Single-use: delete the source anon user so this UUID cannot be
  -- re-claimed by anyone else (e.g. shared device, leaked log). The
  -- ON DELETE CASCADE on listings.user_id is fine because we already
  -- moved the rows out. Any rows that race in AFTER the UPDATE but
  -- BEFORE this DELETE would be cascaded — accepted: the user just
  -- regenerated and the new row landed under the new identity.
  delete from auth.users where id = old_user_id and is_anonymous = true;
  return moved;
end;
$$;

revoke all on function migrate_anon_listings(uuid) from public;
grant execute on function migrate_anon_listings(uuid) to authenticated;

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
