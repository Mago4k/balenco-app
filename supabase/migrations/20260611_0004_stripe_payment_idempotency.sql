-- ============================================================
-- Balenco hardening — migration 4: atomic, idempotent Stripe payments
--
-- Replaces the webhook's read-modify-write on estimates.payments (which can
-- double-record or clobber on Stripe's at-least-once / retried deliveries)
-- with a single locked, dedup-by-session operation.
-- ============================================================

create or replace function public.record_stripe_payment(
  p_estimate_id uuid,
  p_amount      numeric,
  p_session     text,
  p_by          text default 'Client (Stripe)',
  p_note        text default 'Online payment'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payments jsonb;
begin
  -- lock the estimate row so concurrent webhook deliveries serialize
  select coalesce(payments, '[]'::jsonb) into v_payments
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

-- Only the service role (the webhook) may call this — never anon/authenticated.
revoke all on function public.record_stripe_payment(uuid,numeric,text,text,text) from public;
grant execute on function public.record_stripe_payment(uuid,numeric,text,text,text) to service_role;
