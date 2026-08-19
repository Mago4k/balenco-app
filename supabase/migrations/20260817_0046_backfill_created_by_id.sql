-- ============================================================
-- Balenco — migration 46 (A2 of the ownership-by-user-id plan).
-- Backfill created_by_id from the existing display name.
--
-- Safe to join on (org_id, name) precisely because migration 0029 added
-- `unique (profiles.org_id, name)` — within one org a name resolves to exactly
-- one profile. That index becomes droppable once RLS keys on the uuid (0049);
-- this migration is the last thing that depends on it.
--
-- Rows whose created_by does NOT match a profile keep created_by_id NULL:
--   'System'          — generate-recurring-jobs
--   'Online Booking'  — create-booking
--   '<source> Lead Ad'— lead-intake
--   the client's own name — create-booking writes the booker's name on the
--                           appointment row, which under NAME-based RLS leaks
--                           that row to any employee sharing the name. Leaving
--                           it NULL is the fix.
--   departed staff whose profile was already deleted
-- NULL = owner-only, which reproduces today's behaviour for all of these.
--
-- Idempotent (guarded on created_by_id is null), so it is safe to re-run.
-- ============================================================

update public.clients c set created_by_id = p.id
  from public.profiles p
 where p.org_id = c.org_id and p.name = c.created_by and c.created_by_id is null;

update public.leads l set created_by_id = p.id
  from public.profiles p
 where p.org_id = l.org_id and p.name = l.created_by and l.created_by_id is null;

update public.estimates e set created_by_id = p.id
  from public.profiles p
 where p.org_id = e.org_id and p.name = e.created_by and e.created_by_id is null;

update public.appointments a set created_by_id = p.id
  from public.profiles p
 where p.org_id = a.org_id and p.name = a.created_by and a.created_by_id is null;

update public.photos ph set created_by_id = p.id
  from public.profiles p
 where p.org_id = ph.org_id and p.name = ph.created_by and ph.created_by_id is null;

update public.jobs j set created_by_id = p.id
  from public.profiles p
 where p.org_id = j.org_id and p.name = j.created_by and j.created_by_id is null;

update public.logs lg set user_id = p.id
  from public.profiles p
 where p.org_id = lg.org_id and p.name = lg.user_name and lg.user_id is null;
