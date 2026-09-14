-- ============================================================
-- ROLLBACK for migration 2 — restores the previous (wide-open) policies.
-- Run only if tenant isolation needs to be reverted.
-- ============================================================

drop policy if exists "org_members_all" on public.clients;
drop policy if exists "org_members_all" on public.leads;
drop policy if exists "org_members_all" on public.estimates;
drop policy if exists "org_members_all" on public.appointments;
drop policy if exists "org_members_all" on public.photos;
drop policy if exists "org_members_all" on public.logs;
drop policy if exists "org_members_all" on public.settings;

drop policy if exists "anon_can_read_clients"      on public.clients;
drop policy if exists "anon_can_read_estimates"    on public.estimates;
drop policy if exists "anon_can_approve_estimates" on public.estimates;
drop policy if exists "anon_can_read_settings"     on public.settings;

-- restore wide-open authenticated access
create policy "auth_all" on public.clients      for all to authenticated using (true) with check (true);
create policy "auth_all" on public.leads        for all to authenticated using (true) with check (true);
create policy "auth_all" on public.estimates    for all to authenticated using (true) with check (true);
create policy "auth_all" on public.appointments for all to authenticated using (true) with check (true);
create policy "auth_all" on public.photos       for all to authenticated using (true) with check (true);
create policy "auth_all" on public.logs         for all to authenticated using (true) with check (true);
create policy "auth_all" on public.settings     for all to authenticated using (true) with check (true);

-- restore public portal reads/approve
create policy "Public can read clients"      on public.clients   for select to public using (true);
create policy "Public can read estimates"    on public.estimates for select to public using (true);
create policy "Public can approve estimates" on public.estimates for update to public
  using (status <> 'Accepted') with check (status = 'Accepted');
create policy "Public can read settings"     on public.settings  for select to public using (true);

drop function if exists public.current_org_id();
