-- 0059 — expenses, so the app can answer "did I make money on that job?"
--
-- THE GAP
-- Balenco has always tracked one side of the ledger. The revenue & tax report
-- says so in its own disclaimer: "expenses excluded". So it can tell a contractor
-- what he BILLED and never what he MADE, which is the question people actually
-- open the app to answer.
--
-- The second thing it unlocks matters just as much in Québec: TPS and TVQ paid on
-- materials are input tax credits against the TPS/TVQ collected. Without the paid
-- side, the report shows tax collected and calls it what you owe. With it, the
-- report can show the real remittance figure — which is most of what a contractor
-- pays a comptable to work out.
--
-- SHAPE
-- `amount` is PRE-TAX, and tps/tvq are stored separately, exactly like estimates
-- and jobs: the same convention everywhere means one mental model and one way to
-- total things up. A receipt with no tax breakdown just carries 0s.
--
-- job_id is nullable and ON DELETE SET NULL: overheads (insurance, the truck, a
-- tool) belong to the business, not a job, and deleting a job must never silently
-- delete the receipts that were booked against it.

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  job_id        uuid references public.jobs(id) on delete set null,
  spent_on      date not null default current_date,
  vendor        text not null default '',
  category      text not null default 'Materials',
  description   text not null default '',
  amount        numeric(12,2) not null default 0,
  tps           numeric(12,2) not null default 0,
  tvq           numeric(12,2) not null default 0,
  created_by    text not null default '',
  created_by_id uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    text not null default '',
  updated_at    timestamptz not null default now(),
  constraint expenses_amount_not_negative check (amount >= 0 and tps >= 0 and tvq >= 0)
);

-- Same rule as jobs and estimates (0049): the whole org for an owner, your own
-- rows for everyone else.
alter table public.expenses enable row level security;

drop policy if exists org_members_all on public.expenses;
create policy org_members_all on public.expenses
  for all to authenticated
  using (
    org_id = current_org_id()
    and (current_user_role() = 'owner' or created_by_id = (select auth.uid()))
  )
  with check (
    org_id = current_org_id()
    and (current_user_role() = 'owner' or created_by_id = (select auth.uid()))
  );

-- Stamps created_by_id from the JWT on insert, same as every other table, so the
-- policy above has something to match and the client cannot claim someone else's.
drop trigger if exists set_created_by_id on public.expenses;
create trigger set_created_by_id before insert on public.expenses
  for each row execute function public.set_created_by_id();

-- The report and the CSV scan a whole year for one org; the job sheet looks up one
-- job's receipts.
create index if not exists expenses_org_date_idx on public.expenses (org_id, spent_on desc);
create index if not exists expenses_job_idx on public.expenses (job_id) where job_id is not null;
create index if not exists expenses_created_by_id_idx on public.expenses (created_by_id);

comment on table public.expenses is
  'Money out. amount is PRE-TAX with tps/tvq held separately, matching estimates and jobs. job_id optional: overheads belong to the business, not a job.';
