-- 0051 — a rate-limit counter for the public, unauthenticated endpoints.
--
-- create-booking is the highest-abuse surface in the product: it needs only an
-- org_id (which rides in every public booking link), and each anonymous POST
-- writes a `clients` row, writes an `appointments` row, and sends an email from
-- the Balenco Resend domain. Resend bills per email and Supabase per invocation,
-- so an afternoon of scripted requests is a real bill, a polluted calendar, and
-- damage to the sending reputation every other email in the product depends on.
--
-- Deliberately generic (`key` is any string) so lead-intake, approve-estimate and
-- the checkout endpoints can reuse it without another migration.
--
-- Counting happens in ONE statement so concurrent requests can't both read a
-- stale count and both pass — the upsert's RETURNING gives each caller the true
-- post-increment value.

create table if not exists public.rate_limits (
  key          text primary key,
  count        integer     not null default 0,
  window_start timestamptz not null default now()
);

-- No policies: RLS on with zero policies means only the service role (which
-- bypasses RLS) can reach it. Edge functions call the RPC below; nothing in the
-- browser ever touches this table.
alter table public.rate_limits enable row level security;

-- Returns TRUE when the call is allowed, FALSE when the caller is over the limit.
create or replace function public.check_rate_limit(
  p_key         text,
  p_max         integer,
  p_window_secs integer
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  if p_key is null or p_key = '' then
    return true;   -- nothing to key on (no client IP): fail OPEN, never block a real booking
  end if;

  insert into public.rate_limits as rl (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    -- Window expired? start a new one. Otherwise increment within it.
    count = case
      when rl.window_start < now() - make_interval(secs => p_window_secs) then 1
      else rl.count + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_secs) then now()
      else rl.window_start
    end
  returning rl.count into v_count;

  -- Opportunistic cleanup so the table can't grow unbounded across unique IPs.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max;
end
$function$;

-- Service-role only. This must never be callable from the browser: a client that
-- can call it can burn another visitor's quota.
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
