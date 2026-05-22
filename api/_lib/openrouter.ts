import { HTTPException } from 'hono/http-exception'
import OpenAI from 'openai'
import type { Client } from 'pg'
import * as z from 'zod'

import type { Bindings } from './env'
import { getDefaultModel, type ModelTask } from './models'
import { decryptSecret } from './secrets'

// Shared OpenRouter access layer. Every LLM call (translate, explain,
// dictation) goes through `chatJson`, which talks to OpenRouter via the OpenAI
// SDK and enforces a strict JSON-schema response. `resolveCallTarget` decides
// which API key + model a request uses (BYOK vs. platform). See docs/BACKEND.md
// and adr/0003.

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
// Generous ceiling: strict-JSON outputs (per-token alignment, the Japanese
// Explain breakdown) routinely run tens of seconds. `maxRetries: 0` keeps that
// a single deterministic attempt — chatJson does its own corrective retry for
// malformed output, and we don't want the SDK silently multiplying latency on
// timeouts/5xx for a synchronous request.
const REQUEST_TIMEOUT_MS = 90_000

export function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  })
}

// The two-message prompt shape produced by api/_lib/prompts.ts. Structurally
// identical to that module's ChatMessage, so builders there pass straight in.
export type ChatMessage = { role: 'system' | 'user'; content: string }

// OpenRouter reasoning/thinking control. `none` disables reasoning entirely
// (`reasoning: { enabled: false }`); `minimal`/`low`/`medium`/`high` set the
// effort. Undefined leaves the model's default. Disabling is a no-op (or maps to
// the model's floor) on models that always reason.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

const REASONING_EFFORTS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high']

// Validate a free-form value into a ReasoningEffort, or undefined.
export function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  const v = value?.trim().toLowerCase()
  return v && REASONING_EFFORTS.includes(v) ? (v as ReasoningEffort) : undefined
}

// The OpenRouter request fragment for a reasoning setting.
function reasoningParam(reasoning: ReasoningEffort | undefined): Record<string, unknown> {
  if (!reasoning) return {}
  if (reasoning === 'none') return { reasoning: { enabled: false } }
  return { reasoning: { effort: reasoning } }
}

export type TokenUsage = {
  modelId: string
  promptTokens: number
  completionTokens: number
  // OpenRouter reports cost when `usage.include` is set; in cents when present.
  costCents?: number
}

export type ChatJsonArgs<T> = {
  apiKey: string
  // OpenRouter slug, e.g. 'deepseek/deepseek-v4-pro'.
  model: string
  messages: ChatMessage[]
  // Output contract. Use z.strictObject with nullable/sentinel fields (never
  // .optional()): strict json_schema requires every key present + no extras.
  schema: z.ZodType<T>
  schemaName: string
  temperature?: number
  // Human-facing label woven into 5xx messages, e.g. 'Translation'.
  label?: string
  // App attribution surfaced in OpenRouter rankings; from env.APP_URL.
  appUrl?: string
  // Reasoning/thinking effort, when the task is configured for it.
  reasoning?: ReasoningEffort
}

// Strip a Markdown code fence a model may wrap JSON in despite strict mode.
export function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

function buildErrorMessage(label: string, error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return `${label} provider rejected the API key (${error.status}) — check your OpenRouter key`
    }
    const detail = typeof error.message === 'string' ? error.message.slice(0, 240) : ''
    return `${label} provider request failed (${error.status ?? 'unknown'})${detail ? `: ${detail}` : ''}`
  }
  return `${label} provider request failed`
}

// One model call with strict structured output + a single corrective retry on
// malformed/invalid JSON. Maps SDK failures onto Hono HTTPExceptions; following
// the convention in api/_lib/ai.ts, timeouts and unreachable providers both
// surface as 502 (errors.ts has no 504).
export async function chatJson<T>(
  args: ChatJsonArgs<T>,
): Promise<{ data: T; tokenUsage: TokenUsage }> {
  const label = args.label ?? 'Model'
  const client = createOpenRouterClient(args.apiKey)
  const jsonSchema = z.toJSONSchema(args.schema, { target: 'openai' }) as Record<string, unknown>

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = args.messages.map((m) =>
    m.role === 'system'
      ? { role: 'system', content: m.content }
      : { role: 'user', content: m.content },
  )

  const requestHeaders = args.appUrl
    ? { 'HTTP-Referer': args.appUrl, 'X-Title': 'Vibe Translate' }
    : undefined

  let lastError = ''

  // Two attempts total: the original call plus one corrective retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let completion: OpenAI.Chat.Completions.ChatCompletion
    try {
      completion = await client.chat.completions.create(
        {
          model: args.model,
          // Reasoning models commonly reject `temperature` alongside strict
          // structured output under provider.require_parameters (OpenRouter 404
          // "no endpoints found"). Drop temperature whenever a reasoning setting
          // is in play; reasoning models largely ignore it anyway.
          ...(args.reasoning ? {} : { temperature: args.temperature }),
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: { name: args.schemaName, strict: true, schema: jsonSchema },
          },
          // OpenRouter-specific: only route to providers that honour
          // response_format json_schema, and return token counts + cost.
          provider: { require_parameters: true },
          usage: { include: true },
          ...reasoningParam(args.reasoning),
        } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        requestHeaders ? { headers: requestHeaders } : undefined,
      )
    } catch (error) {
      // Timeouts and connection errors both surface as 502 (no 504; see ai.ts).
      throw new HTTPException(502, { message: buildErrorMessage(label, error) })
    }

    const content = completion.choices[0]?.message.content ?? ''
    const usage = completion.usage as
      | (OpenAI.Completions.CompletionUsage & { cost?: number })
      | undefined
    const tokenUsage: TokenUsage = {
      modelId: completion.model || args.model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      ...(Number.isFinite(usage?.cost) ? { costCents: Math.round((usage as { cost: number }).cost * 100) } : {}),
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stripFences(content))
    } catch {
      lastError = 'reply was not valid JSON'
      messages.push(
        { role: 'assistant', content },
        {
          role: 'user',
          content: 'Your previous reply was not valid JSON. Return ONLY a JSON object matching the schema.',
        },
      )
      continue
    }

    const result = args.schema.safeParse(parsed)
    if (result.success) {
      return { data: result.data, tokenUsage }
    }

    lastError = result.error.issues[0]?.message ?? 'reply did not match the schema'
    messages.push(
      { role: 'assistant', content },
      {
        role: 'user',
        content:
          'Your previous reply did not match the required schema. Return ONLY a JSON object matching the schema exactly.',
      },
    )
  }

  throw new HTTPException(502, {
    message: `${label} provider returned malformed output${lastError ? `: ${lastError}` : ''}`,
  })
}

