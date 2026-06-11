-- ============================================================
-- Balenco hardening — migration 5: close the anonymous read leak
--
-- The no-login portal + approval page now fetch through the portal-data /
-- approve-estimate edge functions (service role, scoped to a single record),
-- so the public tables no longer need anonymous "read everything" / "approve"
-- policies. After this, the publishable key can no longer dump clients,
-- estimates, or settings.
--
-- PREREQ: the portal-data-based frontend must already be DEPLOYED & LIVE,
-- otherwise the old frontend's portal breaks.
-- ============================================================

drop policy if exists "anon_can_read_clients"      on public.clients;
drop policy if exists "anon_can_read_estimates"    on public.estimates;
drop policy if exists "anon_can_approve_estimates" on public.estimates;
drop policy if exists "anon_can_read_settings"     on public.settings;
