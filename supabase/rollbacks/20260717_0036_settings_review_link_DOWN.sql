-- Rollback for 0036_settings_review_link.
alter table public.settings drop column if exists review_link;
