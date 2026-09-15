-- 0054 — make the payment RPCs refuse money that cannot be right.
--
-- All three RPCs already lock the row and dedupe, but only record_manual_payment
-- (0034) checked the amount at all. The two Stripe-facing ones accepted anything:
--   * no positivity guard, and stripe-webhook passes Number(meta.amount || 0)
--     straight through, so a malformed or absent metadata amount recorded 0 (or a
--     negative, which would have INCREASED the balance), and
--   * nothing compared the running total against the record's own total. The only
--     ceiling lived in create-payment-checkout at session-creation time, so two
--     checkouts opened on the same balance (two tabs, or the portal plus the
--     contractor's payment link) both passed that check, both completed, and —
--     having different session ids — both cleared idempotency. A $13,797 estimate
--     could end up with $19,594 recorded against it, reading "paid in full".
--
-- The cap belongs here, inside the FOR UPDATE, because that is the only place the
-- two concurrent writers are actually serialized.
--
-- A 1-cent tolerance matches create-payment-checkout, and the tax rates come from
-- the record's own org so the ceiling is computed the same way the app computes
-- the total. Overpayment RAISES rather than returning ok:false — the webhook turns
-- an exception into a 500 and Stripe retries, which surfaces it, whereas a silent
-- ok:false would drop the money quietly.

create or replace function public.record_stripe_payment(
  p_estimate_id uuid,
  p_amount      numeric,
  p_session     text,
  p_by          text default 'Client (Stripe)'::text,
  p_note        text default 'Online payment'::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payments jsonb;
  v_subtotal numeric;
  v_org      uuid;
  v_tps      numeric;
  v_tvq      numeric;
  v_total    numeric;
  v_paid     numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_stripe_payment: amount must be a positive number (got %)', p_amount;
  end if;

  -- lock the estimate row so concurrent webhook deliveries serialize
  select coalesce(payments, '[]'::jsonb), coalesce(subtotal, 0), org_id
    into v_payments, v_subtotal, v_org
    from public.estimates where id = p_estimate_id for update;

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

  select coalesce(tps, 5), coalesce(tvq, 9.975) into v_tps, v_tvq
    from public.settings where org_id = v_org;
  v_tps := coalesce(v_tps, 5);
  v_tvq := coalesce(v_tvq, 9.975);

  v_total := round(v_subtotal * (1 + v_tps / 100 + v_tvq / 100), 2);
  select coalesce(sum((e->>'amount')::numeric), 0) into v_paid
    from jsonb_array_elements(v_payments) e;

  if v_paid + p_amount > v_total + 0.01 then
    raise exception 'record_stripe_payment: % would exceed the remaining balance of % on estimate %',
      p_amount, greatest(v_total - v_paid, 0), p_estimate_id;
  end if;

  update public.estimates
     set payments = v_payments || jsonb_build_object(
       'id',             gen_random_uuid(),
       'amount',         p_amount,
       'note',           p_note,
       'date',           now(),
       'by',             p_by,
       'stripe_session', p_session
     )
   where id = p_estimate_id;

  return jsonb_build_object('ok', true, 'duplicate', false);
end $function$;

create or replace function public.record_job_payment(
  p_job_id  uuid,
  p_amount  numeric,
  p_session text,
  p_by      text default 'Client (Stripe)'::text,
  p_note    text default 'Online payment'::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payments jsonb;
  v_subtotal numeric;
  v_org      uuid;
  v_tps      numeric;
  v_tvq      numeric;
  v_total    numeric;
  v_paid     numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_job_payment: amount must be a positive number (got %)', p_amount;
  end if;

  -- lock the job row so concurrent webhook deliveries serialize
  select coalesce(payments, '[]'::jsonb), coalesce(subtotal, 0), org_id
    into v_payments, v_subtotal, v_org
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

  select coalesce(tps, 5), coalesce(tvq, 9.975) into v_tps, v_tvq
    from public.settings where org_id = v_org;
  v_tps := coalesce(v_tps, 5);
  v_tvq := coalesce(v_tvq, 9.975);

  v_total := round(v_subtotal * (1 + v_tps / 100 + v_tvq / 100), 2);
  select coalesce(sum((e->>'amount')::numeric), 0) into v_paid
    from jsonb_array_elements(v_payments) e;

  if v_paid + p_amount > v_total + 0.01 then
    raise exception 'record_job_payment: % would exceed the remaining balance of % on job %',
      p_amount, greatest(v_total - v_paid, 0), p_job_id;
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

-- Grants unchanged from 0006/0031: service_role only, never the browser.
revoke all on function public.record_stripe_payment(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.record_job_payment(uuid, numeric, text, text, text)    from public, anon, authenticated;
grant execute on function public.record_stripe_payment(uuid, numeric, text, text, text) to service_role;
grant execute on function public.record_job_payment(uuid, numeric, text, text, text)    to service_role;
