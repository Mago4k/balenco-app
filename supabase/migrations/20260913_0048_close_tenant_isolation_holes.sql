-- 0048 — close three tenant-isolation holes found in the 2026-09-10 audit.
--
-- All three are the same underlying story: something that was correct when
-- Balenco had one user became wrong once a second company existed.
--
-- Applied together because each is a few lines and none changes how the app
-- behaves for a legitimate user. Each section has its own revert in the _DOWN.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Stop anon from enumerating every tenant and their calendar.
--
-- `avail_public_read` was `FOR SELECT TO anon USING (true)` — no predicate. A
-- request carrying only the publishable key returned EVERY org's row. Verified
-- live before this migration: HTTP 200 plus every org_id, working days, hours
-- and slot length.
--
-- org_id IS the booking-link parameter (?book=<org_id>), so that list let anyone
-- walk every org through the public booking page and harvest each company's
-- name, logo and free/busy calendar — including orgs that never shared a link.
--
-- Safe to drop: it is dead code. get-slots and create-booking both build a
-- SERVICE-ROLE client, which bypasses RLS entirely. Nothing reads availability
-- over the anon path. `avail_org_manage` still covers authenticated access.
drop policy if exists avail_public_read on public.availability;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guard profiles.name, not just role and org_id.
--
-- Employee record isolation keys on the DISPLAY NAME:
--   created_by = current_user_name()   (migration 0011, still live on 7 tables)
-- and current_user_name() is just `select name from profiles where id = auth.uid()`.
--
-- guard_profile_update reverted org_id and role but left `name` writable, while
-- users_update_own_profile (0033) lets a user UPDATE their own row. So an
-- employee could PATCH their own profile name over the REST API and inherit
-- every row created under that name — with full read AND write, since the
-- policies are FOR ALL.
--
-- profiles_org_name_uniq (0029) blocks impersonating a live colleague. It does
-- NOT block 'System' (generate-recurring-jobs), 'Online Booking'
-- (create-booking) or '<source> Lead Ad' (lead-intake) — none are profile
-- names, and all three are written by shipped features.
--
-- Nothing legitimate regresses: there is no self-rename anywhere in the app.
-- The only frontend write to profiles is the owner's role toggle; names are set
-- once by handle_new_user at signup.
--
-- This is a stopgap. The permanent fix is the A5 flip to
-- created_by_id = auth.uid() — columns, backfill and insert triggers are
-- already in place from 0045-0047.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (new.org_id is distinct from old.org_id
      or new.role   is distinct from old.role
      or new.name   is distinct from old.name) then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'owner' and org_id = old.org_id
    ) then
      new.org_id := old.org_id;   -- silently revert escalation attempts
      new.role   := old.role;
      new.name   := old.name;     -- and ownership-key attempts
    end if;
  end if;
  return new;
end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Retire the legacy settings row keyed 'global'.
--
-- settings.id defaults to the literal 'global' (pre-multi-tenant schema). Four
-- server paths fall back to `.eq('id','global')` when a per-org settings lookup
-- returns nothing — portal-data, send-reminders, send-followups and
-- generate-recurring-jobs. The code comment in send-followups assumes that row
-- "has org_id null".
--
-- It does not. In production the id='global' row is the platform owner's OWN
-- settings (is_platform_owner = true). So the fallback resolves to a real
-- tenant: another contractor's client would be shown that company's name,
-- address, phone, logo, GST/QST/RBQ/NEQ registration numbers and — worst —
-- its payment_instructions, i.e. the wrong Interac address to send money to.
--
-- handle_new_user does seed a settings row per org, so the precondition is rare.
-- But settingsFor() reads only `r.data` and ignores `r.error`, so any transient
-- failure on the first query falls straight through to this row.
--
-- Repointing the id to the org uuid (the shape every other org already uses)
-- defuses it immediately: the fallback now matches nothing and resolves to empty
-- settings instead of another tenant's. The fallback code is removed from the
-- four functions alongside this migration.
--
-- Nothing references settings.id — the only FK on the table is settings_org_id_fkey.
update public.settings
   set id = org_id::text
 where id = 'global'
   and org_id is not null;

-- Stop new rows from inheriting the shared literal.
alter table public.settings alter column id drop default;
