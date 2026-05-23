-- Route embeddings through OpenRouter instead of OpenAI directly, so a single
-- OPENROUTER_API_KEY covers every model call (translate/explain/dictation +
-- embeddings). Same model and dimension (openai/text-embedding-3-small, 1536),
-- so NO re-embed is required. The `models` embed row is informational — the
-- embedding call resolves its key/model directly — but kept accurate for
-- operators flipping defaults. See db/schema.sql and docs/adr/0003.
update models
   set provider = 'openrouter',
       provider_model_id = 'openai/text-embedding-3-small',
       display_name = 'OpenAI Embedding 3 Small (via OpenRouter)',
       updated_at = now()
 where task = 'embed'
   and provider = 'openai'
   and provider_model_id = 'text-embedding-3-small';
