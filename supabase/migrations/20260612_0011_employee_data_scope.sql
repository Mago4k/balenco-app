-- ============================================================
-- Balenco — migration 11: employee data lockdown.
-- Employees can only read/write rows THEY created; owners see the whole
-- company. Previously every org member could read all org rows (the
-- per-employee filter was client-side only). Now it's enforced in the DB.
-- ============================================================

-- Recursion-safe helper: the current user's display name (matches created_by).
create or replace function public.current_user_name()
returns text
language sql
stable
security definer
set search_path = public
as $$ select name from public.profiles where id = auth.uid() $$;

revoke all on function public.current_user_name() from public;
grant execute on function public.current_user_name() to authenticated;

-- created_by-scoped tables: owner sees all org rows, employee only own.
drop policy if exists "org_members_all" on public.clients;
create policy "org_members_all" on public.clients for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists "org_members_all" on public.leads;
create policy "org_members_all" on public.leads for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists "org_members_all" on public.estimates;
create policy "org_members_all" on public.estimates for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists "org_members_all" on public.appointments;
create policy "org_members_all" on public.appointments for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

drop policy if exists "org_members_all" on public.photos;
create policy "org_members_all" on public.photos for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or created_by = public.current_user_name()));

-- logs use user_name as the actor column.
drop policy if exists "org_members_all" on public.logs;
create policy "org_members_all" on public.logs for all to authenticated
  using      (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_name = public.current_user_name()))
  with check (org_id = public.current_org_id() and (public.current_user_role() = 'owner' or user_name = public.current_user_name()));
