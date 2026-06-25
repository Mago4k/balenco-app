-- DOWN for migration 32. Drops the manual-payment RPC. The trigger-function grant revokes are
-- intentional security hardening and are NOT reversed here (re-granting anon would re-open the
-- /rest/v1/rpc surface the advisor flagged).
drop function if exists public.record_manual_payment(text, uuid, uuid, numeric, text, text);
