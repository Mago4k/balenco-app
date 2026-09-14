-- ============================================================
-- ROLLBACK for migration 3 — restores the previous profiles/push policies.
-- ============================================================

drop trigger   if exists trg_guard_profile_update on public.profiles;
drop function  if exists public.guard_profile_update();

drop policy if exists "profiles_read_self_or_org"   on public.profiles;
drop policy if exists "owners_update_org_profiles"  on public.profiles;
drop policy if exists "users_insert_own_profile"    on public.profiles;
drop policy if exists "push_subs_org"               on public.push_subscriptions;

-- restore originals
create policy "Authenticated users can read profiles" on public.profiles for select to public
  using (auth.role() = 'authenticated');
create policy "Owners can update any profile" on public.profiles for update to public
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
create policy "Users can insert own profile" on public.profiles for insert to public
  with check (auth.uid() = id);
create policy "push subs for logged-in users" on public.push_subscriptions for all to authenticated
  using (true) with check (true);

drop function if exists public.current_user_role();
