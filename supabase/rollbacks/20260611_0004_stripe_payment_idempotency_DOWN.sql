-- Rollback for migration 4
drop function if exists public.record_stripe_payment(uuid,numeric,text,text,text);
