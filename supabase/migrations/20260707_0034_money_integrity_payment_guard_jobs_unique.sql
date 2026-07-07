-- Money-integrity hardening (2026-07-07 audit). Applied live via MCP apply_migration.
-- 1) record_manual_payment is the one payment RPC directly callable by an authenticated
--    user via /rest/v1/rpc. Add a DB-level guard rejecting non-positive amounts so a
--    negative/zero payment can't corrupt a balance. CREATE OR REPLACE preserves the
--    existing EXECUTE grants and SECURITY INVOKER.
-- 2) jobs gets UNIQUE(org_id, job_number) to match estimates_org_number_uniq;
--    assign_job_number already serializes via advisory lock — this is the DB backstop.

CREATE OR REPLACE FUNCTION public.record_manual_payment(p_kind text, p_id uuid, p_payment_id uuid, p_amount numeric, p_note text DEFAULT ''::text, p_by text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_payments jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_manual_payment: amount must be a positive number (got %)', p_amount;
  end if;
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

CREATE UNIQUE INDEX IF NOT EXISTS jobs_org_number_uniq ON public.jobs (org_id, job_number);
