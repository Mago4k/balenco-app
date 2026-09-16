-- ============================================================
-- Balenco — migration 55: document numbers must never be reused.
--
-- assign_estimate_number/assign_job_number took max(number)+1 over the SURVIVING
-- rows, so deleting the highest-numbered record handed its number to the next
-- insert. Two different documents could then carry the same number over time --
-- for an invoice that is an accounting defect, not a cosmetic one.
--
-- Replaced with a per-org counter that only moves forward. Deleting a record no
-- longer lowers it. The counter seeds itself from the current max on first use,
-- so existing numbering continues uninterrupted and nothing is renumbered.
--
-- Applied to the live project 2026-09-15.
-- ============================================================

create table if not exists public.doc_counters (
  org_id      uuid    not null,
  kind        text    not null check (kind in ('estimate', 'job')),
  next_number integer not null,
  primary key (org_id, kind)
);

-- Only the SECURITY DEFINER trigger functions below touch this table; enabling
-- RLS with no policy denies every direct client read and write.
alter table public.doc_counters enable row level security;

create or replace function public.next_doc_number(p_org_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
  seed integer;
begin
  -- Seed from whatever the org has already issued, so this cuts over invisibly.
  if not exists (select 1 from public.doc_counters where org_id = p_org_id and kind = p_kind) then
    if p_kind = 'estimate' then
      select coalesce(max(estimate_number), 1000) + 1 into seed from public.estimates where org_id = p_org_id;
    else
      select coalesce(max(job_number), 1000) + 1 into seed from public.jobs where org_id = p_org_id;
    end if;
    insert into public.doc_counters (org_id, kind, next_number)
      values (p_org_id, p_kind, greatest(seed, 1001))
      on conflict (org_id, kind) do nothing;
  end if;

  -- UPDATE takes a row lock, so concurrent inserts serialise here and each gets
  -- a distinct number without an advisory lock.
  update public.doc_counters
     set next_number = next_number + 1
   where org_id = p_org_id and kind = p_kind
   returning next_number - 1 into n;

  return n;
end $$;

create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estimate_number is null and new.org_id is not null then
    new.estimate_number := public.next_doc_number(new.org_id, 'estimate');
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
    new.job_number := public.next_doc_number(new.org_id, 'job');
  end if;
  return new;
end $$;
