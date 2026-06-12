-- ============================================================
-- Balenco — migration 9: onboarding. A new signup auto-provisions its own
-- company (org), an owner profile, and a settings row — so contractors can
-- self-serve and land in an isolated tenant.
-- ============================================================

-- One settings row per org (lets the app read/write settings by org_id).
alter table public.settings
  add constraint settings_org_id_key unique (org_id);

-- On auth signup: create org + owner profile + default settings.
-- Company + name come from the signUp metadata (raw_user_meta_data).
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
begin
  v_company := coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), 'My Company');
  v_name    := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  insert into public.orgs (name) values (v_company) returning id into v_org;

  insert into public.profiles (id, name, role, org_id, email)
    values (new.id, v_name, 'owner', v_org, new.email)
    on conflict (id) do nothing;

  insert into public.settings (id, org_id, company, email)
    values (v_org::text, v_org, v_company, new.email)
    on conflict (org_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
