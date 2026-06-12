-- ============================================================
-- Balenco — migration 13: stable, sequential estimate numbers.
-- Until now the "EST-1001" number was derived from the row's INDEX
-- in the client-side array, so every estimate's number shifted as
-- others were added or deleted (and invoices drifted with them).
-- This stores a real per-org sequential number, assigned once at
-- insert by a trigger and never changing afterward.
-- ============================================================

alter table public.estimates add column if not exists estimate_number integer;

-- Backfill existing rows: per-org, in creation order, starting at 1001.
with ranked as (
  select id, (row_number() over (partition by org_id order by created_at, id)) + 1000 as n
  from public.estimates
)
update public.estimates e
set estimate_number = ranked.n
from ranked
where ranked.id = e.id and e.estimate_number is null;

-- One number per org. (row_number backfill guarantees uniqueness.)
create unique index if not exists estimates_org_number_uniq
  on public.estimates (org_id, estimate_number);

-- Assign the next per-org number on insert. SECURITY DEFINER so it can
-- read the org-wide max even when the inserting user is an employee
-- whose RLS view is limited to their own rows.
create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estimate_number is null and new.org_id is not null then
    select coalesce(max(estimate_number), 1000) + 1
      into new.estimate_number
      from public.estimates
     where org_id = new.org_id;
  end if;
  return new;
end $$;

revoke execute on function public.assign_estimate_number() from public, anon, authenticated;

drop trigger if exists trg_assign_estimate_number on public.estimates;
create trigger trg_assign_estimate_number
  before insert on public.estimates
  for each row execute function public.assign_estimate_number();
