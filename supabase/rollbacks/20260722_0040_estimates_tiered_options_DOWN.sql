-- Rollback for 0040.
alter table public.estimates
  drop column if exists options,
  drop column if exists selected_option;
