-- 0050 — baseline reconcile: put the undocumented production schema into the repo.
--
-- Three tables and ~20 columns existed ONLY in the live database. They were
-- created by hand through the dashboard over the months and never written down,
-- so `supabase/migrations/` could not rebuild this database: almost every other
-- migration references `public.orgs`, which no file in this repo ever created.
--
-- Everything here is generated from live introspection on 2026-09-14 and is
-- written to be IDEMPOTENT — `if not exists` throughout, and policies created
-- only when absent. Applying it to production is a complete no-op; its purpose is
-- to make a from-scratch rebuild (a branch, a restore, a second environment)
-- actually work.
--
-- Two live shapes are recorded here as they ARE, not as they should be. Both are
-- known issues, deliberately NOT changed in this migration because a baseline
-- must not alter behaviour:
--   * `availability` has NO foreign key to orgs and NO unique constraint on
--     org_id. That is why a row pointing at a deleted org still exists, and why
--     get-slots/create-booking calling .maybeSingle() would error for any org
--     that ever ends up with two rows.
--   * `push_subscriptions.org_id` is TEXT while every other org_id is UUID,
--     which is why its RLS policy has to cast.

-- ── orgs ────────────────────────────────────────────────────────────────────
create table if not exists public.orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  created_at      timestamptz default now(),
  join_token      uuid not null default gen_random_uuid(),
  lead_intake_key text
);
alter table public.orgs enable row level security;
-- Partial unique index from 0042 (repeated here so a rebuild gets it even if
-- 0042 ran before this file in a fresh ordering).
create unique index if not exists orgs_lead_intake_key_uidx
  on public.orgs (lead_intake_key) where lead_intake_key is not null;

-- ── availability (online-booking settings, one row per org) ──────────────────
create table if not exists public.availability (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid,
  working_days    integer[] default '{1,2,3,4,5}'::integer[],
  start_time      text default '08:00'::text,
  end_time        text default '17:00'::text,
  slot_minutes    integer default 60,
  booking_enabled boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.availability enable row level security;

-- ── push_subscriptions (web-push endpoints) ─────────────────────────────────
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  org_id     text,          -- TEXT, unlike every other org_id (see header)
  user_name  text,
  created_at timestamptz default now()
);
alter table public.push_subscriptions enable row level security;
create index if not exists idx_push_subs_org on public.push_subscriptions (org_id);

-- ── RLS policies for the three tables above ─────────────────────────────────
-- These also existed only in the live database. Created only when absent so this
-- migration stays a no-op on production.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orgs' and policyname='org_members_read_own') then
    create policy org_members_read_own on public.orgs for select to authenticated
      using (id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='orgs' and policyname='org_owners_update_own') then
    create policy org_owners_update_own on public.orgs for update to authenticated
      using (id = public.current_org_id() and public.current_user_role() = 'owner')
      with check (id = public.current_org_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='availability' and policyname='avail_org_manage') then
    create policy avail_org_manage on public.availability for all to authenticated
      using (org_id in (select profiles.org_id from public.profiles where profiles.id = auth.uid()))
      with check (org_id in (select profiles.org_id from public.profiles where profiles.id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='push_subscriptions' and policyname='push_subs_org') then
    create policy push_subs_org on public.push_subscriptions for all to authenticated
      using (org_id = (public.current_org_id())::text)
      with check (org_id = (public.current_org_id())::text);
  end if;
end $$;
-- NOTE: `avail_public_read` (anon SELECT USING true) is deliberately NOT
-- recreated here — migration 0048 dropped it. See that file for why.

-- ── Columns added by hand to tables the repo DOES create ────────────────────
-- Multi-tenancy: org_id was added to every core table out-of-band.
alter table public.profiles     add column if not exists org_id uuid;
alter table public.settings     add column if not exists org_id uuid;
alter table public.clients      add column if not exists org_id uuid;
alter table public.leads        add column if not exists org_id uuid;
alter table public.estimates    add column if not exists org_id uuid;
alter table public.appointments add column if not exists org_id uuid;
alter table public.photos       add column if not exists org_id uuid;
alter table public.logs         add column if not exists org_id uuid;

-- Estimates: line items, recorded payments, validity date, follow-up flag.
alter table public.estimates add column if not exists line_items    jsonb default '[]'::jsonb;
alter table public.estimates add column if not exists payments      jsonb default '[]'::jsonb;
alter table public.estimates add column if not exists expiry        text;    -- text, not date (compared lexicographically)
alter table public.estimates add column if not exists followup_sent boolean default false;

-- Appointments: calendar recurrence + the online-booking fields.
alter table public.appointments add column if not exists recurring           text default ''::text;
alter table public.appointments add column if not exists recurring_end       text default ''::text;  -- text here, DATE on jobs
alter table public.appointments add column if not exists recurring_parent_id uuid;
alter table public.appointments add column if not exists booking_status      text default 'confirmed'::text;
alter table public.appointments add column if not exists booker_name         text;
alter table public.appointments add column if not exists booker_email        text;
alter table public.appointments add column if not exists booker_phone        text;
alter table public.appointments add column if not exists booked_online       boolean default false;

-- Settings: per-org follow-up delay used by send-followups.
alter table public.settings add column if not exists followup_days integer default 3;
