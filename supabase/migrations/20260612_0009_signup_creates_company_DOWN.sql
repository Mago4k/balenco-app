-- Rollback for migration 9
drop trigger   if exists on_auth_user_created on auth.users;
drop function  if exists public.handle_new_user();
alter table public.settings drop constraint if exists settings_org_id_key;
