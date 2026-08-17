-- Migration 42: per-org lead-intake webhook key.
-- Powers the public `lead-intake` edge function (Facebook/Instagram Lead Ads →
-- Zapier/Make → Balenco). Each org gets an unguessable secret; the webhook maps
-- key → org and drops the lead into that org's existing public.leads inbox.
-- The key is a bearer secret, NOT org_id (org_id is semi-public — it rides in
-- booking links), so a leaked booking link can't be used to inject leads.

alter table public.orgs add column if not exists lead_intake_key text;

-- Fast, collision-proof key → org lookup for the edge function (service role).
create unique index if not exists orgs_lead_intake_key_uidx
  on public.orgs(lead_intake_key) where lead_intake_key is not null;

-- Owner reads (and lazily mints on first call) their org's webhook key.
-- SECURITY DEFINER so it can write orgs regardless of that table's RLS; gated to
-- the owner role so employees can't read or create the org's webhook secret.
create or replace function public.ensure_lead_intake_key()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare k text;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only the owner can manage the lead webhook key';
  end if;
  select lead_intake_key into k from public.orgs where id = public.current_org_id();
  if k is null or k = '' then
    -- 64 hex chars (two UUIDs, hyphens stripped) — ~244 bits, URL-safe.
    k := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.orgs set lead_intake_key = k where id = public.current_org_id();
  end if;
  return k;
end
$function$;

revoke all on function public.ensure_lead_intake_key() from public, anon;
grant execute on function public.ensure_lead_intake_key() to authenticated;

-- Owner rotates the key — instantly revokes the old webhook URL if it leaks.
create or replace function public.rotate_lead_intake_key()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare k text;
begin
  if public.current_user_role() <> 'owner' then
    raise exception 'Only the owner can manage the lead webhook key';
  end if;
  k := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.orgs set lead_intake_key = k where id = public.current_org_id();
  return k;
end
$function$;

revoke all on function public.rotate_lead_intake_key() from public, anon;
grant execute on function public.rotate_lead_intake_key() to authenticated;
