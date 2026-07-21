-- Rollback for 0038.
alter table public.settings
  drop column if exists stripe_account_id,
  drop column if exists stripe_charges_enabled;
