-- Migration 30: jobs — fully-billable work records created without an estimate.
-- Mirrors the billable shape of public.estimates; billing shared via a
-- kind:'estimate'|'job' discriminator in the edge functions (no duplicated money logic).

create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references public.orgs(id)    on delete cascade,
  client_id        uuid references public.clients(id) on delete set null,
  title            text    default '',
  scope            text    default '',
  line_items       jsonb   default '[]'::jsonb,
  payments         jsonb   default '[]'::jsonb,
  subtotal         numeric default 0,
  deposit          numeric default 0,
  payment_schedule text    default 'Deposit + balance on completion',
  payment_notes    text    default '',
  status           text    default 'Active',          -- Active | In Progress | Completed | Cancelled
  job_number       integer,
  created_by       text    default '',
  created_at       timestamptz default now(),
  updated_by       text    default '',
  updated_at       timestamptz default now()
);

create index if not exists jobs_org_id_idx    on public.jobs(org_id);
create index if not exists jobs_client_id_idx on public.jobs(client_id);

-- Per-org sequential numbering — exact mirror of assign_estimate_number()
create or replace function public.assign_job_number()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.job_number is null and new.org_id is not null then
    perform pg_advisory_xact_lock(hashtext('balenco_jobnum_' || new.org_id::text)::bigint);
    select coalesce(max(job_number), 1000) + 1
      into new.job_number from public.jobs where org_id = new.org_id;
  end if;
  return new;
end $$;

create trigger trg_assign_job_number
  before insert on public.jobs
  for each row execute function public.assign_job_number();

-- RLS: byte-for-byte the same tenant isolation as estimates
alter table public.jobs enable row level security;

create policy org_members_all on public.jobs
  for all to authenticated
  using      ((org_id = current_org_id()) and ((current_user_role() = 'owner') or (created_by = current_user_name())))
  with check ((org_id = current_org_id()) and ((current_user_role() = 'owner') or (created_by = current_user_name())));
