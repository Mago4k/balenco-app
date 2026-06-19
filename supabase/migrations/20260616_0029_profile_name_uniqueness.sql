-- ============================================================
-- Balenco — migration 29: one name per org on profiles (stopgap).
-- Employee record-isolation (migration 11) keys on the employee's NAME
-- (created_by = current_user_name()). If two profiles in the same org shared
-- a name, their record visibility would merge. Names are assigned once at
-- signup (handle_new_user) and the app exposes no name-edit UI, so a unique
-- index per org is a safe stopgap until a stable user-id key is introduced.
-- Verified there are no existing (org_id, name) duplicates before adding.
-- ============================================================

create unique index if not exists profiles_org_name_uniq
  on public.profiles (org_id, name);
