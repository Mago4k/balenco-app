-- Rollback for 0054. Written after the fact — the migration shipped without one,
-- which was an oversight on my part, not a decision.
--
-- ⚠ READ THIS BEFORE RUNNING IT. 0054 is the only thing stopping the two
-- Stripe-facing payment RPCs from recording money that cannot be right: a zero or
-- negative amount from malformed webhook metadata, and two concurrent checkouts on
-- the same balance both completing (different session ids, so idempotency does not
-- catch them) and recording twice. Reverting re-opens both. A $13,797 estimate can
-- end up with $19,594 recorded against it, reading "paid in full".
--
-- There is no sane reason to run this on its own. It exists so the pair
-- (migration, rollback) is complete and so a full-stack revert to a pre-0054 state
-- is possible. If a guard is misfiring, fix the guard rather than remove it.
--
-- This restores the 0004 / 0031 bodies: row lock and session-id idempotency kept,
-- amount checks removed.

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
as $$
declare
  v_payments jsonb;
begin
  select coalesce(payments, '[]'::jsonb) into v_payments
    from public.estimates where id = p_estimate_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_payments) e
    where e->>'stripe_session' = p_session
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
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
end $$;

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
as $$
declare
  v_payments jsonb;
begin
  select coalesce(payments, '[]'::jsonb) into v_payments
    from public.jobs where id = p_job_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

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
end $$;
