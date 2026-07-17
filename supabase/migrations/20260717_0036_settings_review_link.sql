-- 0036 — Google-review request link (applied live 2026-07-17).
-- Shown to clients on the portal once everything billable is fully paid
-- (portal-data v9 returns it; the portal renders the review card).
-- portal-data v9 also now returns payment_instructions to the portal —
-- closing the deferred "show Interac/cheque instructions on the portal" item.
alter table public.settings add column if not exists review_link text;
