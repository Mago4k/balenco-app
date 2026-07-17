-- Rollback for 0035_cron_secret_gate.
-- NOTE: rolling back restores notify_new_booking's UNAUTHENTICATED call to
-- send-push. Only do this together with redeploying the pre-gate function
-- versions (send-followups v10, send-reminders v12 verify_jwt=true, send-push
-- v6) and restoring the cron.job commands, or booking pushes will 401.

drop function if exists public.check_cron_secret(text);

create or replace function public.notify_new_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://wvqqazdzejjksjcjdbcm.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id))
  );
  return new;
end;
$function$;

-- Optional: remove the vault secret entirely:
-- delete from vault.secrets where name = 'cron_secret';
