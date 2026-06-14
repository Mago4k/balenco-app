-- ============================================================
-- Balenco — migration 19: RBQ + NEQ numbers on contractor documents.
-- Most Quebec construction/renovation trades must hold an RBQ (Régie du
-- bâtiment du Québec) licence and routinely show its number on quotes;
-- NEQ is the Quebec enterprise number. Both are optional, edited in
-- Settings, and render alongside TPS/TVQ on estimates/invoices.
-- ============================================================

alter table public.settings add column if not exists rbq_number text;
alter table public.settings add column if not exists neq_number text;
