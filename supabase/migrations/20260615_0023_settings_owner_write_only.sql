-- ============================================================
-- Balenco — migration 23: company settings are owner/admin-WRITE only.
-- Previously the settings policy (org_members_all) let ANY org member update
-- company settings — so an employee could overwrite the tax numbers (TPS/TVQ),
-- RBQ/NEQ, logo or terms. Reads stay org-wide (employees still need company
-- info rendered on estimates/invoices); inserts/updates/deletes now require
-- the caller to be owner or admin of the org.
-- The handle_new_user trigger seeds settings as SECURITY DEFINER, so initial
-- provisioning is unaffected by this RLS change.
-- ============================================================

drop policy if exists org_members_all on public.settings;

create policy settings_org_read on public.settings
  for select to authenticated
  using (org_id = public.current_org_id());

create policy settings_admin_write on public.settings
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('owner','admin')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('owner','admin')
  );
