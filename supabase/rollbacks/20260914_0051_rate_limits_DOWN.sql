-- Rollback for 0051. Removes rate limiting from the public endpoints.
--
-- create-booking calls check_rate_limit and treats an RPC error as "allow"
-- (fail open, so a database hiccup can never block a real customer booking an
-- appointment). Dropping the function therefore degrades gracefully rather than
-- breaking booking — but it does leave the endpoint unthrottled again.

drop function if exists public.check_rate_limit(text, integer, integer);
drop table if exists public.rate_limits;
