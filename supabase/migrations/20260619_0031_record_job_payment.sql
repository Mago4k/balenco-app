-- Migration 31: record_job_payment — atomic, idempotent payment recording for jobs.
-- Exact mirror of record_stripe_payment(), operating on public.jobs. Additive: new
-- function only; record_stripe_payment and all existing data are untouched.
create or replace function public.record_job_payment(
  p_job_id uuid,
  p_amount numeric,
  p_session text,
  p_by text default 'Client (Stripe)',
  p_note text default 'Online payment'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payments jsonb;
begin
  -- lock the job row so concurrent webhook deliveries serialize
  select coalesce(payments, '[]'::jsonb) into v_payments
    from public.jobs where id = p_job_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- idempotency: this Stripe session is already recorded -> do nothing
  if exists (
    select 1 from jsonb_array_elements(v_payments) e
    where e->>'stripe_session' = p_session
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.jobs
     set payments = v_payments || jsonb_build_object(
       'id',             gen_random_uuid(),
       'amount',         p_amount,
       'note',           p_note,
       'date',           now(),
       'by',             p_by,
       'stripe_session', p_session
     )
   where id = p_job_id;

  return jsonb_build_object('ok', true, 'duplicate', false);
end $function$;

-- Lock execute to postgres + service_role, matching record_stripe_payment
-- (revoke the default anon/authenticated/PUBLIC grants).
revoke execute on function public.record_job_payment(uuid, numeric, text, text, text) from public;
revoke execute on function public.record_job_payment(uuid, numeric, text, text, text) from anon;
revoke execute on function public.record_job_payment(uuid, numeric, text, text, text) from authenticated;
