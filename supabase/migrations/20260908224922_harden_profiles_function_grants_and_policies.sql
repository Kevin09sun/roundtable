-- Follow-up to 20260908181632_create_profiles_table.sql, addressing
-- get_advisors findings:
--
-- SECURITY (anon/authenticated_security_definer_function_executable):
-- handle_new_user() and profiles_before_update() are trigger-only
-- functions and should never be callable directly (e.g. via PostgREST's
-- /rest/v1/rpc/<fn> endpoint). is_admin(uuid) legitimately needs EXECUTE
-- for `authenticated` (RLS policies run as the querying role, so that
-- role needs privilege to call any function referenced in a policy
-- expression) but not for `anon` (no policy here applies to anon).
-- The previous migration's `revoke all ... from public` only revoked the
-- implicit PUBLIC grant -- this project's schema has default privileges
-- that ALSO grant EXECUTE directly to the named anon/authenticated roles
-- at function-creation time, which `... from public` does not touch.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.profiles_before_update() from public, anon, authenticated;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- PERFORMANCE (auth_rls_initplan, multiple_permissive_policies):
-- Wrap auth.uid()/is_admin() in `(select ...)` so Postgres evaluates them
-- once per statement instead of once per row, and consolidate the
-- own-row/admin-row policies (previously two permissive policies per
-- action) into one policy per action with an OR'd predicate -- same
-- access semantics, one policy evaluation instead of two.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.is_admin((select auth.uid()))
  );

create policy "profiles_update"
  on public.profiles
  for update
  to authenticated
  using (
    (select auth.uid()) = id
    or public.is_admin((select auth.uid()))
  )
  with check (
    (select auth.uid()) = id
    or public.is_admin((select auth.uid()))
  );
