-- ============================================================
-- Balenco — migration 20: tokenize the no-login portal/approval links.
-- The client portal (?client=) and approval page (?approve=) were authorized
-- by the raw clients.id / estimates.id UUID in the URL — a never-expiring,
-- guessable-over-time bearer for a client's full PII (name/phone/email/
-- address/balance + estimates). Replace with an unguessable token that is
-- SEPARATE from the primary key, so a leaked PK can't read PII and a link can
-- be revoked by rotating the token. Token = two random UUIDs (256 bits).
-- ============================================================

alter table public.clients   add column if not exists portal_token   text;
alter table public.estimates add column if not exists approval_token text;

-- Backfill existing rows with a strong random token.
update public.clients
  set portal_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  where portal_token is null;
update public.estimates
  set approval_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  where approval_token is null;

-- New rows auto-generate a token.
alter table public.clients
  alter column portal_token set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
alter table public.estimates
  alter column approval_token set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create unique index if not exists clients_portal_token_idx   on public.clients(portal_token);
create unique index if not exists estimates_approval_token_idx on public.estimates(approval_token);
