-- Emailing feature (GitHub issue #1, part b): when an admin creates a
-- pairing, both the tutor and tutee get an email telling them who their
-- partner is and how to reach them. The Server Action that sends those
-- emails (src/lib/actions/pairing.ts, createPairing) needs the partner's
-- name AND email for both sides plus the subject name, in one round trip.
--
-- Why SECURITY DEFINER: emails live in auth.users, which `authenticated`
-- has no grants on at all (Supabase's default, and correctly so -- nothing
-- about ordinary app usage should let a client read another user's auth
-- record). This function is the one narrow, admin-only exception: it joins
-- pairings -> profiles (twice, tutor + tutee) -> auth.users (for the
-- emails) -> subjects, running as the function owner so the auth.users
-- read succeeds despite the caller having no table privileges there.
--
-- Why admin-only: it is only ever called right after createPairing's own
-- insert, by the same admin who just created the pairing -- there is no
-- legitimate reason for a non-admin (including the tutor/tutee themselves)
-- to call this directly, and doing so would let any authenticated user
-- harvest another user's email address by supplying an arbitrary pairing
-- id. Guarded the same way as every other admin-only RPC in this project:
-- `raise exception` with errcode 42501 (insufficient_privilege) unless
-- public.is_admin() -- see submit_teacher_referral's secret check in
-- 20260910004250_create_teacher_referral_path.sql for the same
-- fail-closed-with-one-check pattern.

create function public.pairing_notification_details(p_pairing_id uuid)
returns table (
  tutor_name text,
  tutor_email text,
  tutee_name text,
  tutee_email text,
  subject_name text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin may look up pairing notification details.'
      using errcode = '42501';
  end if;

  return query
    select
      tutor.full_name,
      tutor_user.email::text,
      tutee.full_name,
      tutee_user.email::text,
      subj.name
    from public.pairings p
    join public.profiles tutor on tutor.id = p.tutor_id
    join auth.users tutor_user on tutor_user.id = p.tutor_id
    join public.profiles tutee on tutee.id = p.tutee_id
    join auth.users tutee_user on tutee_user.id = p.tutee_id
    join public.subjects subj on subj.id = p.subject_id
    where p.id = p_pairing_id;
end;
$$;

comment on function public.pairing_notification_details(uuid) is
  'Admin-only lookup of the tutor/tutee names, emails, and subject name for one pairing, used to send the "you''ve been paired" emails right after createPairing inserts. SECURITY DEFINER so it can read auth.users.email despite authenticated holding no grants there; raises 42501 unless public.is_admin(), since this is otherwise a way to harvest another user''s email address by pairing id.';

revoke all on function public.pairing_notification_details(uuid) from public, anon;
grant execute on function public.pairing_notification_details(uuid) to authenticated;
