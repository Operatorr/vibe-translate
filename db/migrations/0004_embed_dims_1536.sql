-- Bring the embedding model + vector columns to 1536 dims on databases that
-- predate the change. db/migrations/0001_initial.sql now bootstraps fresh DBs at
-- 1536 directly, but `create table if not exists` means re-running 0001 cannot
-- shrink an existing vector(3072) column, and 0003 only re-points the model row.
-- So any DB provisioned before this change keeps vector(3072) columns + the
-- text-embedding-3-large model row, which the 1536-dim runtime
-- (api/_lib/embeddings.ts) can no longer write or query.
--
-- Existing 3072-dim vectors are NOT convertible to 1536 — embeddings are derived
-- data, so we reset the column to null and let it re-embed on demand
-- (segment.embed_failed / backfill; see adr/0002, adr/0006). Guarded by the
-- current column type so this is a safe no-op on an already-1536 (fresh) DB.
-- Idempotent. See db/schema.sql, docs/adr/0003.

do $$
begin
  if exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
     where c.relname = 'segments'
       and a.attname = 'source_embedding'
       and a.attnum > 0
       and not a.attisdropped
       and format_type(a.atttypid, a.atttypmod) <> 'vector(1536)'
  ) then
    drop index if exists segments_source_embedding_idx;
    alter table segments
      alter column source_embedding type vector(1536) using null;
    create index if not exists segments_source_embedding_idx
      on segments using hnsw (source_embedding vector_cosine_ops);
  end if;

  if exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
     where c.relname = 'translation_cache'
       and a.attname = 'source_embedding'
       and a.attnum > 0
       and not a.attisdropped
       and format_type(a.atttypid, a.atttypmod) <> 'vector(1536)'
  ) then
    alter table translation_cache
      alter column source_embedding type vector(1536) using null;
  end if;
end$$;

-- Re-point the embed model row by task (not by its old provider/slug, which
-- 0003 missed on DBs seeded with text-embedding-3-large). The row is
-- informational — the runtime resolves the embed model directly — but kept
-- accurate for operators flipping defaults.
update models
   set provider = 'openrouter',
       provider_model_id = 'openai/text-embedding-3-small',
       display_name = 'OpenAI Embedding 3 Small (via OpenRouter)',
       embedding_dimensions = 1536,
       updated_at = now()
 where task = 'embed'
   and (provider is distinct from 'openrouter'
     or provider_model_id is distinct from 'openai/text-embedding-3-small'
     or embedding_dimensions is distinct from 1536);
