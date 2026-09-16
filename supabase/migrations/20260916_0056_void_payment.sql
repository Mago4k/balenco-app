-- 0056 — remove a payment that was recorded in error.
--
-- THE GAP
-- Payments could be added and never taken back. Every consumer treats the
-- `payments` jsonb array as the truth — balances, the client portal, invoices,
-- the accounting CSV, the revenue report — so a fat-fingered amount is wrong in
-- all of them, forever, and the client can see it. Live example: one estimate
-- carries $9,776.88 in payments against a $9,772.88 total, and the client's
-- portal has been showing that $4.00 overpayment for months with nothing in the
-- app able to correct it.
--
-- WHY REMOVE RATHER THAN FLAG AS VOID
-- A `voided: true` flag would have to be honoured by every one of those readers,
-- in the app and in four edge functions, and any one that missed it would keep
-- counting the money. Removing the element keeps all of them correct with no
-- changes. The audit trail goes to `logs` instead: the function returns the row
-- it removed so the caller can record exactly what was taken out, by whom.
--
-- SECURITY INVOKER, like record_manual_payment: RLS decides whose rows these are.
-- An owner reaches their org's records, an employee only the ones they created
-- (0049), and a miss returns not_found rather than silently doing nothing.
--
-- Deliberately NOT guarded against removing a Stripe-originated row. Removing one
-- here does not refund the card, but "I refunded them in Stripe and the app still
-- counts it" is a real case, and the caller is made to confirm that explicitly.

create or replace function public.void_payment(
  p_kind       text,
  p_id         uuid,
  p_payment_id uuid,
  p_by         text default ''
) returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_payments jsonb;
  v_removed  jsonb;
  v_kept     jsonb;
  v_hit      int;
begin
  if p_kind not in ('estimate', 'job') then
    raise exception 'void_payment: p_kind must be estimate or job (got %)', p_kind;
  end if;

  -- Lock the row first: a concurrent record_manual_payment on the same record
  -- reads the array, appends and writes it back, so an unlocked read-modify-write
  -- here could drop the payment that landed in between.
  if p_kind = 'job' then
    select coalesce(payments, '[]'::jsonb) into v_payments
      from public.jobs where id = p_id for update;
  else
    select coalesce(payments, '[]'::jsonb) into v_payments
      from public.estimates where id = p_id for update;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select e into v_removed
    from jsonb_array_elements(v_payments) e
   where e->>'id' = p_payment_id::text
   limit 1;

  -- Already gone. Idempotent so a double-tap or a retry is harmless.
  if v_removed is null then
    return jsonb_build_object('ok', true, 'removed', false);
  end if;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_kept
    from jsonb_array_elements(v_payments) e
   where e->>'id' <> p_payment_id::text;

  if p_kind = 'job' then
    update public.jobs set payments = v_kept, updated_by = coalesce(nullif(p_by, ''), updated_by), updated_at = now()
     where id = p_id;
  else
    update public.estimates set payments = v_kept, updated_by = coalesce(nullif(p_by, ''), updated_by), updated_at = now()
     where id = p_id;
  end if;

  get diagnostics v_hit = row_count;
  -- The SELECT ... FOR UPDATE above already passed RLS, so this should never be
  -- zero; report it rather than claim a removal that did not happen.
  if v_hit = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_updated');
  end if;

  return jsonb_build_object('ok', true, 'removed', true, 'payment', v_removed);
end $$;

revoke all on function public.void_payment(text, uuid, uuid, text) from public, anon;
grant execute on function public.void_payment(text, uuid, uuid, text) to authenticated;

comment on function public.void_payment(text, uuid, uuid, text) is
  'Remove one payment from an estimate or job by payment id. SECURITY INVOKER: RLS decides reachability. Idempotent; returns the removed row so the caller can log it.';
