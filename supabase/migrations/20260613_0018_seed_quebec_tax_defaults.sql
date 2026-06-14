-- ============================================================
-- Balenco — migration 18: seed Québec tax defaults on signup.
-- A new account previously seeded only company + email, leaving
-- tps/tvq/terms NULL — so a contractor's VERY FIRST estimate computed
-- TPS 0% / TVQ 0% and printed a legally-incomplete document.
-- Seed the standard Québec rates (5% / 9.975%) + the app's default
-- terms so the first estimate is correct out of the box. The
-- contractor can still edit all of these in Settings.
-- ============================================================

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

  insert into public.settings (id, org_id, company, email, tps, tvq, terms)
    values (
      v_org::text, v_org, v_company, new.email,
      5, 9.975,
      'Estimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.'
    )
    on conflict (org_id) do nothing;

  return new;
end $$;
