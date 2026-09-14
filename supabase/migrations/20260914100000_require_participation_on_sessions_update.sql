-- sessions_update's WITH CHECK never stated that an UPDATE'S RESULTING ROW
-- must still belong to a pairing the writer participates in (or, for an
-- admin, any pairing at all) -- it only checked logged_by. A non-admin
-- re-pointing pairing_id to a pairing they don't participate in is already
-- denied today, but only as a side effect of sessions_select's participation
-- requirement interacting with UPDATE (Postgres re-evaluates USING against
-- the post-image for an UPDATE that changes the row enough to fail SELECT
-- visibility), not because sessions_update says so. That's an emergent
-- guarantee, not a stated one: widening sessions_select later (the way
-- 20260910130000_allow_paired_profile_read.sql widened profiles_select) is
-- exactly the kind of change that could silently unblock this re-point
-- without anyone touching sessions_update at all. This migration makes the
-- requirement explicit in the policy that actually owns it, so it no longer
-- depends on SELECT's behavior to hold.
--
-- Still ONE OR'd policy, not a second permissive policy (same convention as
-- pairings_update, see 20260912093000_allow_participant_meeting_time_edit.sql)
-- -- the participation requirement is AND'd onto the existing
-- logged_by-or-admin check rather than stacked as a separate policy, and an
-- admin is exempted from it (an admin may still re-point a session to any
-- pairing) the same way admin is exempted from every other restriction here.

drop policy if exists "sessions_update" on public.sessions;

create policy "sessions_update"
  on public.sessions
  for update
  to authenticated
  using (
    logged_by = (select auth.uid())
    or public.is_admin()
  )
  with check (
    (logged_by = (select auth.uid()) or public.is_admin())
    and (public.is_admin() or public.is_pairing_participant(pairing_id))
  );
