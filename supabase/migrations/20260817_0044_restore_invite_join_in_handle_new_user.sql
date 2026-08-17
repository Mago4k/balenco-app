-- 0044 — REGRESSION FIX: employee-invite join restored in handle_new_user
-- (applied live 2026-08-17; the live migration entry has an earlier draft —
-- this file is the corrected final version, re-applied the same day).
--
-- The join branch (originally migration 0010) was lost when handle_new_user
-- was later rewritten (default-terms change) — since then EVERY signup,
-- invited or not, created its own new org as owner. The frontend was always
-- correct: invited signups send join_token in the signup metadata; the
-- trigger just ignored it. Found when Carlos's teammate used the invite link
-- and ended up with an independent "My Company" owner account (repaired by
-- hand: profile moved to the Balenco org as employee, stray org deleted).
--
-- Restored behavior:
--   * join_token present + matches an org  -> employee profile in that org
--     (no new org, no settings row, no trial — the org already has them).
--   * join_token present but unknown/stale -> RAISE (signup fails visibly).
--     Never silently create a wrong owner account again.
--   * no join_token -> unchanged: new org + owner + settings.
--
-- NOTE: orgs.join_token is uuid — compare as ::text so a malformed token
-- can't error the cast.
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
  v_join    text;
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  v_join := nullif(trim(new.raw_user_meta_data->>'join_token'), '');

  if v_join is not null then
    select id into v_org from public.orgs where join_token::text = v_join;
    if v_org is null then
      raise exception 'Invalid or expired invite link — ask for a new one';
    end if;
    insert into public.profiles (id, name, role, org_id, email)
      values (new.id, v_name, 'employee', v_org, new.email)
      on conflict (id) do nothing;
    return new;
  end if;

  v_company := coalesce(nullif(trim(new.raw_user_meta_data->>'company'), ''), 'My Company');

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
