-- ============================================================
-- Balenco hardening — migration 1: safe foundation
-- No RLS/policy changes here. Idempotent and reversible.
-- ============================================================

-- (a) Backfill the legacy 'global' settings row with the org id, so the edge
--     functions that look settings up by org_id (tax rates + company name used
--     in client emails and Stripe descriptions) stop falling back to defaults.
update public.settings
   set org_id = (select id from public.orgs order by created_at limit 1)
 where org_id is null;

-- (b) profiles.email column: signUp() / startSession() insert `email`, but the
--     column never existed — so those profile inserts have been failing silently.
alter table public.profiles add column if not exists email text;

-- (c) Backfill profile emails from auth.users (source of truth).
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and (p.email is null or p.email = '');
