-- ============================================================
-- Push notifications setup — run ONCE in the SQL Editor
-- (safe to re-run: everything is idempotent)
-- ============================================================

-- 1. Table holding each device's push subscription
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  org_id text,
  user_name text,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "push subs for logged-in users" on push_subscriptions;
create policy "push subs for logged-in users" on push_subscriptions
  for all to authenticated using (true) with check (true);

-- 2. Extension that lets the database call the edge function
create extension if not exists pg_net;

-- 3. Trigger: when a client books online, ping the send-push function
create or replace function notify_new_booking()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://wvqqazdzejjksjcjdbcm.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id))
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_new_booking on appointments;
create trigger trg_notify_new_booking
  after insert on appointments
  for each row
  when (new.booked_online = true)
  execute function notify_new_booking();

-- Maintenance:
--   see devices:   select user_name, created_at from push_subscriptions;
--   see trigger:   select tgname from pg_trigger where tgname = 'trg_notify_new_booking';
--   remove all:    drop trigger trg_notify_new_booking on appointments;
--                  drop function notify_new_booking();
--                  drop table push_subscriptions;
