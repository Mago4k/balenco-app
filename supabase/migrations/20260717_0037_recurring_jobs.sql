-- 0037 — Recurring billing on jobs (applied live 2026-07-17).
-- A job with recurring != '' ('weekly'|'biweekly'|'monthly') is a TEMPLATE.
-- The generate-recurring-jobs edge fn (daily pg_cron 09:30 UTC, x-cron-secret
-- gated like the other cron fns) clones due templates each period (clone:
-- deposit 0, payments [], recurring '', recurring_parent_id -> template),
-- advances next_recurrence, logs, and emails the client their tokenized
-- portal payment link. Stops automatically past recurring_end.
alter table public.jobs
  add column if not exists recurring text not null default '',
  add column if not exists recurring_end date,
  add column if not exists recurring_parent_id uuid references public.jobs(id) on delete set null,
  add column if not exists next_recurrence date;

create index if not exists jobs_next_recurrence_idx
  on public.jobs (next_recurrence) where next_recurrence is not null;

-- The daily cron was registered out-of-band (pg_cron jobs are not managed by
-- migrations in this repo):
--   select cron.schedule('generate-recurring-jobs-daily', '30 9 * * *', $cmd$ ... $cmd$);
-- with headers built from vault ('cron_secret'), same as jobs 2 and 3.
