create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  display_name text,
  tier text not null default 'free' check (tier in ('free', 'pro', 'team')),
  subscription_id text,
  onboarding_complete boolean not null default false,
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (clerk_user_id) on delete cascade,
  title text not null,
  source_language text not null,
  target_language text not null,
  instructions text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists translations (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  source_text text not null,
  translated_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (clerk_user_id) on delete cascade,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists chats_user_id_sort_order_idx on chats (user_id, sort_order);
create index if not exists translations_chat_id_created_at_idx on translations (chat_id, created_at desc);
create index if not exists activity_log_user_id_created_at_idx on activity_log (user_id, created_at desc);
