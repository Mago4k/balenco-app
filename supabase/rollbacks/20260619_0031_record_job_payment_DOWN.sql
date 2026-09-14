-- DOWN for migration 31: remove the job payment-recording function.
drop function if exists public.record_job_payment(uuid, numeric, text, text, text);
