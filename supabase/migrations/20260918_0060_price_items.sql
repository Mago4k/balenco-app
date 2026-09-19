-- 0060 — a price book, so a quote is assembled rather than retyped.
--
-- THE GAP
-- Line items were typed from scratch every time. A contractor who installs the
-- same vanity, charges the same hourly rate and buys the same 4x8 sheet of gypse
-- forty times a year typed all forty of them, and priced them from memory — which
-- is where quotes quietly drift and margin leaks.
--
-- SHAPE
-- Deliberately small. description + unit_price is the whole idea; `unit` is a
-- label that rides along on the description line, and `times_used` exists so the
-- items someone actually reaches for float to the top of the suggestions instead
-- of being buried alphabetically.
--
-- No link to estimates or jobs. A price book entry is a template, not a record of
-- anything — editing tonight's price must never reach back and change what a
-- client was quoted in March. Line items stay copied by value into the record,
-- exactly as they are today.

create table if not exists public.price_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  description   text not null,
  unit          text not null default '',
  unit_price    numeric(12,2) not null default 0,
  times_used    integer not null default 0,
  last_used_at  timestamptz,
  created_by    text not null default '',
  created_by_id uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint price_items_price_not_negative check (unit_price >= 0),
  constraint price_items_description_not_blank check (length(btrim(description)) > 0)
);

-- The price book belongs to the COMPANY, not to whoever typed the entry: an
-- employee writing a quote needs the same prices the owner would use. So this is
-- org-wide read/write, unlike jobs and estimates which are scoped per creator
-- under 0049. Nothing here is client data.
alter table public.price_items enable row level security;

drop policy if exists org_members_all on public.price_items;
create policy org_members_all on public.price_items
  for all to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

drop trigger if exists set_created_by_id on public.price_items;
create trigger set_created_by_id before insert on public.price_items
  for each row execute function public.set_created_by_id();

-- One entry per description per org. Case- and whitespace-insensitive, because
-- "4x8 Gypse" and "4x8 gypse " are the same line to a human and two entries in a
-- list is exactly the mess a price book is supposed to prevent.
create unique index if not exists price_items_org_desc_uidx
  on public.price_items (org_id, lower(btrim(description)));

-- Suggestions are ordered most-used first.
create index if not exists price_items_org_used_idx
  on public.price_items (org_id, times_used desc, description);

comment on table public.price_items is
  'Reusable line items. A template only — never linked to an estimate or job, so editing a price cannot change what a client was already quoted.';
