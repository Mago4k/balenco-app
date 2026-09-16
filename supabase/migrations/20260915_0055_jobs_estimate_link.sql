-- 0055 — link a job back to the estimate it came from.
--
-- THE DEFECT
-- `estimates` and `jobs` are two independent billable ledgers and nothing
-- connected them. Accepting a $10,000 quote and then creating a Job to track the
-- same work — which is the natural workflow, and the one the app's own "record
-- work directly" copy encourages — counted the money twice everywhere it is
-- aggregated: dashboard revenue, the client's balance, the Balances tab, the
-- revenue & tax report, the accounting CSV and the client portal.
--
-- Concretely, for one $10,000 job of work:
--   Dashboard YTD           $22,995.00   (should be $11,497.50)
--   Revenue & tax report    $20,000 revenue, $1,000 TPS, $1,995 TVQ
--   Overstated sales tax    $1,497.50
-- That last line is the one that matters: it is an overstatement on a Revenu
-- Québec remittance, with nothing in the data to detect it.
--
-- THE FIX
-- A job may now point at the estimate it was created from. Once that link exists
-- the JOB is the billable record — it carries the line items and the payments —
-- and the estimate is the historical quote that won the work, so the app excludes
-- linked estimates from every money aggregate.
--
-- ON DELETE SET NULL, never cascade: deleting a quote must not delete the job, or
-- the payments recorded against it.
--
-- Nullable and unconstrained on purpose — a job recorded directly, with no quote
-- behind it, is a completely normal case and stays linked to nothing.

alter table public.jobs
  add column if not exists estimate_id uuid references public.estimates(id) on delete set null;

-- Serves both the "is this estimate already converted?" lookup and the FK's own
-- ON DELETE SET NULL sweep, which would otherwise seq-scan jobs on every estimate
-- delete. Partial: only linked rows are ever searched for.
create index if not exists jobs_estimate_id_idx
  on public.jobs (estimate_id) where estimate_id is not null;
