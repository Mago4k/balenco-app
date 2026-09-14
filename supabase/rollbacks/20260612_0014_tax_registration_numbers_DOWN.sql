-- Rollback migration 14.
alter table public.settings drop column if exists gst_number;
alter table public.settings drop column if exists qst_number;
