-- 0043 — Add the app's 7 realtime tables to the supabase_realtime publication
-- (applied live 2026-08-17).
--
-- Root cause of a two-part production bug (Sentry 2026-08-17):
--   1. startRealtime crashed on re-login ("cannot add postgres_changes
--      callbacks ... after subscribe()") — fixed in index.html by tracking +
--      removing the old channel and using a unique topic per session.
--   2. Debugging (1) revealed the publication contained NO tables, so live
--      sync had been silently dead since launch: channels subscribed fine but
--      zero postgres_changes events were ever delivered.
--
-- Delivery remains RLS-filtered per subscriber (org-scoped; employees only
-- receive events for rows their SELECT policies allow).
alter publication supabase_realtime add table
  public.clients,
  public.leads,
  public.estimates,
  public.appointments,
  public.photos,
  public.jobs,
  public.logs;
