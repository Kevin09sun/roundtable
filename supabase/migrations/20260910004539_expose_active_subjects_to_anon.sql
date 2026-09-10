-- Follow-up to create_intake_schema / create_teacher_referral_path: the
-- public /refer form needs a "pick a subject" select, but `anon` correctly
-- holds zero table privileges on public.subjects (see create_intake_schema).
-- Rather than granting anon a direct SELECT on subjects -- which would also
-- require a permissive RLS policy for anon and start eroding "anon gets NO
-- table privileges on any of these tables" -- expose the minimum possible
-- surface through a narrow, read-only SECURITY DEFINER function: just the
-- id/name of ACTIVE subjects, nothing else (not is_active, not
-- created_at, and never an inactive row).

create function public.list_active_subjects()
returns table (id uuid, name text)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, s.name
  from public.subjects s
  where s.is_active
  order by s.name;
$$;

comment on function public.list_active_subjects() is
  'Read-only list of active subjects (id, name only) for the public /refer form and any other unauthenticated subject picker. SECURITY DEFINER so it can read subjects despite anon holding zero table privileges on public.subjects.';

revoke execute on function public.list_active_subjects() from public;
grant execute on function public.list_active_subjects() to anon, authenticated;
