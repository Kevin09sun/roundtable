-- Phase 6 (Part A): issues -- the "report a problem" queue for a pairing.
-- A participant who has something wrong to report (a no-show, a scheduling
-- conflict, a personality mismatch, anything else) files an issue here
-- instead of the app trying to automate resolution itself; an admin then
-- works it from /admin/issues. This is deliberately a queue, not a chat --
-- there is no back-and-forth thread, just a filed report and an eventual
-- resolution note.
--
-- Design notes:
--   * pairing_id is NOT NULL and ON DELETE CASCADE, same reasoning as
--     sessions.pairing_id (see 20260912090000_create_sessions_schema.sql):
--     an issue cannot exist independent of the pairing it was raised
--     against, and only an actual DELETE of the pairing (admin-only, RLS)
--     should ever take its issues with it.
--   * raised_by is NOT NULL and, per RLS below, always the writer's own id
--     -- nobody files an issue as someone else, including an admin filing
--     on a participant's behalf (there is no admin branch on INSERT).
--   * status/resolution/resolved_by/resolved_at are the admin-owned
--     lifecycle: 'open' -> optionally 'in_progress' -> 'resolved'.
--     issues_resolution_shape enforces that a 'resolved' row always carries
--     a resolution and a resolver, in the database, so a future code path
--     can never mark something resolved without actually recording who
--     resolved it or why (same philosophy as tutee_requests_self_shape /
--     _teacher_shape in the Phase 3 migration -- CHECK constraints hold
--     even if application code forgets to validate).
--
--   * THE PRIVACY DECISION (read this before touching issues_select):
--     SELECT is `raised_by = auth.uid() OR is_admin()` -- deliberately NOT
--     the other participant of the pairing. A tutee who reports "my tutor
--     never shows up" must not have that report readable by the tutor it's
--     about, any more than a teacher's referral note about a student
--     (tutee_request_notes, see 20260910004125_create_intake_schema.sql) is
--     readable by that student. RLS is enforced per ROW, not per column or
--     per "the other side of this relationship" -- there is no policy shape
--     that grants read access to "everyone in this pairing" while also
--     hiding it from the specific person the row is about, because for a
--     self-filed issue those are the same predicate. The only way to give
--     the raiser (and only the raiser, plus admins) read access is to key
--     SELECT off raised_by, not off pairing participation -- exactly the
--     same reason tutee_request_notes is its own admin-only table rather
--     than a column on tutee_requests. Do not "fix" this by adding an
--     is_pairing_participant() branch to issues_select; that would leak
--     every report straight back to the person it's filed about.

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references public.pairings (id) on delete cascade,
  raised_by uuid not null references public.profiles (id),
  category text not null check (category in ('scheduling', 'no_show', 'mismatch', 'other')),
  description text not null check (length(trim(description)) > 0 and length(description) <= 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  resolution text check (resolution is null or (length(trim(resolution)) > 0 and length(resolution) <= 2000)),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issues_resolution_shape check (
    status <> 'resolved'
    or (resolution is not null and resolved_by is not null and resolved_at is not null)
  )
);

comment on table public.issues is
  'A problem reported against a pairing by one of its participants. SELECT is raised_by-or-admin only -- see the migration header before changing issues_select.';
comment on column public.issues.raised_by is
  'The profile who filed this report -- always the writer''s own id (RLS: no admin-on-behalf-of INSERT branch).';
comment on column public.issues.status is
  'open = filed, not yet looked at; in_progress = an admin is on it; resolved = closed out, with a resolution note.';
comment on constraint issues_resolution_shape on public.issues is
  'A resolved issue must carry a resolution and a resolver -- see resolveIssue in src/lib/actions/issue.ts, the only code path that sets status = ''resolved''.';

-- Backs "this raiser's own issues on this pairing", newest first -- the
-- query /pairings/[id] runs (issues_select already restricts it to the
-- caller's own rows, or every row for an admin).
create index issues_pairing_id_created_at_idx
  on public.issues (pairing_id, created_at desc);
-- Backs the admin queue's "open issues first" ordering -- partial so it
-- only ever indexes the rows the queue actually leads with, and stays
-- small as issues get resolved.
create index issues_open_created_at_idx
  on public.issues (created_at)
  where status = 'open';

alter table public.issues enable row level security;

revoke all on public.issues from anon, authenticated;
grant select, insert, update, delete on public.issues to authenticated;

drop trigger if exists issues_before_update on public.issues;
create trigger issues_before_update
  before update on public.issues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- SELECT: the raiser, or an admin. See the migration header -- this is NOT
-- "either participant of the pairing", on purpose.
create policy "issues_select"
  on public.issues
  for select
  to authenticated
  using (
    raised_by = (select auth.uid())
    or public.is_admin()
  );

-- INSERT: a participant of the pairing (public.is_pairing_participant,
-- defined in the Phase 5 sessions migration), filing as themselves.
create policy "issues_insert"
  on public.issues
  for insert
  to authenticated
  with check (
    raised_by = (select auth.uid())
    and public.is_pairing_participant(pairing_id)
  );

-- UPDATE: admin only. Participants do not edit an issue after filing --
-- there is no participant branch here at all, unlike sessions_update.
create policy "issues_update_admin"
  on public.issues
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: admin only.
create policy "issues_delete_admin"
  on public.issues
  for delete
  to authenticated
  using (public.is_admin());
