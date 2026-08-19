-- ============================================================
-- Balenco — migration 47 (A4 of the ownership-by-user-id plan).
-- Stamp created_by_id server-side instead of trusting the browser.
--
-- Today the frontend SENDS created_by on all ~10 insert sites. The ownership
-- key should never be client-supplied, so from here the database stamps it.
--
-- Rules:
--   * auth.uid() IS NULL (service_role: edge functions, crons) -> leave NULL.
--     Those rows stay owner-only, matching how 'System' / 'Online Booking'
--     rows behave today.
--   * Non-owners -> ALWAYS forced to auth.uid(). Spoofing another member's
--     ownership on insert becomes impossible regardless of what RLS allows.
--   * Owners -> an explicitly supplied created_by_id is respected, so the
--     restore-from-backup path (index.html) can preserve original ownership
--     once the frontend starts sending it. NULL still defaults to the owner.
--
-- Still no behaviour change: RLS keys on the name until migration 0048.
-- ============================================================

create or replace function public.set_created_by_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.created_by_id is null or public.current_user_role() <> 'owner' then
    new.created_by_id := auth.uid();
  end if;
  return new;
end $$;

-- logs names its actor column user_id.
create or replace function public.set_log_user_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.user_id is null or public.current_user_role() <> 'owner' then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists set_created_by_id on public.clients;
create trigger set_created_by_id before insert on public.clients
  for each row execute function public.set_created_by_id();

drop trigger if exists set_created_by_id on public.leads;
create trigger set_created_by_id before insert on public.leads
  for each row execute function public.set_created_by_id();

drop trigger if exists set_created_by_id on public.estimates;
create trigger set_created_by_id before insert on public.estimates
  for each row execute function public.set_created_by_id();

drop trigger if exists set_created_by_id on public.appointments;
create trigger set_created_by_id before insert on public.appointments
  for each row execute function public.set_created_by_id();

drop trigger if exists set_created_by_id on public.photos;
create trigger set_created_by_id before insert on public.photos
  for each row execute function public.set_created_by_id();

drop trigger if exists set_created_by_id on public.jobs;
create trigger set_created_by_id before insert on public.jobs
  for each row execute function public.set_created_by_id();

drop trigger if exists set_log_user_id on public.logs;
create trigger set_log_user_id before insert on public.logs
  for each row execute function public.set_log_user_id();
