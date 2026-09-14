-- Rollback for 0037_recurring_jobs. Also unschedule the cron + delete the
-- generate-recurring-jobs edge function if rolling the feature back fully.
-- select cron.unschedule('generate-recurring-jobs-daily');
drop index if exists public.jobs_next_recurrence_idx;
alter table public.jobs
  drop column if exists next_recurrence,
  drop column if exists recurring_parent_id,
  drop column if exists recurring_end,
  drop column if exists recurring;
