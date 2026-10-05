-- Better Auth replaces Clerk as the identity provider. Idempotent. See
-- docs/adr/0008-better-auth-replaces-clerk.md and docs/SECURITY.md#authentication.
--
-- The auth_* tables are Better Auth's core schema (users, sessions, linked
-- accounts incl. password hashes, verification tokens) plus DB-backed rate-limit
-- counters. The DDL is what Better Auth's `getMigrations` emits for the
-- modelName/fields mapping in api/_lib/auth.ts — change the two together.
-- `users` stays the app-side profile (tier, credits, BYOK), now keyed by
-- auth_users.id instead of a Clerk user id.

create table if not exists auth_users (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id text not null references auth_users (id) on delete cascade
);

-- One row per sign-in method: provider_id 'credential' carries the scrypt
-- password hash; 'google' carries the OAuth tokens.
create table if not exists auth_accounts (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references auth_users (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null
);

-- Email-verification and password-reset tokens.
create table if not exists auth_verifications (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_rate_limits (
  id text primary key,
  key text not null unique,
  count integer not null,
  last_request bigint not null
);

create index if not exists auth_sessions_user_id_idx on auth_sessions (user_id);
create unique index if not exists auth_accounts_provider_account_idx on auth_accounts (provider_id, account_id);
create index if not exists auth_accounts_user_id_idx on auth_accounts (user_id);
create index if not exists auth_verifications_identifier_idx on auth_verifications (identifier);

-- Re-key the app profile: clerk_user_id → auth_user_id. Every FK that pointed
-- at it (threads, segments, credit_ledger, …) follows the rename. The new FK
-- makes deleting an auth_users row cascade through all of that user's data.
-- It fails if Clerk-era rows remain; there were none at cut-over (prod and
-- local were both empty), so clear any before re-running elsewhere.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'clerk_user_id'
  ) then
    alter table public.users rename column clerk_user_id to auth_user_id;
  end if;
  if exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conrelid = 'public.users'::regclass and conname = 'users_clerk_user_id_key') then
    alter table public.users rename constraint users_clerk_user_id_key to users_auth_user_id_key;
  end if;
  if not exists (select 1 from pg_constraint where connamespace = 'public'::regnamespace and conrelid = 'public.users'::regclass and conname = 'users_auth_user_id_fkey') then
    alter table public.users add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references public.auth_users (id) on delete cascade;
  end if;
end$$;
