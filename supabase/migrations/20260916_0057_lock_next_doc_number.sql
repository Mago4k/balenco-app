-- 0057 — stop anyone on the internet burning a contractor's invoice numbers.
--
-- THE HOLE
-- 0055 added next_doc_number(p_org_id, p_kind) as SECURITY DEFINER and left the
-- default EXECUTE grant in place, so PostgREST exposed it at
-- /rest/v1/rpc/next_doc_number to `public`, which includes `anon`. It takes the
-- org as a PARAMETER and never checks it against the caller, so with nothing but
-- the publishable key that ships in the page source:
--
--   POST /rest/v1/rpc/next_doc_number {"p_org_id":"<any org>","p_kind":"estimate"}
--   -> 1001, 1002, 1003, ...
--
-- Verified live against a throwaway org id before this migration was written.
--
-- Each call permanently advances that org's counter. The counter is forward-only
-- by design -- that was the whole point of 0055 -- so the contractor cannot undo
-- it from the app: their next real invoice simply jumps, leaving a gap in a
-- document series that Revenu Québec expects to be unbroken. Org ids are not
-- secret either; portal-data returns client.org_id to anyone holding a client
-- portal link.
--
-- THE FIX
-- Nothing outside the database ever needs to call this. Its only callers are the
-- assign_estimate_number and assign_job_number BEFORE INSERT triggers, which are
-- themselves SECURITY DEFINER and run as the owner -- they do not consult the
-- caller's EXECUTE grant at all. So the grant can simply go.
--
-- Revoking from PUBLIC is the load-bearing line: `anon` and `authenticated`
-- inherit through it, and a future role would too.

revoke execute on function public.next_doc_number(uuid, text) from public;
revoke execute on function public.next_doc_number(uuid, text) from anon;
revoke execute on function public.next_doc_number(uuid, text) from authenticated;

-- service_role keeps it: the edge functions run as service_role, and a future
-- server-side document type should be able to draw a number.

comment on function public.next_doc_number(uuid, text) is
  'Draws the next per-org document number. NOT callable from the API: it trusts p_org_id, so an exposed grant lets anyone advance any org''s invoice series. Reached only through the assign_*_number SECURITY DEFINER triggers.';

-- Clean up the row left by the live exploit check above.
delete from public.doc_counters where org_id = '00000000-0000-4000-8000-0000deadbeef';
