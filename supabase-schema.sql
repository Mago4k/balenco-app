-- ============================================================
-- Balenco — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Profiles (one row per auth user)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  role text not null default 'employee' check (role in ('owner', 'employee')),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Authenticated users can read profiles" on public.profiles for select using (auth.role() = 'authenticated');
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Settings (single row for the whole company)
create table if not exists public.settings (
  id text primary key default 'global',
  company text default 'Your Company Name',
  email text default 'info@company.com',
  phone text default '514-000-0000',
  address text default 'Montreal, Quebec',
  tps numeric default 5,
  tvq numeric default 9.975,
  logo text default '',
  terms text default 'Estimate valid for 15 days. Deposit required before scheduling. Hidden conditions, permits, and extra work are not included unless stated.',
  updated_at timestamptz default now()
);
alter table public.settings enable row level security;
create policy "Authenticated users can read settings" on public.settings for select using (auth.role() = 'authenticated');
create policy "Authenticated users can write settings" on public.settings for all using (auth.role() = 'authenticated');

-- Clients
create table if not exists public.clients (
  id uuid primary key,
  name text not null,
  phone text default '',
  email text default '',
  address text default '',
  project text default '',
  status text default 'Active',
  balance numeric default 0,
  created_by text default '',
  created_at timestamptz default now()
);
alter table public.clients enable row level security;
create policy "Authenticated users can manage clients" on public.clients for all using (auth.role() = 'authenticated');

-- Leads
create table if not exists public.leads (
  id uuid primary key,
  name text not null,
  phone text default '',
  email text default '',
  source text default '',
  project text default '',
  status text default 'New',
  notes text default '',
  created_by text default '',
  created_at timestamptz default now()
);
alter table public.leads enable row level security;
create policy "Authenticated users can manage leads" on public.leads for all using (auth.role() = 'authenticated');

-- Estimates
create table if not exists public.estimates (
  id uuid primary key,
  client_id uuid references public.clients(id) on delete set null,
  title text default '',
  subtotal numeric default 0,
  deposit numeric default 0,
  payment_schedule text default 'Deposit + balance on completion',
  payment_notes text default '',
  approved_by text default '',
  approved_at timestamptz,
  status text default 'Draft',
  scope text default '',
  created_by text default '',
  created_at timestamptz default now(),
  updated_by text default '',
  updated_at timestamptz default now()
);
alter table public.estimates enable row level security;
create policy "Authenticated users can manage estimates" on public.estimates for all using (auth.role() = 'authenticated');

-- Appointments
create table if not exists public.appointments (
  id uuid primary key,
  title text default '',
  client_id uuid references public.clients(id) on delete set null,
  start_time text,
  end_time text,
  location text default '',
  notes text default '',
  reminder24 boolean default true,
  reminder_sent boolean default false,
  created_by text default '',
  created_at timestamptz default now()
);
alter table public.appointments enable row level security;
create policy "Authenticated users can manage appointments" on public.appointments for all using (auth.role() = 'authenticated');

-- Photos
create table if not exists public.photos (
  id uuid primary key,
  client_id uuid references public.clients(id) on delete set null,
  type text default '',
  notes text default '',
  storage_path text default '',
  created_by text default '',
  created_at timestamptz default now()
);
alter table public.photos enable row level security;
create policy "Authenticated users can manage photos" on public.photos for all using (auth.role() = 'authenticated');

-- Logs
create table if not exists public.logs (
  id uuid default gen_random_uuid() primary key,
  action text default '',
  detail text default '',
  user_name text default '',
  created_at timestamptz default now()
);
alter table public.logs enable row level security;
create policy "Authenticated users can manage logs" on public.logs for all using (auth.role() = 'authenticated');

-- Storage bucket for photos
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict do nothing;
create policy "Authenticated users can upload photos" on storage.objects for insert with check (bucket_id = 'photos' and auth.role() = 'authenticated');
create policy "Anyone can view photos" on storage.objects for select using (bucket_id = 'photos');
create policy "Authenticated users can delete photos" on storage.objects for delete using (bucket_id = 'photos' and auth.role() = 'authenticated');
