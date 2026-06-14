-- ============================================================
-- Balenco — migration 21: per-org AI usage metering.
-- The ai-estimate function spends a single shared ANTHROPIC_API_KEY billed to
-- the owner for ALL tenants, uncapped — a denial-of-wallet risk once signups
-- open (a buggy/abusive tenant can run up an unbounded bill). Log every call
-- per org so the function can enforce a monthly cap and so spend is
-- attributable per tenant for future billing.
-- ============================================================

create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  user_id       uuid,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_org_month_idx on public.ai_usage(org_id, created_at);

alter table public.ai_usage enable row level security;

-- Members can read their own org's usage (for a future "AI used this month"
-- display). Writes happen only via the service role inside the edge function,
-- which bypasses RLS, so no insert/update/delete policy is granted.
drop policy if exists ai_usage_org_read on public.ai_usage;
create policy ai_usage_org_read on public.ai_usage
  for select to authenticated
  using (org_id = public.current_org_id());
