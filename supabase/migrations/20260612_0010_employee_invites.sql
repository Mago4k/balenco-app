-- ============================================================
-- Balenco — migration 10: employee invites. Each company gets a shareable
-- join token; signing up through it joins that company as an EMPLOYEE instead
-- of creating a new company.
-- ============================================================

-- Per-company invite token.
alter table public.orgs add column if not exists join_token uuid not null default gen_random_uuid();

-- Org members can read their own org (to show/copy the invite link); owners can
-- update it (rename / regenerate the token). Also clears the orgs RLS-no-policy lint.
drop policy if exists "org_members_read_own" on public.orgs;
create policy "org_members_read_own" on public.orgs for select to authenticated
  using (id = public.current_org_id());

drop policy if exists "org_owners_update_own" on public.orgs;
create policy "org_owners_update_own" on public.orgs for update to authenticated
  using (id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (id = public.current_org_id());

-- Signup: a valid join_token -> join that company as employee; otherwise create
-- a new company as owner (unchanged path).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_company text;
  v_name    text;
  v_join    uuid;
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  begin
    v_join := nullif(new.raw_user_meta_data->>'join_token', '')::uuid;
  exception when others then
    v_join := null;
  end;

  if v_join is not null then
    select id into v_org from public.orgs where join_token = v_join;
    if v_org is not null then
      insert into public.profiles (id, name, role, org_id, email)
        values (new.id, v_name, 'employee', v_org, new.email)
        on conflict (id) do nothing;
      return new;
    end if;
  end if;

  v_company := coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), 'My Company');
  insert into public.orgs (name) values (v_company) returning id into v_org;
  insert into public.profiles (id, name, role, org_id, email)
    values (new.id, v_name, 'owner', v_org, new.email)
    on conflict (id) do nothing;
  insert into public.settings (id, org_id, company, email)
    values (v_org::text, v_org, v_company, new.email)
    on conflict (org_id) do nothing;
  return new;
end $$;
