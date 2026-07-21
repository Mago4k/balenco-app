-- Rollback for 0039.
alter table public.settings drop column if exists is_platform_owner;
