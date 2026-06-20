-- World Cup Predictor schema.
-- Run this in the Supabase SQL editor, or adapt it into a Supabase migration.

create table if not exists public.fixtures (
  id text primary key,
  phase text not null,
  kickoff_utc timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_predictions (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null references public.fixtures(id) on delete cascade,
  home_goals smallint not null check (home_goals between 0 and 99),
  away_goals smallint not null check (away_goals between 0 and 99),
  source text not null default 'manual' check (source in ('manual', 'simulation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

create index if not exists match_predictions_match_id_idx on public.match_predictions (match_id);
create index if not exists profiles_display_name_idx on public.profiles (display_name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_fixtures_updated_at on public.fixtures;
create trigger set_fixtures_updated_at
before update on public.fixtures
for each row execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_match_predictions_updated_at on public.match_predictions;
create trigger set_match_predictions_updated_at
before update on public.match_predictions
for each row execute function public.set_updated_at();

revoke all on public.fixtures from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.match_predictions from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.fixtures to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.match_predictions to authenticated;

alter table public.fixtures enable row level security;
alter table public.profiles enable row level security;
alter table public.match_predictions enable row level security;

drop policy if exists "authenticated can read fixtures" on public.fixtures;
create policy "authenticated can read fixtures"
on public.fixtures
for select
to authenticated
using (true);

drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "users can create own profile" on public.profiles;
create policy "users can create own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users can read own or locked predictions" on public.match_predictions;
create policy "users can read own or locked predictions"
on public.match_predictions
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.fixtures
    where fixtures.id = match_predictions.match_id
      and now() >= fixtures.kickoff_utc
  )
);

drop policy if exists "users can create own unlocked predictions" on public.match_predictions;
create policy "users can create own unlocked predictions"
on public.match_predictions
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.fixtures
    where fixtures.id = match_predictions.match_id
      and now() < fixtures.kickoff_utc
  )
);

drop policy if exists "users can update own unlocked predictions" on public.match_predictions;
create policy "users can update own unlocked predictions"
on public.match_predictions
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.fixtures
    where fixtures.id = match_predictions.match_id
      and now() < fixtures.kickoff_utc
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.fixtures
    where fixtures.id = match_predictions.match_id
      and now() < fixtures.kickoff_utc
  )
);

drop policy if exists "users can delete own unlocked predictions" on public.match_predictions;
create policy "users can delete own unlocked predictions"
on public.match_predictions
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.fixtures
    where fixtures.id = match_predictions.match_id
      and now() < fixtures.kickoff_utc
  )
);

