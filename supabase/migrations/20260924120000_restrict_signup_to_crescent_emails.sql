-- Restrict new accounts to @crescentschool.org emails.
--
-- Design notes:
--   * signupSchema in src/lib/validations/auth.ts already rejects a
--     non-@crescentschool.org email client- and server-side, but that is
--     UX only -- it runs inside our own app code, and Supabase's own
--     auth.signUp() is a public API. Anyone who calls it directly (curl,
--     the Supabase JS client, a different frontend pointed at this
--     project) bypasses our zod schema entirely. This trigger is the real
--     boundary: it runs inside Postgres, in the same transaction as the
--     auth.users insert, regardless of which client submitted it.
--   * Only fires on INSERT, or on UPDATE when email is actually changing
--     (`new.email is distinct from old.email`). Existing rows -- including
--     any pre-existing test/admin accounts on other domains -- are
--     grandfathered: they are never re-validated just because some other
--     column on their row gets updated, and login for those accounts is
--     untouched (loginSchema/forgotPasswordSchema deliberately do not
--     apply this restriction -- see src/lib/validations/auth.ts).
--   * Any future demo/test/fixture account must use a real
--     @crescentschool.org address (or be inserted by a migration that
--     runs as a role this trigger doesn't block, which none of ours do --
--     there is no bypass built in on purpose).
--   * Plain SQL exception (errcode check_violation) raised from a BEFORE
--     trigger aborts the triggering statement, so a rejected signup never
--     reaches auth.users at all, same as a real CHECK constraint would if
--     Postgres allowed one directly on auth.users (it doesn't -- auth.users
--     is owned by the supabase_auth_admin role, not us, so a trigger is
--     the mechanism available here instead of a constraint).
--   * Not SECURITY DEFINER: the function only reads columns of the very
--     row already being written (new.email / old.email), so it doesn't
--     need to see anything beyond what the invoker already has -- unlike
--     the profiles/pairings triggers elsewhere in this migration set,
--     there's no other RLS-protected table involved that the invoker's
--     own privileges might hide.

create or replace function public.enforce_crescent_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.email is not distinct from old.email then
    return new;
  end if;

  if new.email is null
     or right(lower(trim(new.email)), length('@crescentschool.org')) <> '@crescentschool.org' then
    raise exception 'Only @crescentschool.org email addresses may be used.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_crescent_email() is
  'BEFORE INSERT OR UPDATE OF email guard on auth.users: rejects any new or changed email that does not end in @crescentschool.org. App-level validation (signupSchema in src/lib/validations/auth.ts) is UX only -- this trigger is the real boundary, since auth.signUp() can be called directly. Existing rows are grandfathered (only checked when email is being inserted or actually changing). Not SECURITY DEFINER -- only reads the row being written, no other table involved.';

drop trigger if exists enforce_crescent_email on auth.users;
create trigger enforce_crescent_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_crescent_email();

revoke all on function public.enforce_crescent_email() from public, anon, authenticated;
