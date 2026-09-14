-- DOWN for migration 45. Only safe while RLS still keys on created_by (i.e.
-- before migration 0048 has been applied). Dropping these columns after the
-- policy flip would take every non-owner's record visibility with it.

drop index if exists public.clients_org_creator_idx;
drop index if exists public.leads_org_creator_idx;
drop index if exists public.estimates_org_creator_idx;
drop index if exists public.appointments_org_creator_idx;
drop index if exists public.photos_org_creator_idx;
drop index if exists public.jobs_org_creator_idx;
drop index if exists public.logs_org_user_idx;

alter table public.clients      drop column if exists created_by_id;
alter table public.leads        drop column if exists created_by_id;
alter table public.estimates    drop column if exists created_by_id;
alter table public.appointments drop column if exists created_by_id;
alter table public.photos       drop column if exists created_by_id;
alter table public.jobs         drop column if exists created_by_id;
alter table public.logs         drop column if exists user_id;
