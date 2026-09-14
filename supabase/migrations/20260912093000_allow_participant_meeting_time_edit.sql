-- Phase 5 (Part B): the narrow-grant Phase 4 promised and deliberately did
-- not build -- see "Every update ... is admin-only for now" on
-- pairings_update_admin in 20260910120000_create_pairings_schema.sql. A
-- tutor or tutee on an active (non-ended) pairing may now edit their own
-- meeting_time; every other column on pairings stays admin-only.
--
-- Column-level GRANTs cannot express this: admins and students are both the
-- `authenticated` Postgres role (there is no separate "student" role to
-- grant/revoke per-column against), and the existing table-level `grant
-- update on public.pairings to authenticated` already confers every column
-- to that one role regardless. The only way to distinguish "this UPDATE may
-- touch every column" (admin) from "this UPDATE may touch exactly one
-- column" (participant) is at the ROW level (RLS, who may write the row at
-- all) plus the COLUMN level via a BEFORE UPDATE trigger inspecting NEW vs
-- OLD -- the same two-part pattern is_admin's self-escalation guard uses
-- (see 20260908181632_create_profiles_table.sql): RLS decides who may write
-- the row, a trigger decides which parts of the write survive.
--
-- Silently revert vs. raise: profiles_before_update silently reverts a
-- non-admin's is_admin change rather than rejecting the whole update,
-- because a legitimate self-update (e.g. changing full_name) might
-- incidentally carry a stale is_admin value along with it, and discarding
-- just that one field lets the rest of the write still succeed. That
-- reasoning does not transfer here: meeting_time is the ONLY thing a
-- participant ever has a legitimate reason to change on their own pairing.
-- There is no legitimate request that "also" changes status, tutor_id,
-- tutee_id, subject_id, ended_at, ended_reason, or request_id, so silently
-- discarding a change to any of those would just as silently mask a bug in
-- our own server action or a client bypassing the UI entirely, with no
-- signal that anything was dropped. This trigger RAISES instead, so an
-- unexpected column change fails the whole statement loudly rather than
-- reporting success while quietly doing less than the caller asked for.
--
-- Bug fixed in the same migration, because Part B exposes it the moment it
-- ships: pairings_check_capacity() re-counts capacity on every UPDATE of an
-- already-active row, including a meeting_time-only edit that doesn't touch
-- the tutor/subject slot at all. Once participants can edit meeting_time,
-- an admin who later lowers a tutor's max_tutees below their current active
-- count would make every subsequent meeting_time edit on an
-- already-fitting row fail with "This tutor is already at full capacity for
-- that subject" -- correct for a NEW claim on a slot, wrong for a row that
-- already held one and isn't relinquishing or moving it. Fixed by skipping
-- the check entirely when an already-active row stays active with the same
-- tutor and subject; it still runs for INSERT of an active row, a
-- transition into active, or a change of tutor_id/subject_id -- every case
-- that actually claims a (possibly new) slot.

-- ---------------------------------------------------------------------------
-- pairings_check_capacity: skip when no slot is actually being (re)claimed
-- ---------------------------------------------------------------------------

create or replace function public.pairings_check_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_tutees integer;
  v_active_count integer;
