-- DOWN for migration 47. Only safe before the policy flip (0048) — after it,
-- removing the stamp means new rows insert with created_by_id NULL and vanish
-- from their creator's view.

drop trigger if exists set_created_by_id on public.clients;
drop trigger if exists set_created_by_id on public.leads;
drop trigger if exists set_created_by_id on public.estimates;
drop trigger if exists set_created_by_id on public.appointments;
drop trigger if exists set_created_by_id on public.photos;
drop trigger if exists set_created_by_id on public.jobs;
drop trigger if exists set_log_user_id   on public.logs;

drop function if exists public.set_created_by_id();
drop function if exists public.set_log_user_id();
