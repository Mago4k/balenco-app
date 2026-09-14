-- Rollback for 0043_realtime_publication_tables (returns live sync to its
-- pre-fix dead state; the app still works, data refreshes on reload only).
alter publication supabase_realtime drop table
  public.clients,
  public.leads,
  public.estimates,
  public.appointments,
  public.photos,
  public.jobs,
  public.logs;
