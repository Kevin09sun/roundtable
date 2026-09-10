-- Phase 3 (Part A): intake schema -- subjects, what a tutor offers, and
-- requests for help. Pairings/matching/session logging are Phase 4/5 and
-- deliberately not touched here.
--
-- Design notes:
--   * subjects is a small admin-managed reference list. Any authenticated
--     user may read the ACTIVE subjects (they need this to populate the
--     "pick a subject" selects on /tutor and /request-help); only admins
--     may create/rename/deactivate one. Deletion is technically allowed for
--     admins, but on delete restrict on every referencing FK means a
--     subject that's actually in use can never be deleted out from under
--     existing tutor_subjects/tutee_requests rows -- the intended way to
--     retire a subject is is_active = false, not delete.
--   * tutor_subjects rows are owned by the tutor who created them
--     (tutor_id = auth.uid()). Both USING and WITH CHECK repeat that
--     predicate on every policy so a student can neither see nor write a
--     row with someone else's tutor_id -- WITH CHECK is what actually stops
--     the insert-with-someone-else's-id attack; USING alone would only
--     filter results, not reject writes.
--   * tutee_requests supports two very different intake paths in one table
--     (self-serve student request vs. unauthenticated teacher referral,
--     see Part B), distinguished by `source` and enforced by CHECK
--     constraints rather than application code, because CHECK constraints
--     hold even if a future code path forgets to validate. RLS then only
--     ever lets a student INSERT the 'self' shape for their own id --
--     'teacher' rows are created exclusively by the SECURITY DEFINER
--     function in the next migration, which (being SECURITY DEFINER, owned
--     by the table owner) bypasses RLS entirely rather than needing a
--     policy carve-out.
--   * tutee_request_notes is a SEPARATE table from tutee_requests on
--     purpose -- see the big comment on that table below before you
--     "simplify" this by folding note back into a column.

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.subjects is
  'Admin-managed reference list of tutoring subjects. Prefer is_active = false over deleting a subject that is (or was) referenced.';

alter table public.subjects enable row level security;

revoke all on public.subjects from anon, authenticated;
grant select, insert, update, delete on public.subjects to authenticated;

create policy "subjects_select"
  on public.subjects
  for select
  to authenticated
  using (
    is_active
    or public.is_admin()
  );

create policy "subjects_insert_admin"
  on public.subjects
  for insert
  to authenticated
  with check (public.is_admin());

create policy "subjects_update_admin"
  on public.subjects
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "subjects_delete_admin"
  on public.subjects
  for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger (tutor_subjects, tutee_requests below)
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now(). Trigger-only -- revoked from every role below so it cannot be called directly.';

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- tutor_subjects -- what a tutor offers
-- ---------------------------------------------------------------------------

