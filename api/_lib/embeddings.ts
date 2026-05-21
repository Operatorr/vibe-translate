// Embedding provider for translation memory retrieval.
// Default model is OpenAI `text-embedding-3-large` at 3072 dims; the dimension
// is wired into `segments.source_embedding vector(3072)` and the `models` table
// row where task='embed'. Provider swap or dimension change requires a re-embed
// of every Segment row. BYOK never applies to embeddings — corpus consistency
// requires every Segment to be embedded with the same model.

export const EMBEDDING_DIMENSIONS = 3072

export type EmbedTextInput = {
  text: string
}

export type EmbedTextResult = {
  modelId: string
  vector: number[]
  promptTokens: number
}

export async function embedText(_input: EmbedTextInput): Promise<EmbedTextResult> {
  throw new Error('Embedding provider is not implemented yet')
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
