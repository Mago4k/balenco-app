-- Platform-owner exemption for Stripe Connect. The platform owner (Balenco)
-- collects client card payments directly on the platform account and needs no
-- connected account; every OTHER contractor routes client payments to their own
-- Stripe Connect account via a destination charge. One settings row per org, so
-- the flag lives on settings. Applied live 2026-07-21.
alter table public.settings
  add column if not exists is_platform_owner boolean not null default false;

-- Balenco (the platform owner) collects directly.
update public.settings set is_platform_owner = true
where org_id = '5d9828cc-de6d-43fa-a65c-1a37c68160c6';
