create extension if not exists pgcrypto;
create extension if not exists vector;

-- Canonical 6-stop Vibe slider. See docs/PRODUCT.md, DESIGN.md, adr/0001.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'vibe_stop') then
    create type vibe_stop as enum (
      'yakuza', 'friend', 'casual', 'keigo', 'keigoplus', 'emperor'
    );
  end if;
end$$;

-- Users carry tier, credit balance, and optional BYOK credentials.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  display_name text,
  tier text not null default 'free' check (tier in ('free', 'pro', 'team')),
  subscription_id text,
  onboarding_complete boolean not null default false,
  locale text,
  -- Credits: token-derived spend, refilled monthly per tier. See adr/0003.
  credits_balance integer not null default 0,
  credits_refilled_at timestamptz,
  -- BYOK: optional per-user OpenRouter key, encrypted at rest (AES-GCM).
  openrouter_api_key_cipher text,
  openrouter_api_key_last4 text,
  byok_translate_model_id text,
  byok_explain_model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Model registry. One default row per task; operators flip defaults with a
-- single SQL update — no deploy required. BYOK users may override translate
-- and explain via users.byok_*_model_id; embed is never overridable.
create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task in ('translate', 'explain', 'embed', 'dictation')),
  provider text not null,                                  -- e.g. 'openrouter', 'openai'
  provider_model_id text not null,                         -- e.g. 'deepseek/deepseek-v4-pro'
  display_name text not null,
  is_default boolean not null default false,
  embedding_dimensions integer,                            -- only set for task='embed'
  credit_cost_multiplier numeric(6, 3) not null default 1.000,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one default per task.
create unique index if not exists models_default_per_task_uniq
  on models (task) where is_default;

-- A provider/model id is unique within a task (idempotent re-runs of the seed).
create unique index if not exists models_provider_model_uniq
  on models (task, provider, provider_model_id);

-- Seed defaults (idempotent).
insert into models (task, provider, provider_model_id, display_name, is_default, embedding_dimensions)
values
  ('translate', 'openrouter', 'deepseek/deepseek-v4-pro', 'DeepSeek v4 Pro', true, null),
  ('explain',   'openrouter', 'xiaomi/mimo-v2.5-pro',     'Xiaomi MiMo v2.5 Pro', true, null),
  ('dictation', 'openrouter', 'google/gemini-2.5-flash',  'Gemini 2.5 Flash', true, null),
  ('embed',     'openrouter', 'openai/text-embedding-3-small', 'OpenAI Embedding 3 Small (via OpenRouter)', true, 1536)
on conflict (task, provider, provider_model_id) do nothing;

-- Append-only audit log of every credit grant and every credit spend.
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (clerk_user_id) on delete cascade,
  delta integer not null,                                  -- +grant, -spend
  reason text not null,                                    -- e.g. 'grant.monthly', 'spend.translate'
  reference_id uuid,                                       -- e.g. segment_id or explain_id
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
  -- Structured attributes for UI chips + deterministic form onboarding.
  persona jsonb not null default '{}'::jsonb,
  -- Free-form natural-language extension appended to the system prompt at
  -- translate time ("his name is Kenji, your college roommate, uses Kansai-ben").
  -- Populated by dictation onboarding or hand-edited. See docs/PRODUCT.md.
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
  starred boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One read-only public share link per Thread. The token is unguessable and
-- resolved without auth by GET /api/share/:token; revoking sets revoked_at.
create table if not exists thread_shares (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Segments power Translation Memory. source_embedding dimension must match
-- the default embed model's embedding_dimensions in `models`. If the embed
-- model ever changes dimension, every Segment must be re-embedded.
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

-- Shared, cross-user cache of CANONICAL translations (no persona, no
-- instructions, default temperature). Privacy-safe: a requester only hits on
-- inputs they fully supplied. Cache hits cost 0 credits. See adr/0004.
-- Carries no user_id by design.
create table if not exists translation_cache (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,            -- sha-256 of (source_text, src_lang, tgt_lang, vibe, model_id)
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

-- Append-only dedupe ledger for provider webhooks (Dodo Payments). Keyed by the
-- provider's event id (Dodo's Standard-Webhooks `webhook-id` header). The webhook
-- handler inserts here inside the same transaction as the tier/credit mutation,
-- so a redelivered event is dropped before any grant runs. See adr/0005.
create table if not exists webhook_events (
  event_id text primary key,
  source text not null default 'dodo',
  event_type text,
  received_at timestamptz not null default now()
);

create index if not exists characters_user_id_sort_order_idx on characters (user_id, sort_order);
create index if not exists threads_character_id_updated_at_idx on threads (character_id, updated_at desc);
create index if not exists threads_user_id_updated_at_idx on threads (user_id, updated_at desc);
create index if not exists threads_user_id_starred_idx on threads (user_id) where starred;
create index if not exists thread_shares_thread_id_idx on thread_shares (thread_id);
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

-- Lifecycle webhooks (renewed/cancelled/expired) may lack checkout metadata;
-- resolve the owning user by their stored Dodo subscription id. See adr/0005.
create unique index if not exists users_subscription_id_uniq
  on users (subscription_id) where subscription_id is not null;
