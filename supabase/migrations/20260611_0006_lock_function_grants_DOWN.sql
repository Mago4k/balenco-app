-- Rollback for migration 6 (re-opens the grants — not recommended).
grant execute on function public.record_stripe_payment(uuid,numeric,text,text,text) to anon, authenticated;
grant execute on function public.current_org_id()   to anon;
grant execute on function public.current_user_role() to anon;
alter function public.notify_new_booking() reset search_path;
