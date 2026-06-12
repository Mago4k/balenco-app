-- Rollback migration 12: restore the broad PUBLIC execute grants.
grant execute on function public.handle_new_user()      to public;
grant execute on function public.notify_new_booking()   to public;
grant execute on function public.guard_profile_update() to public;
grant execute on function public.current_org_id()    to public;
grant execute on function public.current_user_role() to public;
grant execute on function public.current_user_name() to public;
