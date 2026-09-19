-- Rollback for 0055 (forward-only document numbers).
--
-- Written after the fact. The migration shipped without a _DOWN while every
-- other one in this folder has one; this restores the pair rather than leaving
-- a gap. It was not authored alongside the migration, so read it before running.
--
-- ⚠ WHAT YOU GET BACK. 0055 exists because numbering was max()+1: delete the
-- newest estimate and the next one issued reuses its number, so two different
-- documents go out into the world as EST-1043. Reverting reinstates exactly
-- that. It is a real problem for a tax-relevant document series — do not run
-- this to "tidy up" a numbering gap, since a gap is harmless and a collision is
-- not.
--
-- Note also that 0057 revoked EXECUTE on next_doc_number from public/anon after
-- it was found to be callable by anyone against any org. Dropping the function
-- here removes that surface with it; if you later recreate 0055, re-apply 0057.

drop trigger if exists trg_assign_estimate_number on public.estimates;
drop trigger if exists trg_assign_job_number on public.jobs;

-- Restore the max()+1 behaviour the triggers had before 0055.
create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estimate_number is null and new.org_id is not null then
    select coalesce(max(estimate_number), 1000) + 1
      into new.estimate_number
      from public.estimates where org_id = new.org_id;
  end if;
  return new;
end $$;

create or replace function public.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.job_number is null and new.org_id is not null then
    select coalesce(max(job_number), 1000) + 1
      into new.job_number
      from public.jobs where org_id = new.org_id;
  end if;
  return new;
end $$;

create trigger trg_assign_estimate_number before insert on public.estimates
  for each row execute function public.assign_estimate_number();
create trigger trg_assign_job_number before insert on public.jobs
  for each row execute function public.assign_job_number();

drop function if exists public.next_doc_number(uuid, text);
drop table if exists public.doc_counters;
