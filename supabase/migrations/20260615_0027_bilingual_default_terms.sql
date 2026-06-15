-- ============================================================
-- Balenco — migration 27: bilingual default estimate terms (FR + EN).
-- The fine print is the contractor's own content, so it can't auto-translate
-- with the UI toggle. Default it to BOTH languages so it reads correctly for any
-- client (French or English). Switches any org still on the FR-only or EN-only
-- default; customized terms are left untouched.
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
      E'Soumission valide 15 jours. Acompte requis avant la planification. Les conditions cachées, les permis et les travaux supplémentaires ne sont pas inclus sauf indication contraire.\n\nEstimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.'
    )
    on conflict (org_id) do nothing;

  return new;
end $function$;

-- Switch any org still on a single-language default to the bilingual one.
update public.settings
set terms = E'Soumission valide 15 jours. Acompte requis avant la planification. Les conditions cachées, les permis et les travaux supplémentaires ne sont pas inclus sauf indication contraire.\n\nEstimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.'
where terms in (
  'Soumission valide 15 jours. Acompte requis avant la planification. Les conditions cachées, les permis et les travaux supplémentaires ne sont pas inclus sauf indication contraire.',
  'Estimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.'
);
