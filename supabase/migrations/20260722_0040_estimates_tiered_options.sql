-- Good/better/best: an estimate can present the client a menu of options. Additive
-- and nullable — an estimate with no options behaves exactly as before. When the
-- client picks one on approval, approve-estimate collapses that option into the
-- estimate's normal line_items/subtotal (single source of truth for everything
-- downstream: invoice, portal, balances, emails) and records which option was chosen.
--   options         jsonb  -- [{ id, name, description, price }]
--   selected_option text   -- the id of the option the client chose
alter table public.estimates
  add column if not exists options jsonb,
  add column if not exists selected_option text;
