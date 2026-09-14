-- DOWN for migration 30: remove the jobs table and its numbering machinery.
drop trigger  if exists trg_assign_job_number on public.jobs;
drop function if exists public.assign_job_number();
drop table    if exists public.jobs;   -- drops its policy + indexes too
