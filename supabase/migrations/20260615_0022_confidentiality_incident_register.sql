-- ============================================================
-- Balenco — migration 22: confidentiality incident register (Law 25).
-- Québec's Law 25 requires an enterprise to keep a register of confidentiality
-- incidents (breaches involving personal information). One row per incident,
-- org-scoped so each tenant keeps its own durable register. Cascades with the
-- org so account deletion cleans it up.
-- ============================================================

create table if not exists public.confidentiality_incidents (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  occurred_at          timestamptz,                 -- when the incident happened
  reported_at          timestamptz not null default now(),  -- when it was logged
  description          text not null,               -- what happened
  affected_info        text,                         -- what personal info was involved
  people_affected      integer,                      -- number of individuals concerned
  risk_of_serious_harm text,                          -- risk-of-serious-injury assessment
  measures_taken       text,                          -- mitigation / containment
  cai_notified         boolean not null default false, -- Commission d'acces a l'information notified
  individuals_notified boolean not null default false, -- affected individuals notified
  status               text not null default 'open',  -- open | closed
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create index if not exists confidentiality_incidents_org_idx
  on public.confidentiality_incidents(org_id, reported_at desc);

alter table public.confidentiality_incidents enable row level security;

-- Any member of the org may read its own register.
drop policy if exists ci_org_read on public.confidentiality_incidents;
create policy ci_org_read on public.confidentiality_incidents
  for select to authenticated
  using (org_id = public.current_org_id());

-- Only owner/admin of the org may add, edit or remove entries.
drop policy if exists ci_admin_write on public.confidentiality_incidents;
create policy ci_admin_write on public.confidentiality_incidents
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and exists (select 1 from public.profiles p
      where p.id = auth.uid() and p.org_id = confidentiality_incidents.org_id
        and p.role in ('owner','admin'))
  )
  with check (
    org_id = public.current_org_id()
    and exists (select 1 from public.profiles p
      where p.id = auth.uid() and p.org_id = confidentiality_incidents.org_id
        and p.role in ('owner','admin'))
  );