create table public.tutor_subjects (
  tutor_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  max_tutees integer not null default 2 check (max_tutees between 1 and 10),
  availability_note text check (availability_note is null or length(availability_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tutor_id, subject_id)
);

comment on table public.tutor_subjects is
  'What a tutor offers to teach, and how many tutees they can take on per subject. One row per (tutor, subject).';

create index tutor_subjects_subject_id_idx on public.tutor_subjects (subject_id);

alter table public.tutor_subjects enable row level security;

revoke all on public.tutor_subjects from anon, authenticated;
grant select, insert, update, delete on public.tutor_subjects to authenticated;

create policy "tutor_subjects_select"
  on public.tutor_subjects
  for select
  to authenticated
  using (
    (select auth.uid()) = tutor_id
    or public.is_admin()
  );

create policy "tutor_subjects_insert"
  on public.tutor_subjects
  for insert
  to authenticated
  with check (
    (select auth.uid()) = tutor_id
    or public.is_admin()
  );

create policy "tutor_subjects_update"
  on public.tutor_subjects
  for update
  to authenticated
  using (
    (select auth.uid()) = tutor_id
    or public.is_admin()
  )
  with check (
    (select auth.uid()) = tutor_id
    or public.is_admin()
  );

create policy "tutor_subjects_delete"
  on public.tutor_subjects
  for delete
  to authenticated
  using (
    (select auth.uid()) = tutor_id
    or public.is_admin()
  );

drop trigger if exists tutor_subjects_before_update on public.tutor_subjects;
create trigger tutor_subjects_before_update
  before update on public.tutor_subjects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tutee_requests -- a request for help in one subject
-- ---------------------------------------------------------------------------

create table public.tutee_requests (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  -- Nullable: a teacher referral may name a student with no account yet.
  student_id uuid references public.profiles (id) on delete cascade,
  -- The name as the teacher typed it. Only meaningful (and only ever set)
  -- for a teacher referral, and only until an admin links the request to a
  -- real profile.
  student_name_raw text check (student_name_raw is null or length(trim(student_name_raw)) > 0),
  source text not null check (source in ('self', 'teacher')),
  -- Referrer fields: set only for teacher referrals, server-side (Part B).
  referred_by_name text check (referred_by_name is null or length(trim(referred_by_name)) > 0),
  referred_by_email text check (referred_by_email is null or length(trim(referred_by_email)) > 0),
  status text not null default 'pending' check (status in ('pending', 'matched', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tutee_requests_self_shape check (
    source <> 'self'
    or (
      student_id is not null
      and student_name_raw is null
      and referred_by_name is null
      and referred_by_email is null
    )
  ),
  constraint tutee_requests_teacher_shape check (
    source <> 'teacher'
    or (
      referred_by_name is not null
      and referred_by_email is not null
      and (student_id is not null or student_name_raw is not null)
    )
  )
);

comment on table public.tutee_requests is
  'A request for tutoring help in one subject, either self-filed by the student or filed by a teacher referral (see submit_teacher_referral). No note/reason text lives here -- see tutee_request_notes.';
comment on constraint tutee_requests_self_shape on public.tutee_requests is
  'A self-filed request must name the requesting student and carry no referrer fields.';
comment on constraint tutee_requests_teacher_shape on public.tutee_requests is
  'A teacher referral must carry both referrer fields and at least one way to identify the student (an existing profile, a typed name, or both).';

create index tutee_requests_subject_id_idx on public.tutee_requests (subject_id);
create index tutee_requests_student_id_idx on public.tutee_requests (student_id);
-- Backs the abuse-throttle lookups in submit_teacher_referral (Part B).
create index tutee_requests_source_created_at_idx on public.tutee_requests (source, created_at);
create index tutee_requests_referred_by_email_idx
  on public.tutee_requests (lower(referred_by_email))
  where source = 'teacher';

alter table public.tutee_requests enable row level security;

revoke all on public.tutee_requests from anon, authenticated;
grant select, insert, update, delete on public.tutee_requests to authenticated;

create policy "tutee_requests_select"
  on public.tutee_requests
  for select
  to authenticated
  using (
    (select auth.uid()) = student_id
    or public.is_admin()
  );

-- A student may only ever insert the 'self' shape, for themselves. Every
-- 'teacher' row is inserted by submit_teacher_referral (SECURITY DEFINER,
-- bypasses RLS) -- there is deliberately no policy branch here that lets an
-- authenticated user insert source = 'teacher' directly.
create policy "tutee_requests_insert"
  on public.tutee_requests
  for insert
  to authenticated
  with check (
    (
      source = 'self'
      and student_id = (select auth.uid())
    )
    or public.is_admin()
  );

create policy "tutee_requests_update_admin"
  on public.tutee_requests
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tutee_requests_delete_admin"
  on public.tutee_requests
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists tutee_requests_before_update on public.tutee_requests;
create trigger tutee_requests_before_update
  before update on public.tutee_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tutee_request_notes -- the teacher's written reason, admins ONLY
-- ---------------------------------------------------------------------------
--
-- This is a SEPARATE table from tutee_requests, and that separation is the
-- point, not an accident: RLS is enforced per ROW, not per column, so a
-- `note` column living on tutee_requests would be readable by the very
-- student the row is about, via the tutee_requests_select policy above (it
-- lets a student read their OWN row). A teacher writing something like
-- "struggling badly in math, possible learning disability" about a named
-- minor must never be exposed to that student through the API. Keeping the
-- note in its own table with its own admins-only-for-everything policy is
-- what makes that guarantee possible. Do not merge this back into
-- tutee_requests.

create table public.tutee_request_notes (
  request_id uuid primary key references public.tutee_requests (id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.tutee_request_notes is
  'The teacher''s written reason for a referral. Admin-only RLS for every operation -- see the header comment above this table. No student, including the one the request is about, may read a row here.';

alter table public.tutee_request_notes enable row level security;

revoke all on public.tutee_request_notes from anon, authenticated;
grant select, insert, update, delete on public.tutee_request_notes to authenticated;

create policy "tutee_request_notes_admin_all"
  on public.tutee_request_notes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
