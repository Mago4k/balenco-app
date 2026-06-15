-- ============================================================
-- Balenco — migration 25: subscriptions (SaaS billing foundation).
-- One row per org. The 14-day trial is tracked HERE (no card up front): a new
-- org gets status 'trialing' + trial_end = now()+14d automatically. Subscribing
-- via Stripe Checkout flips it to 'active' (set by the webhook). App access is
-- gated on: status='active' OR (status='trialing' AND trial_end > now()).
-- ============================================================

create table if not exists public.subscriptions (
  org_id                 uuid primary key references public.orgs(id) on delete cascade,
  plan                   text,                                  -- solo | team | founding
  status                 text not null default 'trialing',      -- trialing|active|past_due|canceled|incomplete|unpaid
  stripe_customer_id     text,
  stripe_subscription_id text,
  trial_end              timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Members may read their own org's subscription (the app checks status on load).
-- No insert/update/delete policy: writes happen only via the service role inside
-- the trial trigger and the Stripe webhook, which bypass RLS.
drop policy if exists subs_org_read on public.subscriptions;
create policy subs_org_read on public.subscriptions
  for select to authenticated
  using (org_id = public.current_org_id());

-- Auto-create a 14-day trial when an org is created (isolated trigger on orgs;
-- leaves handle_new_user untouched so the signup flow is unaffected).
create or replace function public.create_trial_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (org_id, status, trial_end)
  values (new.id, 'trialing', now() + interval '14 days')
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists orgs_create_trial on public.orgs;
create trigger orgs_create_trial
  after insert on public.orgs
  for each row execute function public.create_trial_subscription();

-- Grandfather existing orgs with a long trial so nobody is locked out at launch.
insert into public.subscriptions (org_id, status, trial_end)
select id, 'trialing', now() + interval '365 days' from public.orgs
on conflict (org_id) do nothing;