insert into public.fixtures (id, phase, kickoff_utc)
values
  ('760415', 'group-stage', '2026-06-11T19:00Z'::timestamptz),
  ('760414', 'group-stage', '2026-06-12T02:00Z'::timestamptz),
  ('760416', 'group-stage', '2026-06-12T19:00Z'::timestamptz),
  ('760417', 'group-stage', '2026-06-13T01:00Z'::timestamptz),
  ('760420', 'group-stage', '2026-06-13T19:00Z'::timestamptz),
  ('760419', 'group-stage', '2026-06-13T22:00Z'::timestamptz),
  ('760418', 'group-stage', '2026-06-14T01:00Z'::timestamptz),
  ('760421', 'group-stage', '2026-06-14T04:00Z'::timestamptz),
  ('760422', 'group-stage', '2026-06-14T17:00Z'::timestamptz),
  ('760425', 'group-stage', '2026-06-14T20:00Z'::timestamptz),
  ('760423', 'group-stage', '2026-06-14T23:00Z'::timestamptz),
  ('760424', 'group-stage', '2026-06-15T02:00Z'::timestamptz),
  ('760428', 'group-stage', '2026-06-15T16:00Z'::timestamptz),
  ('760426', 'group-stage', '2026-06-15T19:00Z'::timestamptz),
  ('760429', 'group-stage', '2026-06-15T22:00Z'::timestamptz),
  ('760427', 'group-stage', '2026-06-16T01:00Z'::timestamptz),
  ('760432', 'group-stage', '2026-06-16T19:00Z'::timestamptz),
  ('760430', 'group-stage', '2026-06-16T22:00Z'::timestamptz),
  ('760433', 'group-stage', '2026-06-17T01:00Z'::timestamptz),
  ('760431', 'group-stage', '2026-06-17T04:00Z'::timestamptz),
  ('760435', 'group-stage', '2026-06-17T17:00Z'::timestamptz),
  ('760437', 'group-stage', '2026-06-17T20:00Z'::timestamptz),
  ('760434', 'group-stage', '2026-06-17T23:00Z'::timestamptz),
  ('760436', 'group-stage', '2026-06-18T02:00Z'::timestamptz),
  ('760438', 'group-stage', '2026-06-18T16:00Z'::timestamptz),
  ('760439', 'group-stage', '2026-06-18T19:00Z'::timestamptz),
  ('760440', 'group-stage', '2026-06-18T22:00Z'::timestamptz),
  ('760441', 'group-stage', '2026-06-19T01:00Z'::timestamptz),
  ('760442', 'group-stage', '2026-06-19T19:00Z'::timestamptz),
  ('760445', 'group-stage', '2026-06-19T22:00Z'::timestamptz),
  ('760444', 'group-stage', '2026-06-20T00:30Z'::timestamptz),
  ('760443', 'group-stage', '2026-06-20T03:00Z'::timestamptz),
  ('760447', 'group-stage', '2026-06-20T17:00Z'::timestamptz),
  ('760448', 'group-stage', '2026-06-20T20:00Z'::timestamptz),
  ('760446', 'group-stage', '2026-06-21T00:00Z'::timestamptz),
  ('760449', 'group-stage', '2026-06-21T04:00Z'::timestamptz),
  ('760453', 'group-stage', '2026-06-21T16:00Z'::timestamptz),
  ('760451', 'group-stage', '2026-06-21T19:00Z'::timestamptz),
  ('760450', 'group-stage', '2026-06-21T22:00Z'::timestamptz),
  ('760452', 'group-stage', '2026-06-22T01:00Z'::timestamptz),
  ('760456', 'group-stage', '2026-06-22T17:00Z'::timestamptz),
  ('760457', 'group-stage', '2026-06-22T21:00Z'::timestamptz),
  ('760454', 'group-stage', '2026-06-23T00:00Z'::timestamptz),
  ('760455', 'group-stage', '2026-06-23T03:00Z'::timestamptz),
  ('760461', 'group-stage', '2026-06-23T17:00Z'::timestamptz),
  ('760458', 'group-stage', '2026-06-23T20:00Z'::timestamptz),
  ('760460', 'group-stage', '2026-06-23T23:00Z'::timestamptz),
  ('760459', 'group-stage', '2026-06-24T02:00Z'::timestamptz),
  ('760462', 'group-stage', '2026-06-24T19:00Z'::timestamptz),
  ('760463', 'group-stage', '2026-06-24T19:00Z'::timestamptz),
  ('760464', 'group-stage', '2026-06-24T22:00Z'::timestamptz),
  ('760465', 'group-stage', '2026-06-24T22:00Z'::timestamptz),
  ('760467', 'group-stage', '2026-06-25T01:00Z'::timestamptz),
  ('760466', 'group-stage', '2026-06-25T01:00Z'::timestamptz),
  ('760473', 'group-stage', '2026-06-25T20:00Z'::timestamptz),
  ('760468', 'group-stage', '2026-06-25T20:00Z'::timestamptz),
  ('760471', 'group-stage', '2026-06-25T23:00Z'::timestamptz),
  ('760472', 'group-stage', '2026-06-25T23:00Z'::timestamptz),
  ('760469', 'group-stage', '2026-06-26T02:00Z'::timestamptz),
  ('760470', 'group-stage', '2026-06-26T02:00Z'::timestamptz),
  ('760475', 'group-stage', '2026-06-26T19:00Z'::timestamptz),
  ('760474', 'group-stage', '2026-06-26T19:00Z'::timestamptz),
  ('760478', 'group-stage', '2026-06-27T00:00Z'::timestamptz),
  ('760479', 'group-stage', '2026-06-27T00:00Z'::timestamptz),
  ('760476', 'group-stage', '2026-06-27T03:00Z'::timestamptz),
  ('760477', 'group-stage', '2026-06-27T03:00Z'::timestamptz),
  ('760480', 'group-stage', '2026-06-27T21:00Z'::timestamptz),
  ('760485', 'group-stage', '2026-06-27T21:00Z'::timestamptz),
  ('760481', 'group-stage', '2026-06-27T23:30Z'::timestamptz),
  ('760482', 'group-stage', '2026-06-27T23:30Z'::timestamptz),
  ('760484', 'group-stage', '2026-06-28T02:00Z'::timestamptz),
  ('760483', 'group-stage', '2026-06-28T02:00Z'::timestamptz),
  ('760486', 'round-of-32', '2026-06-28T19:00Z'::timestamptz),
  ('760487', 'round-of-32', '2026-06-29T17:00Z'::timestamptz),
  ('760489', 'round-of-32', '2026-06-29T20:30Z'::timestamptz),
  ('760488', 'round-of-32', '2026-06-30T01:00Z'::timestamptz),
  ('760490', 'round-of-32', '2026-06-30T17:00Z'::timestamptz),
  ('760492', 'round-of-32', '2026-06-30T21:00Z'::timestamptz),
  ('760491', 'round-of-32', '2026-07-01T01:00Z'::timestamptz),
  ('760495', 'round-of-32', '2026-07-01T16:00Z'::timestamptz),
  ('760493', 'round-of-32', '2026-07-01T20:00Z'::timestamptz),
  ('760494', 'round-of-32', '2026-07-02T00:00Z'::timestamptz),
  ('760497', 'round-of-32', '2026-07-02T19:00Z'::timestamptz),
  ('760496', 'round-of-32', '2026-07-02T23:00Z'::timestamptz),
  ('760498', 'round-of-32', '2026-07-03T03:00Z'::timestamptz),
  ('760499', 'round-of-32', '2026-07-03T18:00Z'::timestamptz),
  ('760500', 'round-of-32', '2026-07-03T22:00Z'::timestamptz),
  ('760501', 'round-of-32', '2026-07-04T01:30Z'::timestamptz),
  ('760502', 'round-of-16', '2026-07-04T17:00Z'::timestamptz),
  ('760503', 'round-of-16', '2026-07-04T21:00Z'::timestamptz),
  ('760504', 'round-of-16', '2026-07-05T20:00Z'::timestamptz),
  ('760505', 'round-of-16', '2026-07-06T00:00Z'::timestamptz),
  ('760506', 'round-of-16', '2026-07-06T19:00Z'::timestamptz),
  ('760507', 'round-of-16', '2026-07-07T00:00Z'::timestamptz),
  ('760509', 'round-of-16', '2026-07-07T16:00Z'::timestamptz),
  ('760508', 'round-of-16', '2026-07-07T20:00Z'::timestamptz),
  ('760510', 'quarterfinals', '2026-07-09T20:00Z'::timestamptz),
  ('760511', 'quarterfinals', '2026-07-10T19:00Z'::timestamptz),
  ('760512', 'quarterfinals', '2026-07-11T21:00Z'::timestamptz),
  ('760513', 'quarterfinals', '2026-07-12T01:00Z'::timestamptz),
  ('760514', 'semifinals', '2026-07-14T19:00Z'::timestamptz),
  ('760515', 'semifinals', '2026-07-15T19:00Z'::timestamptz),
  ('760516', '3rd-place-match', '2026-07-18T21:00Z'::timestamptz),
  ('760517', 'final', '2026-07-19T19:00Z'::timestamptz)
on conflict (id) do update
set phase = excluded.phase,
    kickoff_utc = excluded.kickoff_utc;
