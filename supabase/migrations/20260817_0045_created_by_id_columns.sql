-- ============================================================
-- Balenco — migration 45 (A1 of the ownership-by-user-id plan).
-- Record isolation currently keys on the employee's DISPLAY NAME
-- (created_by = current_user_name(), migration 0011). That means deleting a
-- departed employee's profile frees their name, and anyone holding the invite
-- link can re-register under it and inherit every record they created.
--
-- This migration only ADDS the uuid ownership column. Nothing reads it yet —
-- RLS still keys on the name until migration 0048. Zero behaviour change.
--
-- `on delete set null`, never cascade: deleting a person must not delete their
-- clients. Their rows fall back to created_by_id IS NULL = owner-only, which is
-- exactly the same visibility that 'System' / 'Online Booking' rows have today.
--
-- created_by (text) is deliberately KEPT. It is overloaded — both the ownership
-- key and a human-readable provenance label that edge functions write
-- non-user values into ('System', 'Online Booking', '<source> Lead Ad') and that
-- portal-data selects. From here it is a DISPLAY LABEL ONLY.
-- ============================================================

alter table public.clients      add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
alter table public.leads        add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
alter table public.estimates    add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
alter table public.appointments add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
alter table public.photos       add column if not exists created_by_id uuid references public.profiles(id) on delete set null;
alter table public.jobs         add column if not exists created_by_id uuid references public.profiles(id) on delete set null;

-- logs uses user_name as the actor column, so its uuid sibling is user_id.
alter table public.logs         add column if not exists user_id uuid references public.profiles(id) on delete set null;

-- Match the (org_id, <actor>) shape the RLS policies will filter on.
create index if not exists clients_org_creator_idx      on public.clients      (org_id, created_by_id);
create index if not exists leads_org_creator_idx        on public.leads        (org_id, created_by_id);
create index if not exists estimates_org_creator_idx    on public.estimates    (org_id, created_by_id);
create index if not exists appointments_org_creator_idx on public.appointments (org_id, created_by_id);
create index if not exists photos_org_creator_idx       on public.photos       (org_id, created_by_id);
create index if not exists jobs_org_creator_idx         on public.jobs         (org_id, created_by_id);
create index if not exists logs_org_user_idx            on public.logs         (org_id, user_id);
