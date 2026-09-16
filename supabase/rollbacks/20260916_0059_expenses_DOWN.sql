-- Rollback for 0059. Destroys every recorded expense — export them first if the
-- contractor has started using this.
drop table if exists public.expenses cascade;
