-- Rollback for migration 5 — restores anonymous portal read/approve access.
create policy "anon_can_read_clients"   on public.clients   for select to anon using (true);
create policy "anon_can_read_estimates" on public.estimates for select to anon using (true);
create policy "anon_can_approve_estimates" on public.estimates for update to anon
  using (status <> 'Accepted') with check (status = 'Accepted');
create policy "anon_can_read_settings"  on public.settings  for select to anon using (true);
