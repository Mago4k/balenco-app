-- Rollback for 0034. Drops the jobs unique index and restores record_manual_payment
-- to its pre-0034 body (no amount guard). Grants + SECURITY INVOKER are preserved by
-- CREATE OR REPLACE.

DROP INDEX IF EXISTS public.jobs_org_number_uniq;

CREATE OR REPLACE FUNCTION public.record_manual_payment(p_kind text, p_id uuid, p_payment_id uuid, p_amount numeric, p_note text DEFAULT ''::text, p_by text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_payments jsonb;
begin
  if p_kind = 'job' then
    select coalesce(payments, '[]'::jsonb) into v_payments from public.jobs where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if exists (select 1 from jsonb_array_elements(v_payments) e where e->>'id' = p_payment_id::text) then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    update public.jobs
       set payments = v_payments || jsonb_build_object('id', p_payment_id, 'amount', p_amount, 'note', p_note, 'date', now(), 'by', p_by)
     where id = p_id;
  else
    select coalesce(payments, '[]'::jsonb) into v_payments from public.estimates where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if exists (select 1 from jsonb_array_elements(v_payments) e where e->>'id' = p_payment_id::text) then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    update public.estimates
       set payments = v_payments || jsonb_build_object('id', p_payment_id, 'amount', p_amount, 'note', p_note, 'date', now(), 'by', p_by)
     where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false);
end $function$;
