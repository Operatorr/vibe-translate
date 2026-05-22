-- Initial schema for fresh environments. Mirrors db/schema.sql.
-- Establishes Character → Thread → Segment, Translation Memory,
-- Explain Memory, Credits, BYOK, and the model registry.
-- See docs/adr/0001, docs/adr/0002, docs/adr/0003.

create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vibe_stop') then
    create type vibe_stop as enum (
      'yakuza', 'friend', 'casual', 'keigo', 'keigoplus', 'emperor'
    );
  end if;
end$$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  display_name text,
  tier text not null default 'free' check (tier in ('free', 'pro', 'team')),
  subscription_id text,
  onboarding_complete boolean not null default false,
  locale text,
  credits_balance integer not null default 0,
  credits_refilled_at timestamptz,
  openrouter_api_key_cipher text,
  openrouter_api_key_last4 text,
  byok_translate_model_id text,
  byok_explain_model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task in ('translate', 'explain', 'embed', 'dictation')),
  provider text not null,
  provider_model_id text not null,
  display_name text not null,
  is_default boolean not null default false,
  embedding_dimensions integer,
  credit_cost_multiplier numeric(6, 3) not null default 1.000,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists models_default_per_task_uniq
  on models (task) where is_default;
create unique index if not exists models_provider_model_uniq
  on models (task, provider, provider_model_id);

insert into models (task, provider, provider_model_id, display_name, is_default, embedding_dimensions)
values
  ('translate', 'openrouter', 'deepseek/deepseek-v4-pro', 'DeepSeek v4 Pro', true, null),
  ('explain',   'openrouter', 'xiaomi/mimo-v2.5-pro',     'Xiaomi MiMo v2.5 Pro', true, null),
  ('dictation', 'openrouter', 'google/gemini-2.5-flash',  'Gemini 2.5 Flash', true, null),
  ('embed',     'openai',     'text-embedding-3-small',   'OpenAI Embedding 3 Small', true, 1536)
on conflict (task, provider, provider_model_id) do nothing;

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (clerk_user_id) on delete cascade,
  delta integer not null,
  reason text not null,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (clerk_user_id) on delete cascade,
  name text not null,
  initials text,
  color text,
  source_language text not null,
  target_language text not null,
  default_vibe vibe_stop not null default 'casual',
  temperature numeric(3, 2) not null default 0.40 check (temperature >= 0 and temperature <= 1),
  persona jsonb not null default '{}'::jsonb,
  instructions text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references characters (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  title text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  source_text text not null,
  target_text text not null,
  vibe vibe_stop,
  token_alignment jsonb not null default '[]'::jsonb,
  token_usage jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  source_embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists explains (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references segments (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  target_language text not null,
  target_text text not null,
  target_text_hash text not null,
  version integer not null,
  body jsonb not null,
  token_usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists translation_cache (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source_language text not null,
  target_language text not null,
  vibe vibe_stop not null,
  model_id text not null,
  source_text text not null,
  target_text text not null,
  token_alignment jsonb not null default '[]'::jsonb,
  source_embedding vector(1536),
  hits integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
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

create index if not exists characters_user_id_sort_order_idx on characters (user_id, sort_order);
create index if not exists threads_character_id_updated_at_idx on threads (character_id, updated_at desc);
create index if not exists threads_user_id_updated_at_idx on threads (user_id, updated_at desc);
create index if not exists segments_thread_id_created_at_idx on segments (thread_id, created_at desc);
create index if not exists segments_user_id_created_at_idx on segments (user_id, created_at desc);
create index if not exists segments_source_embedding_idx
  on segments using hnsw (source_embedding vector_cosine_ops);
create index if not exists explains_segment_id_version_idx on explains (segment_id, version desc);
create unique index if not exists explains_user_text_version_uniq
  on explains (user_id, target_language, target_text_hash, version);
create index if not exists explains_user_created_at_idx on explains (user_id, created_at desc);
create index if not exists credit_ledger_user_id_created_at_idx on credit_ledger (user_id, created_at desc);
create index if not exists translation_cache_last_used_at_idx on translation_cache (last_used_at desc);
create index if not exists activity_log_user_id_created_at_idx on activity_log (user_id, created_at desc);
