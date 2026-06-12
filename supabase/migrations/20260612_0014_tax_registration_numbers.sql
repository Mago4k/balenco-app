-- ============================================================
-- Balenco — migration 14: GST/QST (TPS/TVQ) registration numbers.
-- A compliant Quebec invoice must show the supplier's GST and QST
-- registration numbers. Store them per-org on settings so they can
-- be rendered on estimates and invoices.
-- ============================================================
alter table public.settings add column if not exists gst_number text;
alter table public.settings add column if not exists qst_number text;
