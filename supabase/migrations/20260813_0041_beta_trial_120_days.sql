-- Beta free period: signup auto-trial extended from 14 → 120 days (Carlos's call,
-- 2026-08-13). Applied live via MCP. Only the interval changes; SECURITY DEFINER +
-- search_path preserved. Revert to 14 days at the paid launch / beta end (see _DOWN).
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.subscriptions (org_id, status, trial_end)
  values (new.id, 'trialing', now() + interval '120 days')
  on conflict (org_id) do nothing;
  return new;
end;
$function$;
