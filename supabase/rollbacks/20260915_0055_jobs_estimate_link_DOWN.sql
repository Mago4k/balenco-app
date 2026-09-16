-- Rollback for 0055. Drops the estimate->job link.
--
-- Safe: the column is additive and nullable, and the frontend treats a missing
-- estimateId as "not converted". Dropping it makes every linked estimate count
-- toward revenue again, which is the double-count this migration exists to stop.
drop index if exists public.jobs_estimate_id_idx;
alter table public.jobs drop column if exists estimate_id;
