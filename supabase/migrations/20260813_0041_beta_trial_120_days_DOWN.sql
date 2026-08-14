-- Rollback for 0041: restore the 14-day signup trial (for the paid launch).
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.subscriptions (org_id, status, trial_end)
  values (new.id, 'trialing', now() + interval '14 days')
  on conflict (org_id) do nothing;
  return new;
end;
$function$;
