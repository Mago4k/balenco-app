-- Rollback migration 17 (back to text).
alter table public.appointments
  alter column start_time type text using start_time::text,
  alter column end_time   type text using end_time::text;