// Tasks that can route to OpenRouter. `embed` is an OpenAI-direct task and is
// handled by api/_lib/embeddings.ts, not here.
export type ProviderTask = Extract<ModelTask, 'translate' | 'explain' | 'dictation'>

// Resolved provider/runtime config handed to a provider function (translate,
// explain, dictation): which key + model to call, plus optional app
// attribution. The route derives this from a CallTarget.
export type ProviderConfig = {
  apiKey: string
  modelId: string
  // From env.APP_URL; surfaced in OpenRouter rankings.
  appUrl?: string
  // Reasoning/thinking effort for this task, if configured.
  reasoning?: ReasoningEffort
}

export type CallTarget = {
  apiKey: string
  // OpenRouter slug to call.
  modelId: string
  // models.id for the platform default; null on a BYOK custom slug.
  modelRowId: string | null
  // Used to derive credit cost on the platform path; irrelevant under BYOK.
  creditCostMultiplier: number
  // When true the caller skips all credit accounting (the user pays OpenRouter).
  isByok: boolean
  // Reasoning effort for this task, from the `*_REASONING` env override.
  reasoning?: ReasoningEffort
}

// Per-task env override var names. An operator can pin a model + reasoning
// effort without touching the `models` registry (see adr/0003). The env model
// overrides the platform default; a user's BYOK per-task model still wins.
const ENV_OVERRIDES: Record<ProviderTask, { model: string; reasoning: string }> = {
  translate: { model: 'TRANSLATE_MODEL', reasoning: 'TRANSLATE_REASONING' },
  explain: { model: 'EXPLAIN_MODEL', reasoning: 'EXPLAIN_REASONING' },
  dictation: { model: 'DICTATION_MODEL', reasoning: 'DICTATION_REASONING' },
}

// Decide which key + model a request uses. translate/explain honour a stored
// BYOK key (and optional per-task model override); dictation is always
// platform-paid. A decryption failure falls back to the platform path rather
// than failing the request (adr/0003).
export async function resolveCallTarget(
  db: Client,
  env: Bindings,
  userId: string,
  task: ProviderTask,
): Promise<CallTarget> {
  const overrideVars = ENV_OVERRIDES[task]
  const envRecord = env as unknown as Record<string, string | undefined>
  const envModelId = envRecord[overrideVars.model]?.trim() || undefined
  const reasoning = parseReasoningEffort(envRecord[overrideVars.reasoning])

  if (task !== 'dictation') {
    const result = await db.query<{
      openrouter_api_key_cipher: string | null
      byok_translate_model_id: string | null
      byok_explain_model_id: string | null
    }>(
      `select openrouter_api_key_cipher, byok_translate_model_id, byok_explain_model_id
         from users where clerk_user_id = $1`,
      [userId],
    )
    const row = result.rows[0]
    const cipher = row?.openrouter_api_key_cipher ?? null
    const encryptionKey = env.CREDENTIALS_ENCRYPTION_KEY?.trim()

    if (cipher && encryptionKey) {
      try {
        const apiKey = await decryptSecret(cipher, encryptionKey)
        const byokModelId =
          task === 'translate' ? row?.byok_translate_model_id : row?.byok_explain_model_id
        // BYOK model wins over the env override, which wins over the registry.
        const modelId =
          byokModelId?.trim() || envModelId || (await getDefaultModel(db, task)).providerModelId
        return { apiKey, modelId, modelRowId: null, creditCostMultiplier: 0, isByok: true, reasoning }
      } catch {
        // Fall through to the platform path — never 500 on a bad cipher.
      }
    }
  }

  const platformKey = env.OPENROUTER_API_KEY?.trim()
  if (!platformKey) {
    throw new HTTPException(503, { message: 'AI provider is not configured' })
  }

  const model = await getDefaultModel(db, task)
  return {
    apiKey: platformKey,
    // Env override wins over the registry default on the platform path.
    modelId: envModelId || model.providerModelId,
    modelRowId: model.id,
    creditCostMultiplier: model.creditCostMultiplier,
    isByok: false,
    reasoning,
  }
}
