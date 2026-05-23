import { HTTPException } from 'hono/http-exception'

// Embedding provider for translation memory retrieval.
// Routed through OpenRouter (the platform `OPENROUTER_API_KEY`, never a BYOK
// key) as `openai/text-embedding-3-small` at 1536 dims — one provider/secret for
// every model call. The dimension is wired into `segments.source_embedding
// vector(1536)` and the `models` table row where task='embed'. 1536 keeps the
// column within pgvector's 2000-dim HNSW index limit. A model/dimension change
// requires a re-embed of every Segment row. BYOK never applies to embeddings —
// corpus consistency requires every Segment to be embedded with the same model.

export const EMBEDDING_DIMENSIONS = 1536
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'

export type EmbedTextInput = {
  text: string
  apiKey: string
  // Optional override; defaults to the platform-owned EMBEDDING_MODEL.
  model?: string
}

export type EmbedTextResult = {
  modelId: string
  vector: number[]
  promptTokens: number
}

type OpenAiEmbeddingResponse = {
  data?: { embedding?: unknown }[]
  model?: unknown
  usage?: { prompt_tokens?: unknown }
}

export async function embedText({ text, apiKey, model }: EmbedTextInput): Promise<EmbedTextResult> {
  if (!apiKey.trim()) {
    throw new HTTPException(503, { message: 'Embeddings are not configured' })
  }

  const modelId = model ?? EMBEDDING_MODEL

  let response: Response
  try {
    response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: modelId,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
    })
  } catch {
    throw new HTTPException(502, { message: 'Embedding provider is unreachable' })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new HTTPException(502, { message: getProviderErrorMessage(response.status, body) })
  }

  const payload = (await response.json().catch(() => null)) as OpenAiEmbeddingResponse | null
  const vector = payload?.data?.[0]?.embedding

  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new HTTPException(502, { message: 'Embedding provider returned an unexpected response' })
  }

  const promptTokens =
    typeof payload?.usage?.prompt_tokens === 'number' ? payload.usage.prompt_tokens : 0

  return {
    modelId: typeof payload?.model === 'string' ? payload.model : modelId,
    vector,
    promptTokens,
  }
}

function getProviderErrorMessage(status: number, body: string): string {
  // Log the upstream body server-side; return a generic, status-only message to
  // the client so provider internals aren't surfaced in API responses.
  if (body.trim()) console.error('embedding provider error', { status, detail: body.slice(0, 500) })
  return `Embedding provider request failed (${status})`
}

// SHA-256 hex of a string, used as the cross-segment dedupe key for explains.
// Web Crypto is available in both the Cloudflare Workers runtime and Node 22+.
export async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// pgvector text format helpers. Raw `pg` has no type for `vector`: it sends and
// receives the literal `[1,2,3]` string. Bind the formatted string with a
// `$n::vector` cast on write; a column read comes back as this string.
export function formatVector(vector: number[]): string {
  return `[${vector.join(',')}]`
}

export function parseVector(value: string | number[] | null): number[] | null {
  if (value == null) return null
  if (Array.isArray(value)) return value
  const trimmed = value.trim().replace(/^\[|\]$/g, '')
  if (trimmed.length === 0) return []
  return trimmed.split(',').map(Number)
}
