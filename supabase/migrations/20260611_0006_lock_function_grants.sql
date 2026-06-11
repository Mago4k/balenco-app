-- ============================================================
-- Balenco hardening — migration 6: lock down function execute grants
-- (surfaced by the Supabase security advisor)
--
-- Supabase's default privileges grant EXECUTE on public functions to anon +
-- authenticated, which a plain `revoke from public` does NOT undo. So these
-- SECURITY DEFINER functions were callable via /rest/v1/rpc by anyone.
-- ============================================================

-- CRITICAL: record_stripe_payment appends a payment to an estimate. Only the
-- service role (the Stripe webhook) may call it — otherwise anyone could inject
-- a fake payment and mark an estimate paid.
revoke execute on function public.record_stripe_payment(uuid,numeric,text,text,text) from anon, authenticated;

-- RLS helpers: the authenticated org policies need these (keep authenticated),
-- but anon never does.
revoke execute on function public.current_org_id()   from anon;
revoke execute on function public.current_user_role() from anon;

-- Pin search_path on the pre-existing booking-notify trigger function.
alter function public.notify_new_booking() set search_path = public;
