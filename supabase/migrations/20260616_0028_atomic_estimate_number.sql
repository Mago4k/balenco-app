-- ============================================================
-- Balenco — migration 28: make per-org estimate numbering atomic.
-- The assign_estimate_number() trigger (migration 13) computed
-- coalesce(max(estimate_number),1000)+1 in a BEFORE INSERT under READ
-- COMMITTED. Two concurrent inserts (or a double-tapped Save) could read
-- the same max and collide; the unique index rejected the second, but the
-- client had already shown it as saved, so it vanished on reload.
-- Take a per-org transaction-scoped advisory lock before reading the max so
-- number assignment for a given org is serialized. Lock is released on
-- commit/rollback. No data change; just replaces the function body.
-- ============================================================

create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estimate_number is null and new.org_id is not null then
    -- Serialize numbering per org so concurrent inserts can't read the same max().
    perform pg_advisory_xact_lock(hashtext('balenco_estnum_' || new.org_id::text)::bigint);
    select coalesce(max(estimate_number), 1000) + 1
      into new.estimate_number
      from public.estimates
     where org_id = new.org_id;
  end if;
  return new;
end $$;

revoke execute on function public.assign_estimate_number() from public, anon, authenticated;
