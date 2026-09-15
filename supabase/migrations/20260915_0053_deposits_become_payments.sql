-- 0053 — stop treating a deposit as money received.
--
-- THE DEFECT
-- `owing = total - deposit - payments` subtracted the deposit the moment an
-- estimate was Accepted, and stripe-webhook's deposit branch only flipped the
-- status — it never called record_stripe_payment. So:
--   * a deposit that WAS paid left no ledger row (no date, no session id, nothing
--     in the accounting CSV), and
--   * a deposit that was NOT paid was indistinguishable from one that was.
-- Worse, create-payment-checkout capped payment at `total - deposit - paid`, so
-- the uncollected deposit was literally UNREACHABLE by card afterwards — the
-- client got "exceeds remaining balance". The mirror failure was just as easy:
-- record the e-transfer by hand and it got subtracted twice.
--
-- THE MODEL FROM HERE
-- `deposit` stays on the record as the amount REQUESTED — it still prints on the
-- quote ("Acompte / Solde après acompte"), which is useful and true. It is no
-- longer subtracted from the balance. Only rows in `payments` reduce what is
-- owed, and every real deposit now lands there like any other payment.
--
-- THIS BACKFILL
-- Existing records were written under the old meaning: the app has been asserting
-- all along that these deposits were received. Converting each into an explicit
-- payment row preserves every current balance EXACTLY while making the claim
-- auditable instead of implicit. Verified against live data before applying:
--   EST-1001  total 9,772.88  owing 0        -> 0        (payments 6,778.88 + 2,998)
--   JOB-1001  total 6,783.53  owing 1,033.53 -> 1,033.53 (payments 3,750 + 2,000)
--   JOB-1002  total 4,656.49  owing 0        -> 0        (payments 2,656.49 + 2,000)
--
-- ⚠️ If any of these deposits was in fact NEVER received, delete that payment row
-- — it is tagged `"migrated":true` and noted 'Acompte' so it is easy to find:
--     select id, title, payments from public.estimates
--      where payments @> '[{"migrated":true}]';
--
-- Idempotent: skips any record that already carries a migrated deposit row.

-- ── Estimates ───────────────────────────────────────────────────────────────
update public.estimates
   set payments = coalesce(payments, '[]'::jsonb) || jsonb_build_array(
         jsonb_build_object(
           'id',       gen_random_uuid()::text,
           'amount',   deposit,
           'note',     'Acompte',
           'date',     coalesce(approved_at, created_at, now()),
           'by',       'System',
           'migrated', true
         ))
 where coalesce(deposit, 0) > 0
   and not coalesce(payments, '[]'::jsonb) @> '[{"migrated":true}]'::jsonb;

-- ── Jobs ────────────────────────────────────────────────────────────────────
update public.jobs
   set payments = coalesce(payments, '[]'::jsonb) || jsonb_build_array(
         jsonb_build_object(
           'id',       gen_random_uuid()::text,
           'amount',   deposit,
           'note',     'Acompte',
           'date',     coalesce(created_at, now()),
           'by',       'System',
           'migrated', true
         ))
 where coalesce(deposit, 0) > 0
   and not coalesce(payments, '[]'::jsonb) @> '[{"migrated":true}]'::jsonb;
