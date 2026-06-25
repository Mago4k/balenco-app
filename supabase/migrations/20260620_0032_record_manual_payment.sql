-- Migration 32: atomic manual-payment recording + lock down two over-exposed trigger fns.
-- record_manual_payment locks the estimate/job row and appends one payment (idempotent by a
-- client-supplied payment id), mirroring record_stripe_payment — so a manual cash/cheque entry
-- from a stale browser can no longer overwrite a concurrent online or co-worker payment.
-- SECURITY INVOKER: RLS (org_members_all) enforces org + owner isolation; the authenticated
-- owner can record against their own org's records only.
create or replace function public.record_manual_payment(
  p_kind text,
  p_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_note text default '',
  p_by text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
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

revoke execute on function public.record_manual_payment(text, uuid, uuid, numeric, text, text) from public, anon;

-- Advisor fix: these two SECURITY DEFINER trigger functions were anon/authenticated-executable
-- via /rest/v1/rpc. They run inside their triggers regardless of grants — remove the surface.
revoke execute on function public.assign_job_number() from public, anon, authenticated;
revoke execute on function public.create_trial_subscription() from public, anon, authenticated;
