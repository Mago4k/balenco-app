-- ============================================================
-- Balenco — migration 7: indexes for org-scoped queries + common lookups
-- Cheap and safe (IF NOT EXISTS, instant on small tables). Supports the
-- org_id filter every RLS policy now adds, plus the app's .eq() lookups.
-- ============================================================
create index if not exists idx_clients_org         on public.clients(org_id);
create index if not exists idx_clients_email        on public.clients(email);
create index if not exists idx_leads_org            on public.leads(org_id);
create index if not exists idx_estimates_org        on public.estimates(org_id);
create index if not exists idx_estimates_client     on public.estimates(client_id);
create index if not exists idx_appointments_org     on public.appointments(org_id);
create index if not exists idx_appointments_client  on public.appointments(client_id);
create index if not exists idx_appointments_start   on public.appointments(start_time);
create index if not exists idx_photos_org           on public.photos(org_id);
create index if not exists idx_photos_client        on public.photos(client_id);
create index if not exists idx_logs_org             on public.logs(org_id);
create index if not exists idx_profiles_org         on public.profiles(org_id);
create index if not exists idx_push_subs_org        on public.push_subscriptions(org_id);
