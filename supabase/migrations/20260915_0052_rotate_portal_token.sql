-- 0052 — let a contractor revoke a client's portal link.
--
-- clients.portal_token is a 244-bit bearer credential (migration 0020): whoever
-- holds the link sees that client's full billing history — every estimate, every
-- job, every recorded payment, their contact details — with no login. Entropy was
-- never the problem. Lifecycle was: the token is emailed, so it lives in mailboxes
-- and forwarded threads permanently, it covers every FUTURE estimate and job for
-- that client as well as past ones, and there was no way to revoke it. Migration
-- 0042 built exactly this for the lead-intake key and stopped there.
--
-- SECURITY INVOKER on purpose. The UPDATE runs as the caller, so the existing RLS
-- policy on `clients` decides who may rotate what — an owner any client in their
-- org, an employee only the clients they own. That reuses the isolation rules
-- already in force instead of inventing a second, parallel permission check that
-- could drift from them.
create or replace function public.rotate_portal_token(p_client_id uuid)
returns text
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_token text;
begin
  -- Same shape as the column default in 0020: two hyphen-stripped UUIDs, 64 hex.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  update public.clients
     set portal_token = v_token
   where id = p_client_id;

  -- RLS makes an unauthorised row simply invisible, so a rejected rotation looks
  -- identical to a missing one. Fail loudly either way rather than handing back a
  -- token that was never actually stored.
  if not found then
    raise exception 'Client not found, or you do not have permission to reset its link.';
  end if;

  return v_token;
end
$function$;

revoke all on function public.rotate_portal_token(uuid) from public, anon;
grant execute on function public.rotate_portal_token(uuid) to authenticated;
