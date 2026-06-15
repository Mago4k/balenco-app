-- ============================================================
-- Balenco — migration 24: company payment-instructions setting.
-- Most Québec residential clients pay deposits by Interac e-transfer or cheque,
-- not card. This free-text field lets the contractor set their e-transfer /
-- cheque instructions once; they render on invoices as the default payment
-- instructions (a per-estimate note still overrides them).
-- ============================================================

alter table public.settings add column if not exists payment_instructions text;
