-- Rollback for migration 11: back to plain org-scoped (all members see all org data).
drop policy if exists "org_members_all" on public.clients;
create policy "org_members_all" on public.clients for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop policy if exists "org_members_all" on public.leads;
create policy "org_members_all" on public.leads for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop policy if exists "org_members_all" on public.estimates;
create policy "org_members_all" on public.estimates for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop policy if exists "org_members_all" on public.appointments;
create policy "org_members_all" on public.appointments for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop policy if exists "org_members_all" on public.photos;
create policy "org_members_all" on public.photos for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop policy if exists "org_members_all" on public.logs;
create policy "org_members_all" on public.logs for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

drop function if exists public.current_user_name();
