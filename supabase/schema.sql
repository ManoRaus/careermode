-- Career Mode: Web Push notification infrastructure
-- Execute no SQL Editor do Supabase.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  title text not null,
  body text not null,
  local_time time not null,
  time_zone text not null default 'America/Sao_Paulo',
  app_url text not null default '/',
  enabled boolean not null default true,
  last_sent_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_id)
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_schedules enable row level security;

drop policy if exists "Users manage own push subscriptions" on public.push_subscriptions;
create policy "Users manage own push subscriptions" on public.push_subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own notification schedules" on public.notification_schedules;
create policy "Users manage own notification schedules" on public.notification_schedules
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists notification_schedules_enabled_idx
  on public.notification_schedules (enabled, local_time);
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);
