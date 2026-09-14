-- Rollback for 0049 — restores name-keyed ownership (migration 0011's model).
--
-- This is the one step in 0045-0049 that is worth being able to revert quickly:
-- it is the only one that changes what people can see. Running this puts you
-- back exactly where you were before 2026-09-13, including the holes it closed
-- (employee self-rename into 'System' / 'Online Booking' / '<source> Lead Ad',
-- name reuse after a profile delete, and create-booking writing the client's
-- name into the ownership column).
--
-- Migration 0048's name guard stays in place and still blocks the rename, so
-- reverting only this migration is not immediately dangerous -- but the two were
-- designed as stopgap + permanent fix, so prefer fixing forward.
--
-- The created_by_id columns, their backfill and the insert triggers are left
-- alone: they are inert under name-keyed policies, and dropping them would mean
-- re-running the backfill to come back.

drop policy if exists org_members_all on public.clients;
create policy org_members_all on public.clients for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.leads;
create policy org_members_all on public.leads for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.estimates;
create policy org_members_all on public.estimates for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.appointments;
create policy org_members_all on public.appointments for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.photos;
create policy org_members_all on public.photos for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.jobs;
create policy org_members_all on public.jobs for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists org_members_all on public.logs;
create policy org_members_all on public.logs for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_name = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_name = public.current_user_name()));

-- The indexes are harmless under either model; drop them only if you truly want
-- the pre-0049 state:
-- drop index if exists public.clients_created_by_id_idx;
-- drop index if exists public.leads_created_by_id_idx;
-- drop index if exists public.estimates_created_by_id_idx;
-- drop index if exists public.appointments_created_by_id_idx;
-- drop index if exists public.photos_created_by_id_idx;
-- drop index if exists public.jobs_created_by_id_idx;
-- drop index if exists public.logs_user_id_idx;
