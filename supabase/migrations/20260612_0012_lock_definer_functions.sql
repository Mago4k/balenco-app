-- ============================================================
-- Balenco — migration 12: lock down SECURITY DEFINER functions.
-- Supabase's security advisor flags these as callable over the REST
-- API (/rest/v1/rpc/<fn>) by anon/authenticated.
--
--   * Trigger functions (handle_new_user, notify_new_booking,
--     guard_profile_update) need NO direct EXECUTE — the trigger
--     fires as the table owner, so revoking direct execute does not
--     affect the trigger. Revoke from everyone.
--   * RLS helpers (current_org_id / current_user_role /
--     current_user_name) MUST stay executable by `authenticated`,
--     or every RLS policy that calls them breaks. They only ever
--     return the CALLER'S OWN claims, so that is not a data leak.
--     anon never needs them, so drop anon + the PUBLIC default.
-- ============================================================

-- Trigger functions — no one should call these directly.
revoke execute on function public.handle_new_user()      from public, anon, authenticated;
revoke execute on function public.notify_new_booking()   from public, anon, authenticated;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;

-- RLS helpers — pin an explicit grant to authenticated FIRST so that
-- revoking the PUBLIC default doesn't also strip authenticated (which
-- inherits PUBLIC). Then drop the PUBLIC default; anon loses it too.
grant execute on function public.current_org_id()    to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_name() to authenticated;
revoke execute on function public.current_org_id()    from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.current_user_name() from public, anon;
