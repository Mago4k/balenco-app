-- ============================================================
-- Balenco hardening — migration 3: scope profiles + push to org
--
-- Closes the remaining authenticated cross-org reads:
--   * profiles (team list / names / emails) were readable by ANY logged-in
--     user across all orgs.
--   * push_subscriptions were readable/writable by any logged-in user.
-- Also hardens profile self-edits so a user can't jump orgs or self-promote.
-- ============================================================

-- Recursion-safe helper: current user's role (definer rights, like current_org_id()).
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, anon;

-- ---- profiles: SELECT = own row or same-org team ----
drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "profiles_read_self_or_org" on public.profiles for select to authenticated
  using (id = auth.uid() or org_id = public.current_org_id());

-- ---- profiles: owners may update only profiles in THEIR org (was: any) ----
drop policy if exists "Owners can update any profile" on public.profiles;
create policy "owners_update_org_profiles" on public.profiles for update to authenticated
  using (org_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (org_id = public.current_org_id());

-- ---- profiles: self-insert must not pre-assign an org (no self-join an org) ----
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "users_insert_own_profile" on public.profiles for insert to authenticated
  with check (auth.uid() = id and org_id is null);

-- (kept: "Users can update own profile" USING auth.uid() = id)

-- ---- guard: a non-owner cannot change their own org_id or role ----
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---- push_subscriptions: scope to org (org_id is text here, so cast) ----
drop policy if exists "push subs for logged-in users" on public.push_subscriptions;
create policy "push_subs_org" on public.push_subscriptions for all to authenticated
  using (org_id = public.current_org_id()::text)
  with check (org_id = public.current_org_id()::text);
