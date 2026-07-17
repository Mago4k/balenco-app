-- 0035 — Cron-secret gate for cron/trigger-invoked edge functions.
-- (Applied live 2026-07-17 as supabase_migrations version 20260717145153.)
--
-- Context: cron.job previously embedded the full-access sb_secret_ key in
-- plaintext in its commands (and the send-followups job's headers were invalid
-- JSON, so that job had failed on every run since creation). notify_new_booking
-- called send-push with no auth at all.
--
-- New model:
--   * A 256-bit shared secret lives ONLY in vault under the name 'cron_secret'
--     (created out-of-band with vault.create_secret — not in this file).
--   * pg_cron jobs + the notify_new_booking trigger read it from vault at call
--     time and send it as an x-cron-secret header (never stored in cron.job).
--   * Edge fns (send-followups v11, send-reminders v13, send-push v7) validate
--     the header via check_cron_secret() — service-role-only, compares in-DB so
--     the secret never leaves Postgres — and 401 otherwise.
--   * send-reminders flipped verify_jwt true→false (its old auth was the
--     embedded master key; the in-function gate replaces it).
--
-- The cron.job command updates were applied via cron.alter_job(2|3, ...) —
-- pg_cron jobs are not managed by migrations in this repo.

create or replace function public.check_cron_secret(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'cron_secret' and decrypted_secret = candidate
  );
$$;

revoke execute on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

-- Booking push trigger: authenticate to send-push with the vault secret
-- (send-push was previously called with no auth header at all).
create or replace function public.notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://wvqqazdzejjksjcjdbcm.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id))
  );
  return new;
end;
$function$;
