-- Stripe Connect (Express): store each org's connected account id + whether it can
-- accept charges yet. Additive/nullable — no behavior change until the Connect flow
-- and payout onboarding are built and an org completes onboarding. One settings row
-- per org, so this lives on settings. Applied live 2026-07-18.
alter table public.settings
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false;
