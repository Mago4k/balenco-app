-- Rollback migration 13.
drop trigger if exists trg_assign_estimate_number on public.estimates;
drop function if exists public.assign_estimate_number();
drop index if exists public.estimates_org_number_uniq;
alter table public.estimates drop column if exists estimate_number;
