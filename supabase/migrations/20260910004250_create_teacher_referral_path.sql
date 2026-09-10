-- Phase 3 (Part B): the unauthenticated teacher referral path.
--
-- Teachers do not get accounts in v1 -- /refer is a public form served to
-- the `anon` role. Security design:
--
--   * `anon` gets NO table privileges on tutee_requests, tutee_request_notes,
--     subjects, or app_config -- there is no "anyone can insert" policy
--     anywhere in this migration. The only thing `anon` can do is EXECUTE
--     one narrow SECURITY DEFINER function.
--   * submit_teacher_referral validates a shared secret INSIDE the
--     database (against a hash stored in app_config, never a hardcoded
--     literal) before it does anything else, then inserts into
--     tutee_requests + tutee_request_notes. Being SECURITY DEFINER and
--     owned by the table owner, it bypasses RLS on both tables entirely --
--     that's what lets an `anon` caller with zero table grants still end
--     up with two rows inserted.
--   * The secret is stored HASHED (pgcrypto bcrypt), not in plaintext, so
--     reading app_config (which nothing but an admin can do anyway) still
--     doesn't disclose the secret.
--   * The Next.js Server Action in front of this RPC does its OWN
--     independent check of the same secret against a server-only env var
--     before ever calling this function -- defense in depth, two
--     independent checks, neither one sufficient on its own by design.
--   * A simple abuse throttle (per-email and global, both per rolling
--     hour) is enforced here, not in application code, so it can't be
--     bypassed by calling the RPC directly.

-- ---------------------------------------------------------------------------
-- app_config -- single-row table, admin-only RLS
-- ---------------------------------------------------------------------------

create table public.app_config (
  -- `id boolean primary key default true check (id)` is a standard
  -- single-row-table trick: the only value id can ever hold is `true`, so
  -- the primary key constraint makes a second row impossible.
  id boolean primary key default true check (id),
  teacher_referral_secret_hash text,
  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'Single-row table (id is always true) holding sensitive app-wide config -- currently just the hashed /refer shared secret. Admin-only RLS; submit_teacher_referral reads it via a SECURITY DEFINER function rather than a direct grant to anon/authenticated.';
comment on column public.app_config.teacher_referral_secret_hash is
  'pgcrypto bcrypt hash (extensions.crypt(secret, extensions.gen_salt(''bf''))) of the /refer form''s shared access secret. The plaintext is never stored here or anywhere else in the database. NULL until seeded -- submit_teacher_referral treats a NULL hash the same as a wrong secret (rejects with the same generic error), so the referral path fails closed if the row hasn''t been seeded yet.';

alter table public.app_config enable row level security;

revoke all on public.app_config from anon, authenticated;
grant select, update on public.app_config to authenticated;

create policy "app_config_admin_all"
  on public.app_config
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop trigger if exists app_config_before_update on public.app_config;
create trigger app_config_before_update
  before update on public.app_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- submit_teacher_referral -- the one thing `anon` is allowed to do
-- ---------------------------------------------------------------------------

create function public.submit_teacher_referral(
  p_form_secret text,
  p_teacher_name text,
  p_teacher_email text,
  p_student_name text,
  p_subject_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_hash text;
  v_request_id uuid;
  v_recent_by_email integer;
  v_recent_total integer;
begin
  -- Secret check FIRST, before touching any other table, and with exactly
  -- ONE generic error message regardless of *why* it failed (no config row
  -- yet, null secret, or a genuinely wrong secret) -- the caller must not
  -- be able to use the error to distinguish "app not configured" from
  -- "you typed the wrong code".
  select teacher_referral_secret_hash into v_secret_hash
  from public.app_config
  where id = true;

  if v_secret_hash is null
     or p_form_secret is null
     or extensions.crypt(p_form_secret, v_secret_hash) <> v_secret_hash then
    raise exception 'Invalid access code.';
  end if;

  if p_teacher_name is null or length(trim(p_teacher_name)) = 0 then
    raise exception 'Teacher name is required.';
  end if;
  if p_teacher_email is null or length(trim(p_teacher_email)) = 0 then
    raise exception 'Teacher email is required.';
  end if;
  if p_student_name is null or length(trim(p_student_name)) = 0 then
    raise exception 'Student name is required.';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'A short reason is required.';
  end if;
  if not exists (
    select 1 from public.subjects s where s.id = p_subject_id and s.is_active
  ) then
    raise exception 'Selected subject is not available.';
  end if;

  -- Abuse throttle, checked AFTER the secret (so a wrong secret never
  -- reveals anything about current throttle state) and BEFORE any insert.
  -- Both limits are "at most N per rolling hour", i.e. reject the attempt
  -- that would make count N+1.
  select count(*) into v_recent_by_email
  from public.tutee_requests
  where source = 'teacher'
    and lower(referred_by_email) = lower(p_teacher_email)
    and created_at > now() - interval '1 hour';

  if v_recent_by_email >= 5 then
    raise exception 'Too many referrals submitted from this email recently. Please try again later.';
  end if;

  select count(*) into v_recent_total
  from public.tutee_requests
  where source = 'teacher'
    and created_at > now() - interval '1 hour';

  if v_recent_total >= 50 then
    raise exception 'Too many referrals submitted recently. Please try again later.';
  end if;

  insert into public.tutee_requests (
    subject_id, student_id, student_name_raw, source,
    referred_by_name, referred_by_email, status
  ) values (
    p_subject_id, null, trim(p_student_name), 'teacher',
    trim(p_teacher_name), trim(p_teacher_email), 'pending'
  )
  returning id into v_request_id;

  insert into public.tutee_request_notes (request_id, note)
  values (v_request_id, trim(p_note));

  return v_request_id;
end;
$$;

comment on function public.submit_teacher_referral(text, text, text, text, uuid, text) is
  'The ONLY way a teacher referral (source = ''teacher'') can be created. SECURITY DEFINER so it can insert into tutee_requests + tutee_request_notes despite anon holding zero table privileges on either. Validates the shared secret against app_config, applies a per-email and global abuse throttle, then inserts both rows in one transaction (the function call itself is the transaction boundary).';

revoke execute on function public.submit_teacher_referral(text, text, text, text, uuid, text)
  from public, authenticated;
grant execute on function public.submit_teacher_referral(text, text, text, text, uuid, text) to anon;
