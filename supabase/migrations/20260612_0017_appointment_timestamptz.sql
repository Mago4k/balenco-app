-- ============================================================
-- Balenco — migration 17: appointment times to real timestamptz.
-- start_time / end_time were `text` holding mixed formats
-- (datetime-local "2026-06-12T14:30" from the app vs full ISO from
-- bookings), used directly in slot-conflict math. Convert to
-- timestamptz so the DB stores true instants. The table is empty
-- today, so the USING casts never touch real data. Going forward the
-- app sends proper UTC ISO, and the booking edge functions interpret
-- wall-clock times as America/Montreal.
-- ============================================================
alter table public.appointments
  alter column start_time type timestamptz using nullif(start_time, '')::timestamptz,
  alter column end_time   type timestamptz using nullif(end_time, '')::timestamptz;
