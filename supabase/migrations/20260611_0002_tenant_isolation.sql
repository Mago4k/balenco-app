-- ============================================================
-- Balenco hardening — migration 2: tenant isolation (authenticated users)
--
-- BEFORE: any logged-in user could read/write EVERY org's data
--         (policies "Authenticated users can manage *" + "auth_all" = USING true).
-- AFTER:  a logged-in user can only touch rows in their own org.
--
-- The no-login client portal keeps working: the existing "Public can …"
-- policies are narrowed from role `public` (which also covered logged-in
-- users and thus loosened them) to role `anon` only. The remaining anonymous
-- full-table read is closed in a later step, once the portal is moved behind
-- edge functions.
-- ============================================================

-- Recursion-safe helper: the current user's org_id, read with definer rights
-- so org-scoped policies don't recurse through profiles' own RLS.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select org_id from public.profiles where id = auth.uid() $$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated, anon;

-- ---- Drop the wide-open authenticated policies ----
drop policy if exists "Authenticated users can manage clients"      on public.clients;
drop policy if exists "auth_all"                                    on public.clients;
drop policy if exists "Authenticated users can manage leads"        on public.leads;
drop policy if exists "auth_all"                                    on public.leads;
drop policy if exists "Authenticated users can manage estimates"    on public.estimates;
drop policy if exists "auth_all"                                    on public.estimates;
drop policy if exists "Authenticated users can manage appointments" on public.appointments;
drop policy if exists "auth_all"                                    on public.appointments;
drop policy if exists "Authenticated users can manage photos"       on public.photos;
drop policy if exists "auth_all"                                    on public.photos;
drop policy if exists "Authenticated users can manage logs"         on public.logs;
drop policy if exists "auth_all"                                    on public.logs;
drop policy if exists "Authenticated users can read settings"       on public.settings;
drop policy if exists "Authenticated users can write settings"      on public.settings;
drop policy if exists "auth_all"                                    on public.settings;

-- ---- Per-org policies for the authenticated role ----
create policy "org_members_all" on public.clients      for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.leads        for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.estimates    for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.appointments for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.photos       for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.logs         for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
create policy "org_members_all" on public.settings     for all to authenticated
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- Narrow the portal policies from `public` to `anon` only ----
-- (keeps the no-login portal working, but stops them widening logged-in access)
drop policy if exists "Public can read clients" on public.clients;
create policy "anon_can_read_clients" on public.clients for select to anon using (true);

drop policy if exists "Public can read estimates" on public.estimates;
create policy "anon_can_read_estimates" on public.estimates for select to anon using (true);

drop policy if exists "Public can approve estimates" on public.estimates;
create policy "anon_can_approve_estimates" on public.estimates for update to anon
  using (status <> 'Accepted') with check (status = 'Accepted');

drop policy if exists "Public can read settings" on public.settings;
create policy "anon_can_read_settings" on public.settings for select to anon using (true);
