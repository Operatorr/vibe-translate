-- Thread starring + public share links. Idempotent. See docs/DATABASE.md.
--
-- `threads.starred` pins a Thread to the top of its Character's list.
-- `thread_shares` holds one read-only public link per Thread: an unguessable
-- token that `GET /api/share/:token` resolves WITHOUT auth. Revoking sets
-- `revoked_at`; a fresh share mints a new token. The public payload never
-- carries user ids or credit data — see docs/SECURITY.md.

alter table threads add column if not exists starred boolean not null default false;

create table if not exists thread_shares (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads (id) on delete cascade,
  user_id text not null references users (clerk_user_id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists thread_shares_thread_id_idx on thread_shares (thread_id);
create index if not exists threads_user_id_starred_idx on threads (user_id) where starred;
