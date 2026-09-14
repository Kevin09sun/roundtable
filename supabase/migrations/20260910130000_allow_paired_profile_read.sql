-- Phase 4 follow-up, found by driving the app in a real browser (not caught
-- by the RLS integration test suite, since none of those tests read a
-- JOINED profiles row as a non-admin participant): profiles_select only
-- ever let a user read their OWN row or an admin read any row. A pairing's
-- tutor and tutee need to see EACH OTHER's name -- but embedding profiles
-- through pairings (`tutor:profiles!pairings_tutor_id_fkey(...)`) is still
-- subject to profiles' own RLS on the embedded side, not just the outer
-- pairings query. Without this, a non-admin tutor reading their own
-- pairings row got the pairing fine (pairings_select allows that) but the
-- embedded tutee profile came back null -- which rendered as "Unknown" on
-- the dashboard.
--
-- Fix: fold a third condition into profiles_select (rather than adding a
-- second permissive policy -- see harden_profiles_function_grants_and_policies.sql
-- for why this project consolidates same-action policies into one OR'd
-- predicate) letting a user read the profile of anyone they are currently
-- paired with, tutor or tutee, in either direction. Scoped to NON-ENDED
-- pairings: once a pairing ends, the counterpart goes back to being a
-- stranger for RLS purposes, same as anyone else.
--
-- No recursion risk: this policy's subquery reads pairings, and
-- pairings_select's own predicate (auth.uid() = tutor_id/tutee_id, or
-- is_admin()) never queries profiles under RLS -- is_admin() is SECURITY
-- DEFINER and bypasses RLS internally rather than re-entering it.

drop policy "profiles_select" on public.profiles;

create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.is_admin()
    or exists (
      select 1
      from public.pairings pr
      where pr.status <> 'ended'
        and (
          (pr.tutor_id = (select auth.uid()) and pr.tutee_id = profiles.id)
          or (pr.tutee_id = (select auth.uid()) and pr.tutor_id = profiles.id)
        )
    )
  );

comment on policy "profiles_select" on public.profiles is
  'Own row, or admin, or the counterpart of a non-ended pairing you are part of (tutor reading tutee''s row or vice versa) -- the last branch exists so pairings embedding profiles (see src/app/dashboard/page.tsx, src/app/admin/pairings/page.tsx) can actually resolve the other party''s name for a non-admin participant.';