begin
  -- Only an (about to be) active row can violate capacity -- a row being
  -- paused or ended is releasing a slot, not claiming one.
  if new.status <> 'active' then
    return new;
  end if;

  -- A row that WAS already active and stays active with the same tutor and
  -- subject isn't claiming a NEW slot -- it already held this one, and
  -- nothing about that claim changed (e.g. a participant editing
  -- meeting_time). Re-running the count here would let a max_tutees lowered
  -- *after* the pairing was created retroactively break edits to a row that
  -- isn't asking for anything new.
  if tg_op = 'UPDATE'
     and old.status = 'active'
     and old.tutor_id = new.tutor_id
     and old.subject_id = new.subject_id
  then
    return new;
  end if;

  select max_tutees into v_max_tutees
  from public.tutor_subjects
  where tutor_id = new.tutor_id
    and subject_id = new.subject_id;

  if v_max_tutees is null then
    raise exception 'This tutor does not offer that subject.';
  end if;

  -- new.id is already populated at this point (BEFORE trigger, and id's
  -- default is resolved before the trigger fires) so `id <> new.id`
  -- correctly excludes the row itself on UPDATE and is a no-op on INSERT,
  -- where no row with that id exists yet.
  select count(*) into v_active_count
  from public.pairings
  where tutor_id = new.tutor_id
    and subject_id = new.subject_id
    and status = 'active'
    and id <> new.id;

  if v_active_count >= v_max_tutees then
    raise exception 'This tutor is already at full capacity for that subject.';
  end if;

  return new;
end;
$$;

comment on function public.pairings_check_capacity() is
  'BEFORE INSERT/UPDATE guard: rejects pairing a tutor for a subject they have no tutor_subjects row for, and rejects exceeding tutor_subjects.max_tutees active pairings for that subject. Skips the check entirely when an already-active row stays active with the same tutor and subject -- it is not claiming a new slot, so a max_tutees lowered afterward must not retroactively break edits to it (e.g. a participant editing meeting_time, see 20260912093000_allow_participant_meeting_time_edit.sql). Re-counts inside the same transaction as the write it guards, so two concurrent admins cannot both fill a tutor''s last open slot. SECURITY DEFINER -- it must see every tutor_subjects/pairings row regardless of the writer''s own RLS. Trigger-only -- revoked from every role below.';

revoke execute on function public.pairings_check_capacity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Widen pairings_update: admin (any column) OR a participant on a non-ended
-- pairing (meeting_time only, enforced by the trigger below) -- ONE OR'd
-- policy, not a second permissive policy (see
-- 20260908224922_harden_profiles_function_grants_and_policies.sql for why
-- this project consolidates same-action policies rather than stacking
-- permissive ones).
-- ---------------------------------------------------------------------------

drop policy if exists "pairings_update_admin" on public.pairings;

create policy "pairings_update"
  on public.pairings
  for update
  to authenticated
  using (
    public.is_admin()
    or (
      (select auth.uid()) in (tutor_id, tutee_id)
      and status <> 'ended'
    )
  )
  with check (
    public.is_admin()
    or (
      (select auth.uid()) in (tutor_id, tutee_id)
      and status <> 'ended'
    )
  );

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE trigger: a non-admin may change meeting_time and nothing
-- else. Admin writes pass through untouched.
-- ---------------------------------------------------------------------------

create function public.pairings_restrict_participant_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.tutor_id is distinct from old.tutor_id
     or new.tutee_id is distinct from old.tutee_id
     or new.subject_id is distinct from old.subject_id
     or new.request_id is distinct from old.request_id
     or new.ended_at is distinct from old.ended_at
     or new.ended_reason is distinct from old.ended_reason
  then
    raise exception 'You may only edit the meeting time for your own pairing.';
  end if;

  return new;
end;
$$;

comment on function public.pairings_restrict_participant_update() is
  'BEFORE UPDATE guard: a non-admin participant (RLS already restricts UPDATE to participants of non-ended pairings, or an admin) may change meeting_time and nothing else. RAISES rather than silently reverting -- unlike is_admin on profiles, there is no legitimate participant request that also touches another column, so an unexpected change fails loudly instead of silently no-op''ing. SECURITY DEFINER for consistency with every other trigger function on this table (public.is_admin() is independently SECURITY DEFINER, so this call is correct either way). Trigger-only -- revoked from every role below.';

revoke execute on function public.pairings_restrict_participant_update() from public, anon, authenticated;

drop trigger if exists pairings_restrict_participant_update on public.pairings;
create trigger pairings_restrict_participant_update
  before update on public.pairings
  for each row execute function public.pairings_restrict_participant_update();
