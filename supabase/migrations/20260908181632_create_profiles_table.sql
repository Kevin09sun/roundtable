-- Phase 2: profiles table, auto-provisioning trigger, and RLS baseline.
--
-- Design notes (see PART B of the phase 2 spec):
--   * A profile row is created server-side by a trigger on auth.users, never
--     by the client — a signup that half-succeeds must not leave an
--     orphaned auth user with no matching profile.
--   * `is_admin` must not be self-escalatable. This is enforced with a
--     BEFORE UPDATE trigger (not just a WITH CHECK clause), because a user
--     updating their own row via `auth.uid() = id` would otherwise be free
--     to also flip is_admin — WITH CHECK only re-validates the row-level
--     predicate, it does not restrict which columns may change.
--   * The admin check is a SECURITY DEFINER function with an explicit
--     search_path. It must not itself be wrapped in an RLS policy that
--     queries profiles from within a profiles policy, or the policy will
--     recurse (policy -> query profiles -> policy -> ...). Because the
--     function is SECURITY DEFINER (owned by the migration's role, which
--     owns the table), its internal SELECT runs as the table owner and
--     bypasses RLS entirely instead of re-entering the policy.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  -- `grade between 3 and 12` evaluates to NULL (not false) when grade is
  -- NULL, and Postgres treats a NULL check result as satisfied, so this
  -- also allows grade to be unset without an explicit `grade is null or`.
  grade integer check (grade between 3 and 12),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users row. Created by the handle_new_user trigger, never by the client.';
comment on column public.profiles.is_admin is
  'Guarded by profiles_before_update trigger — cannot be self-escalated by a non-admin updating their own row.';

alter table public.profiles enable row level security;

-- No default privileges for anon; authenticated gets exactly what the RLS
-- policies below allow (select/update, never insert/delete from the client).
revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Admin check (SECURITY DEFINER, non-recursive)
-- ---------------------------------------------------------------------------

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = user_id),
    false
  );
$$;

comment on function public.is_admin(uuid) is
  'SECURITY DEFINER so the internal SELECT bypasses RLS on profiles (runs as the function owner) instead of recursing back into the policies that call this function.';

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-provision profiles.<row> on signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user')
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the matching profiles row when a new auth.users row is inserted. full_name comes from signup metadata; falls back to a placeholder so the NOT NULL/non-empty constraint always holds even if metadata is missing.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at maintenance + is_admin self-escalation guard
-- ---------------------------------------------------------------------------

create or replace function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- created_at is immutable once set, regardless of who is updating.
  new.created_at := old.created_at;

  -- The single most important security property in this table: a non-admin
  -- cannot grant themselves admin by updating their own row. A WITH CHECK
  -- clause alone would not stop this (it only re-checks auth.uid() = id,
  -- which is unaffected by is_admin), so we reset the column here instead
  -- of rejecting the whole update — the rest of the row change still goes
  -- through, is_admin is just silently kept at its previous value.
  if new.is_admin is distinct from old.is_admin
     and not public.is_admin(auth.uid()) then
    new.is_admin := old.is_admin;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.profiles_before_update() is
  'BEFORE UPDATE guard: pins created_at, and silently reverts is_admin changes made by a non-admin, then bumps updated_at.';

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
