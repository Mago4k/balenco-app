-- Rollback for 0056. Drops the correction RPC; payments already removed by it
-- stay removed (the log lines in `logs` are the record of what was taken out).
-- The UI's Remove buttons then fail with "function does not exist" until the
-- matching frontend is rolled back too.
drop function if exists public.void_payment(text, uuid, uuid, text);
