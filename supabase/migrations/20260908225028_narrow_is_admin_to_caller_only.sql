-- Follow-up to harden_profiles_function_grants_and_policies. get_advisors
-- still flags is_admin(uuid) as callable by `authenticated` via
-- /rest/v1/rpc/is_admin -- unavoidable while it takes an arbitrary
-- user_id, since RLS policy evaluation requires `authenticated` to hold
-- EXECUTE on any function a policy calls, and that grant also makes it
-- directly callable. The policies here only ever check the CALLER's own
-- status (public.is_admin((select auth.uid()))), so narrow the function
-- to take no argument and look up (select auth.uid()) internally. Now
-- calling it directly via RPC can only tell a user their own is_admin
-- value -- which they can already read off their own profiles row -- not
-- probe an arbitrary uuid.

drop policy "profiles_select" on public.profiles;
drop policy "profiles_update" on public.profiles;

drop function public.is_admin(uuid);

create function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

comment on function public.is_admin() is
  'SECURITY DEFINER so the internal SELECT bypasses RLS on profiles (runs as the function owner) instead of recursing back into the policies that call this function. Always checks the caller (auth.uid()), never an arbitrary user, so calling it directly via RPC cannot be used to probe another user''s admin status.';

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- profiles_before_update also referenced is_admin(auth.uid()); recreate it
-- against the new zero-arg signature.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := old.created_at;

  if new.is_admin is distinct from old.is_admin
     and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.is_admin()
  );

create policy "profiles_update"
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    or public.is_admin()
  )
  with check (
    (select auth.uid()) = id
    or public.is_admin()
  );
