-- Phase 5 (Part A): sessions -- the attendance/hours record logged against
-- an active pairing. A "schedule" in this app is not a calendar; it is a
-- person's list of active pairings plus the sessions logged against them
-- (see supabase/migrations/20260910120000_create_pairings_schema.sql for
-- why pairings itself carries no scheduling data). This table is what makes
-- "did the tutoring actually happen, and for how long" answerable.
--
-- Design notes:
--   * pairing_id is NOT NULL and ON DELETE CASCADE -- a session cannot
--     exist independent of the pairing it was logged against, and if a
--     pairing row is ever hard-deleted (admin-only, RLS) its session
--     history goes with it. Ending a pairing (status = 'ended') never
--     deletes the row, so ordinary "the tutoring relationship is over"
--     history is preserved; only an actual DELETE of the pairing cascades.
--   * occurred_on cannot be in the future -- a session cannot have happened
--     tomorrow. Enforced with a plain CHECK against current_date; this only
--     needs to hold at write time (a row logged as "today" does not need to
--     keep re-validating as false once tomorrow arrives), which is exactly
--     what a CHECK constraint gives you.
--   * minutes is capped at 300 (5 hours). Peer tutoring sessions in this
--     app are informal, arranged directly between two students -- nothing
--     here is a multi-day retreat -- so a positive, generous ceiling well
--     above any realistic single session both catches obvious data-entry
--     errors (a stray extra digit, e.g. 6000 instead of 60) and leaves
--     plenty of headroom for a long study session without ever needing to
--     special-case a legitimate value.
--   * status has no 'active'/'pending' state the way pairings.status does --
--     a session is a record of something that already happened (or didn't:
--     'no_show') or didn't count ('cancelled'), logged after the fact.
--   * logged_by is who actually submitted the record, independent of
--     whether they're the tutor or tutee on the pairing -- RLS requires it
--     to equal the writer's own auth.uid() (see below), so it always
--     answers "who logged this" truthfully.
--   * Every function here that makes an authorization decision by reading
--     pairings (a table other than the one being written) is SECURITY
--     DEFINER with an explicit search_path, for the same reason
--     pairings_check_capacity and pairings_sync_request_status are (see
--     20260911140000_harden_pairing_trigger_functions.sql) -- an invoker
--     whose own RLS on pairings happens to hide the very row the decision
--     depends on must not silently produce the wrong answer.

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references public.pairings (id) on delete cascade,
  occurred_on date not null check (occurred_on <= current_date),
  minutes integer not null check (minutes > 0 and minutes <= 300),
  status text not null check (status in ('completed', 'no_show', 'cancelled')),
  notes text check (notes is null or length(notes) <= 2000),
  logged_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sessions is
  'One logged tutoring session against a pairing -- the attendance/hours record. Not a booking: logged after the fact by a participant or an admin. See the migration header for the minutes/occurred_on/status design notes.';
comment on column public.sessions.occurred_on is
  'The date the session happened. Cannot be in the future -- a session cannot have happened tomorrow.';
comment on column public.sessions.minutes is
  'Session length in minutes. Capped at 300 (5 hours) -- generous for a real peer-tutoring session, tight enough to catch obvious data-entry errors.';
comment on column public.sessions.status is
  'completed = the session happened as planned (counts toward volunteer hours); no_show = one party did not show; cancelled = called off before it happened.';
comment on column public.sessions.logged_by is
  'The profile who submitted this record -- not necessarily the tutor. RLS requires this to equal the writer''s own auth.uid() on INSERT/UPDATE; nobody logs a session as someone else.';

-- Backs "session history for this pairing", ordered newest-first -- the
-- query the pairing detail page and dashboard actually run.
create index sessions_pairing_id_occurred_on_idx
  on public.sessions (pairing_id, occurred_on desc);
-- Backs the volunteer-hours rollup (sum of minutes on 'completed' sessions,
-- joined through pairings by tutor_id) -- partial so it only ever indexes
-- the rows that rollup actually sums, and stays small as no_show/cancelled
-- rows accumulate.
create index sessions_completed_pairing_id_idx
  on public.sessions (pairing_id)
  where status = 'completed';

alter table public.sessions enable row level security;

revoke all on public.sessions from anon, authenticated;
grant select, insert, update, delete on public.sessions to authenticated;

drop trigger if exists sessions_before_update on public.sessions;
create trigger sessions_before_update
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Participant check (SECURITY DEFINER, mirrors public.is_admin())
-- ---------------------------------------------------------------------------

create function public.is_pairing_participant(target_pairing_id uuid, require_non_ended boolean default false)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.pairings p
    where p.id = target_pairing_id
      and (p.tutor_id = auth.uid() or p.tutee_id = auth.uid())
      and (not require_non_ended or p.status <> 'ended')
  );
$$;

comment on function public.is_pairing_participant(uuid, boolean) is
  'SECURITY DEFINER so the internal SELECT on pairings sees the real row regardless of the caller''s own RLS (same reasoning as pairings_check_capacity, see 20260911140000_harden_pairing_trigger_functions.sql), instead of a caller who cannot see a pairing under RLS deciding by coincidence rather than by rule. require_non_ended additionally requires the pairing not be ended -- used to gate session INSERT to non-ended pairings for non-admins.';

revoke execute on function public.is_pairing_participant(uuid, boolean) from public, anon;
grant execute on function public.is_pairing_participant(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- SELECT: the pairing's tutor or tutee (at any time in that pairing's
-- history, even after it ended -- session history should not disappear
-- just because the pairing later ended), or an admin.
create policy "sessions_select"
  on public.sessions
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_pairing_participant(pairing_id)
  );

-- INSERT: logged_by must be the writer's own id, full stop -- nobody logs a
-- session as someone else, including an admin logging on a participant's
-- behalf. Beyond that: a participant may only log against a pairing they're
-- part of that hasn't ended; an admin may log against any pairing.
create policy "sessions_insert"
  on public.sessions
  for insert
  to authenticated
  with check (
    logged_by = (select auth.uid())
    and (
      public.is_admin()
      or public.is_pairing_participant(pairing_id, true)
    )
  );

-- UPDATE: whoever logged it, or an admin. No column-level restriction here
-- (unlike pairings.meeting_time) -- the only thing that changes hands is
-- who's allowed to touch the row at all, and WITH CHECK's `logged_by =
-- auth.uid()` branch already stops a non-admin editor from reassigning
-- logged_by to someone else.
create policy "sessions_update"
  on public.sessions
  for update
  to authenticated
  using (
    logged_by = (select auth.uid())
    or public.is_admin()
  )
  with check (
    logged_by = (select auth.uid())
    or public.is_admin()
  );

-- DELETE: admin only. Sessions are the attendance and hours record --
-- letting a participant delete one would let them quietly erase it.
create policy "sessions_delete_admin"
  on public.sessions
  for delete
  to authenticated
  using (public.is_admin());
