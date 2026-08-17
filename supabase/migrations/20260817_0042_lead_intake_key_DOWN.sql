-- Rollback for 0042.
drop function if exists public.rotate_lead_intake_key();
drop function if exists public.ensure_lead_intake_key();
drop index if exists public.orgs_lead_intake_key_uidx;
alter table public.orgs drop column if exists lead_intake_key;
