-- Rollback for 0060. Destroys the price book. Line items already written into
-- estimates and jobs are copies and are unaffected — nothing references this
-- table — so the only loss is the saved templates themselves.
drop table if exists public.price_items cascade;
