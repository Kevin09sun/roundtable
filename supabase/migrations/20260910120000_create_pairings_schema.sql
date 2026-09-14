-- Phase 4 (Part A): pairings -- the highest-value table in the app. A
-- pairing assigns one tutor to one tutee for one subject. This is NOT a
-- booking system: there are no time slots, no calendar, nothing scheduled
-- by the database. `meeting_time` is a single free-text column both
-- parties will edit in Phase 5 (narrow-grant to participants comes then,
-- see the RLS section below); it means nothing more than "whatever the two
-- of them wrote down".
--
-- Design notes:
--   * tutor_id <> tutee_id is a plain CHECK constraint (no trigger needed
--     -- unlike is_admin self-escalation, this predicate only ever looks at
--     the row being written, so a CHECK is sufficient and cheaper).
--   * At most one ACTIVE pairing per (tutor_id, tutee_id, subject_id) is a
--     PARTIAL unique index (`where status = 'active'`), not a plain unique
--     constraint -- an ended pairing must never block re-pairing the same
--     two people later, so the uniqueness only applies while status is
--     'active'.
--   * Capacity (tutor_subjects.max_tutees) is enforced by a BEFORE
--     INSERT/UPDATE trigger that COUNTs existing active pairings, not by
--     application code -- two admins racing to pair the same tutor's last
--     open slot would both pass a client-side or even a single-statement
--     check; the trigger re-counts inside the same transaction as the
--     write it's guarding. The same trigger rejects pairing a tutor for a
--     subject they have no tutor_subjects row for at all (max_tutees
--     wouldn't even exist to check against).
--   * Keeping tutee_requests.status in sync with the pairings that
--     reference it (pending -> matched on create, matched -> pending when
--     the last active pairing for that request goes away) is a trigger,
--     not application code, for the same reason as everywhere else in this
--     project: a trigger cannot be forgotten by a future code path, a
--     server action easily could be. The trigger also handles DELETE (RLS
--     grants admins DELETE on pairings even though the Phase 4 UI only
--     ever "ends" one) so the request is released back to the queue no
--     matter how the active pairing referencing it goes away.
--   * request_id is nullable and ON DELETE SET NULL -- an admin may create
--     a pairing with no originating request at all, and a deleted request
--     must not take a historical pairing down with it.

-- ---------------------------------------------------------------------------
-- pairings
-- ---------------------------------------------------------------------------

create table public.pairings (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  tutee_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  request_id uuid references public.tutee_requests (id) on delete set null,
  -- Free text, edited by both parties in Phase 5. Not a schedule.
  meeting_time text,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  constraint pairings_tutor_ne_tutee check (tutor_id <> tutee_id)
);

comment on table public.pairings is
  'One tutor paired with one tutee for one subject. Not a booking system -- meeting_time is free text the two parties agree on themselves, not a schedule the app manages. See the migration header for the capacity/uniqueness/request-sync design notes.';
comment on constraint pairings_tutor_ne_tutee on public.pairings is
  'A profile cannot be paired with itself as both tutor and tutee.';
comment on column public.pairings.request_id is
  'The tutee_requests row this pairing originated from, if any -- nullable because an admin may create a pairing with no originating request. ON DELETE SET NULL so deleting a request never takes a historical pairing down with it.';
comment on column public.pairings.meeting_time is
  'Free text, e.g. "Tuesdays after school in the library". Phase 5 will let both participants edit this; for now only admins can (see RLS below).';

create index pairings_tutor_id_idx on public.pairings (tutor_id);
create index pairings_tutee_id_idx on public.pairings (tutee_id);
create index pairings_subject_id_idx on public.pairings (subject_id);
create index pairings_request_id_idx on public.pairings (request_id);
-- Backs the capacity trigger's per-(tutor, subject) active count.
create index pairings_tutor_subject_active_idx
  on public.pairings (tutor_id, subject_id)
  where status = 'active';

-- Constraint #2: at most one ACTIVE pairing per (tutor, tutee, subject).
-- Partial on status = 'active' so an ended pairing never blocks re-pairing
-- the same two people later.
create unique index pairings_unique_active_tutor_tutee_subject
  on public.pairings (tutor_id, tutee_id, subject_id)
  where status = 'active';

alter table public.pairings enable row level security;

revoke all on public.pairings from anon, authenticated;
grant select, insert, update, delete on public.pairings to authenticated;

create policy "pairings_select"
  on public.pairings
  for select
  to authenticated
  using (
    (select auth.uid()) = tutor_id
    or (select auth.uid()) = tutee_id
    or public.is_admin()
  );

-- Students may NOT insert or delete pairings -- only admins assign.
create policy "pairings_insert_admin"
  on public.pairings
  for insert
  to authenticated
  with check (public.is_admin());

-- Every update (status changes, ending, meeting_time, everything) is
-- admin-only for now. Phase 5 will add a SEPARATE, narrower policy that
-- lets the tutor/tutee participants update just meeting_time on their own
-- pairing -- that is deliberately not built here.
create policy "pairings_update_admin"
  on public.pairings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "pairings_delete_admin"
  on public.pairings
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists pairings_before_update on public.pairings;
create trigger pairings_before_update
  before update on public.pairings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Capacity + "tutor actually offers this subject" guard (constraint #3)
-- ---------------------------------------------------------------------------

create function public.pairings_check_capacity()
returns trigger
language plpgsql
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
  'BEFORE INSERT/UPDATE guard: rejects pairing a tutor for a subject they have no tutor_subjects row for, and rejects exceeding tutor_subjects.max_tutees active pairings for that subject. Re-counts inside the same transaction as the write it guards, so two concurrent admins cannot both fill a tutor''s last open slot. Trigger-only -- revoked from every role below.';

revoke execute on function public.pairings_check_capacity() from public, anon, authenticated;

drop trigger if exists pairings_before_insert_update_capacity on public.pairings;
create trigger pairings_before_insert_update_capacity
  before insert or update on public.pairings
  for each row execute function public.pairings_check_capacity();

-- ---------------------------------------------------------------------------
-- Keep tutee_requests.status in sync with active pairings (constraint #4)
-- ---------------------------------------------------------------------------

create function public.pairings_sync_request_status()
returns trigger
language plpgsql
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
  'AFTER INSERT/UPDATE/DELETE: claims a request (pending -> matched) when an active pairing starts referencing it, and releases it (matched -> pending) when the last active pairing referencing it goes away, however that happens (ended, reassigned, or deleted). Trigger-only -- revoked from every role below.';

revoke execute on function public.pairings_sync_request_status() from public, anon, authenticated;

drop trigger if exists pairings_after_write_sync_request on public.pairings;
create trigger pairings_after_write_sync_request
  after insert or update or delete on public.pairings
  for each row execute function public.pairings_sync_request_status();
