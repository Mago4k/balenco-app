-- 0049 — A5: key record ownership on the user's UUID instead of their display name.
--
-- This is the step SCOPE-ownership-and-roles.md calls "the risky one": it is the
-- only migration in the 0045-0049 sequence that changes what people can SEE.
-- 0045 (columns) / 0046 (backfill) / 0047 (insert triggers) were all no-ops by
-- design and left BOTH keys valid at once, so this flip is the single switch.
--
-- WHY
-- Isolation keyed on `created_by = current_user_name()` (migration 0011), and
-- current_user_name() is just `select name from profiles where id = auth.uid()`.
-- Three consequences, all live until now:
--   1. An employee could rename their own profile to a label no profile uses --
--      'System' (generate-recurring-jobs), 'Online Booking' (create-booking),
--      '<source> Lead Ad' (lead-intake) -- and inherit those records with read
--      AND write, since the policies are FOR ALL. Reproduced in a rolled-back
--      transaction on 2026-09-13: the employee saw 0 clients normally and 1
--      after the rename. Migration 0048 blocks the rename itself; this removes
--      the mechanism.
--   2. Deleting a departed employee freed their name, so anyone signing up with
--      that exact name inherited every record they had created.
--   3. create-booking writes `created_by: <the CLIENT's name>`, so an employee
--      sharing a name with a booker could see that appointment.
--
-- WHAT CHANGES IN PRACTICE
-- Rows with created_by_id IS NULL become owner-only. Those are exactly the
-- service-role rows (crons, webhooks, online bookings, lead-ads) -- auth.uid()
-- is null there, so 0047's trigger deliberately leaves the column NULL. That
-- reproduces today's behaviour, because 'System' never matched an employee name
-- anyway. Backfill verified immediately before applying: 0 NULLs across
-- clients / leads / estimates / appointments / photos / jobs / logs.
--
-- ORDERING NOTE
-- Postgres evaluates a BEFORE trigger before the RLS WITH CHECK, so 0047's
-- set_created_by_id (which forces created_by_id = auth.uid() for non-owners, and
-- fills NULL for owners) runs first and the row then satisfies the new check.
-- Spoofing created_by_id from the client is therefore not possible.
--
-- `created_by` (text) stays exactly as it is: it remains the human-readable
-- provenance label shown in the UI and written by the edge functions. Only the
-- ownership KEY moves. Nothing about this migration is visible to an owner.
--
-- auth.uid() is wrapped in (select ...) so Postgres evaluates it once per query
-- rather than once per row -- this also clears the advisor's auth_rls_initplan
-- warning for these tables.

-- ── The six record tables ───────────────────────────────────────────────────
drop policy if exists org_members_all on public.clients;
create policy org_members_all on public.clients for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

drop policy if exists org_members_all on public.leads;
create policy org_members_all on public.leads for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

drop policy if exists org_members_all on public.estimates;
create policy org_members_all on public.estimates for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

drop policy if exists org_members_all on public.appointments;
create policy org_members_all on public.appointments for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

drop policy if exists org_members_all on public.photos;
create policy org_members_all on public.photos for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

drop policy if exists org_members_all on public.jobs;
create policy org_members_all on public.jobs for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by_id = (select auth.uid())));

-- ── logs: same model, keyed on user_id (0045 added it, 0047 stamps it) ──────
drop policy if exists org_members_all on public.logs;
create policy org_members_all on public.logs for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_id = (select auth.uid())))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_id = (select auth.uid())));

-- ── Index the FKs these policies now filter on ──────────────────────────────
-- 0045 created (org_id, created_by_id) composites, which lead with org_id and so
-- do not serve the FK's own lookup. Without these, every profile DELETE (i.e.
-- every future "remove from team") sequential-scans seven tables to apply
-- ON DELETE SET NULL. `if not exists` keeps this re-runnable.
create index if not exists clients_created_by_id_idx      on public.clients(created_by_id);
create index if not exists leads_created_by_id_idx        on public.leads(created_by_id);
create index if not exists estimates_created_by_id_idx    on public.estimates(created_by_id);
create index if not exists appointments_created_by_id_idx on public.appointments(created_by_id);
create index if not exists photos_created_by_id_idx       on public.photos(created_by_id);
create index if not exists jobs_created_by_id_idx         on public.jobs(created_by_id);
create index if not exists logs_user_id_idx               on public.logs(user_id);
