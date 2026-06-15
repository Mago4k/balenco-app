-- ============================================================
-- Balenco — migration 26: French-first default estimate terms.
-- The signup trigger seeded the default "fine print" in English even though the
-- app is French-first (Québec). Seed it in French instead, and switch any org
-- still on the old English default over (leaves customized terms untouched).
-- ============================================================

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      'Soumission valide 15 jours. Acompte requis avant la planification. Les conditions cachées, les permis et les travaux supplémentaires ne sont pas inclus sauf indication contraire.'
    )
    on conflict (org_id) do nothing;

  return new;
end $function$;

-- Switch any org still on the old English default to the French default.
update public.settings
set terms = 'Soumission valide 15 jours. Acompte requis avant la planification. Les conditions cachées, les permis et les travaux supplémentaires ne sont pas inclus sauf indication contraire.'
where terms = 'Estimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.';
