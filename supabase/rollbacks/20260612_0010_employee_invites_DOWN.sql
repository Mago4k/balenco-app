-- Rollback for migration 10: revert trigger to the no-join version, drop the
-- org policies and the join_token column.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_company text; v_name text;
begin
  v_company := coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), 'My Company');
  v_name    := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  insert into public.orgs (name) values (v_company) returning id into v_org;
  insert into public.profiles (id, name, role, org_id, email)
    values (new.id, v_name, 'owner', v_org, new.email) on conflict (id) do nothing;
  insert into public.settings (id, org_id, company, email)
    values (v_org::text, v_org, v_company, new.email) on conflict (org_id) do nothing;
  return new;
end $$;

drop policy if exists "org_members_read_own" on public.orgs;
drop policy if exists "org_owners_update_own" on public.orgs;
alter table public.orgs drop column if exists join_token;
