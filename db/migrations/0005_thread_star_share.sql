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
create index if not exists thread_shares_user_id_idx on thread_shares (user_id);

-- At most one LIVE link per Thread. `POST /api/threads/:id/share` inserts with
-- `on conflict (thread_id) where revoked_at is null do nothing`, so concurrent
-- mints converge on one token. Revoke any duplicates a pre-index race left
-- behind (keeping the newest) so the index can build.
update thread_shares s
   set revoked_at = now()
 where s.revoked_at is null
   and exists (
     select 1 from thread_shares n
      where n.thread_id = s.thread_id
        and n.revoked_at is null
        and (n.created_at, n.id) > (s.created_at, s.id)
   );
create unique index if not exists thread_shares_live_thread_uniq
  on thread_shares (thread_id) where revoked_at is null;
