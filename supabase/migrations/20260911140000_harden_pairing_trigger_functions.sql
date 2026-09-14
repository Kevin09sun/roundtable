-- Phase 4 review follow-up: both trigger functions attached to `pairings`
-- in 20260910120000_create_pairings_schema.sql were declared SECURITY
-- INVOKER (the default -- neither had `security definer`). That is wrong
-- for the same reason handle_new_user() and profiles_before_update() are
-- SECURITY DEFINER (see 20260908181632_create_profiles_table.sql): a
-- trigger function that reads or writes RLS-protected tables other than
-- the one it's firing on must not run under the WRITER's RLS, or its
-- answer depends on what the writer happens to be allowed to see/change --
-- not on the actual state of the database.
--
-- Today this is latent, not live: pairings_update_admin only lets admins
-- write to pairings at all, and public.is_admin() already bypasses RLS
-- internally, so every write that currently reaches these triggers happens
-- to run as a role RLS wouldn't restrict anyway. It stops being latent the
-- moment Phase 5 lands its promised narrow grant letting a tutee/tutor
-- participant UPDATE meeting_time on their own (non-admin) pairing -- see
-- the "Every update ... is admin-only for now" comment on pairings_update_admin
-- in the Phase 4 migration.
--
-- pairings_check_capacity() (BEFORE INSERT/UPDATE): confirmed broken today,
-- not just theoretically. Signed in as a non-admin fixture user and
-- attempted an insert using a (tutor_id, subject_id) pair that genuinely
-- exists in tutor_subjects; the writer's own RLS on tutor_subjects
-- (tutor_id = auth.uid()) hid that tutor's row, so v_max_tutees came back
-- NULL and the trigger raised "This tutor does not offer that subject." --
-- a false statement caused purely by the invoker's RLS blinding the
-- trigger, not by any real absence of that tutor_subjects row. The same
-- invoker-RLS problem undercounts `select count(*) from public.pairings`
-- for the capacity check itself: a writer who can only see a subset of
-- active pairings (RLS-filtered) would let capacity be exceeded by rows
-- they simply couldn't see. A capacity guard that only counts the rows the
-- caller is allowed to see is not a capacity guard.
--
-- pairings_sync_request_status() (AFTER INSERT/UPDATE/DELETE): under the
-- Phase 5 plan as currently described (participants may only ever change
-- meeting_time), neither branch of this function actually runs for a
-- participant's write -- both are gated on old.status/new.status or
-- old.request_id/new.request_id differing, and a meeting_time-only edit
-- changes neither. But that safety is an accident of what the narrow grant
-- happens to allow, not something this function enforces itself: nothing
-- here stops a future narrower policy from also permitting a status change
-- (e.g. a participant "ending" their own pairing), at which point its
-- `not exists (select 1 from public.pairings ...)` release-guard would be
-- RLS-filtered to the writer's visible pairings (silently releasing a
-- request that's still actively claimed by a pairing the writer can't
-- see), and its `update public.tutee_requests` would be subject to
-- tutee_requests_update_admin -- admin-only -- so a non-admin's release
-- would silently do nothing. Fixed for the same reason as the capacity
-- function: a trigger's correctness must not depend on how a future RLS
-- grant happens to be shaped.
--
-- Neither change adds attack surface. Both functions are already
-- `revoke execute ... from public, anon, authenticated` (trigger-only,
-- confirmed unreachable via PostgREST RPC -- calling either returns
-- PGRST202) and SECURITY DEFINER only changes whose privileges/RLS a
-- function's OWN body runs under, not who may invoke it.

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
  'BEFORE INSERT/UPDATE guard: rejects pairing a tutor for a subject they have no tutor_subjects row for, and rejects exceeding tutor_subjects.max_tutees active pairings for that subject. Re-counts inside the same transaction as the write it guards, so two concurrent admins cannot both fill a tutor''s last open slot. SECURITY DEFINER (see 20260911140000_harden_pairing_trigger_functions.sql) -- it must see every tutor_subjects/pairings row regardless of the writer''s own RLS, not just the ones the writer happens to be allowed to see. Trigger-only -- revoked from every role below.';

create or replace function public.pairings_sync_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A row that is (now) active and references a request claims it: pending
  -- -> matched. Covers INSERT of an active row, and UPDATE into 'active'
  -- or onto a different request_id.
  if tg_op in ('INSERT', 'UPDATE') and new.request_id is not null and new.status = 'active'
     and (
       tg_op = 'INSERT'
       or old.status <> 'active'
       or old.request_id is distinct from new.request_id
     ) then
    update public.tutee_requests
    set status = 'matched'
    where id = new.request_id
      and status = 'pending';
  end if;

  -- A row that WAS actively claiming a request and no longer is (status
  -- changed away from active, request_id changed, or the row was deleted
  -- outright) releases that request back to the queue -- but only if no
  -- OTHER active pairing still claims it.
  if (
    (tg_op = 'UPDATE' and old.request_id is not null and old.status = 'active'
      and (new.status <> 'active' or new.request_id is distinct from old.request_id))
    or (tg_op = 'DELETE' and old.request_id is not null and old.status = 'active')
  ) then
    if not exists (
      select 1 from public.pairings
      where request_id = old.request_id
        and status = 'active'
        and id <> old.id
    ) then
      update public.tutee_requests
      set status = 'pending'
      where id = old.request_id
        and status = 'matched';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.pairings_sync_request_status() is
  'AFTER INSERT/UPDATE/DELETE: claims a request (pending -> matched) when an active pairing starts referencing it, and releases it (matched -> pending) when the last active pairing referencing it goes away, however that happens (ended, reassigned, or deleted). SECURITY DEFINER (see 20260911140000_harden_pairing_trigger_functions.sql) -- its release-guard and its UPDATE on tutee_requests must not depend on what the writer''s own RLS lets them see or change. Trigger-only -- revoked from every role below.';

revoke execute on function public.pairings_check_capacity() from public, anon, authenticated;
revoke execute on function public.pairings_sync_request_status() from public, anon, authenticated;
