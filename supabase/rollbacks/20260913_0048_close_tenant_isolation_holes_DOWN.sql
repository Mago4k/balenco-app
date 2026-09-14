-- Rollback for 0048. Each section is independent — run only the part you need.
--
-- WARNING: sections 1 and 2 reopen real holes. Section 3 restores a default that
-- lets a new settings row collide with the platform owner's row.

-- 1. Re-grant anon read on availability (reopens tenant enumeration).
create policy avail_public_read on public.availability
  for select to anon using (true);

-- 2. Restore the name-writable guard (reopens the employee self-rename takeover).
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.org_id is distinct from old.org_id or new.role is distinct from old.role) then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'owner' and org_id = old.org_id
    ) then
      new.org_id := old.org_id;   -- silently revert escalation attempts
      new.role   := old.role;
    end if;
  end if;
  return new;
end
$function$;

-- 3. Restore the 'global' default.
--
-- The id repoint itself is NOT reverted automatically: which row was 'global' is
-- not recoverable from the schema, and re-pointing the wrong row back would
-- re-create the cross-tenant fallback. If you genuinely need it, set it by hand
-- for the one org you mean:
--     update public.settings set id = 'global' where org_id = '<uuid>';
-- and remember the four server-side fallbacks must be restored too, or nothing
-- will read it.
alter table public.settings alter column id set default 'global';
