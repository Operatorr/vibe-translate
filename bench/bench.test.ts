import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parse as parseToml } from 'smol-toml'
import { afterAll, beforeAll, describe, it } from 'vitest'

import {
  draftCharacterFromDictation,
  translateSegment,
  type TranslateSegmentInput,
} from '../api/_lib/ai'
import { generateExplain, type ExplainGenerateInput } from '../api/_lib/explain'
import type { ProviderConfig, ReasoningEffort } from '../api/_lib/openrouter'

// Live model benchmark. Each combo from bench.toml runs its task's standard
// sample prompt through the real provider function (same prompts + schemas the
// app uses) and records latency, token counts, throughput, and price. See
// bench/README.md.

const BENCH_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(BENCH_DIR, '..')

const TASKS = ['translate', 'explain', 'dictation'] as const
type Task = (typeof TASKS)[number]
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high']
const MAX_COMBOS = 50

type Combo = { label: string; task: Task; model: string; reasoning?: ReasoningEffort }

// Fixed sample inputs, identical across models so the comparison is apples-to-apples.
const SAMPLE_SOURCE = 'Could you send me your recipe so I don’t forget?'
const TRANSLATE_INPUT: TranslateSegmentInput = {
  sourceText: SAMPLE_SOURCE,
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  vibe: 'friend',
  temperature: 0.4,
  persona: { traits: [] },
}
const EXPLAIN_INPUT: ExplainGenerateInput = {
  sourceText: SAMPLE_SOURCE,
  sourceLanguage: 'en-US',
  targetText: '忘れないように、レシピ送ってくれる？',
  targetLanguage: 'ja-JP',
  persona: { traits: [] },
}
const DICTATION_PROMPT = 'Help me text my friend Tomoko in Tokyo casually in Japanese'

function loadApiKey(): string {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const line = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('OPENROUTER_API_KEY='))
    return line ? line.slice('OPENROUTER_API_KEY='.length).trim() : ''
  } catch {
    return ''
  }
}

type BenchToml = {
  repeat?: number
  combo?: Array<{ task?: string; model?: string; reasoning?: string; label?: string }>
}

function loadConfig(): { combos: Combo[]; repeat: number } {
  const raw = parseToml(readFileSync(join(BENCH_DIR, 'bench.toml'), 'utf8')) as BenchToml
  const repeat = Math.max(1, Math.floor(Number(raw.repeat ?? 1)))
  const combos: Combo[] = (raw.combo ?? []).slice(0, MAX_COMBOS).map((c, i) => {
    if (!c.model) throw new Error(`bench.toml combo[${i}]: "model" is required`)
    if (!c.task || !TASKS.includes(c.task as Task)) {
      throw new Error(`bench.toml combo[${i}]: "task" must be one of ${TASKS.join(', ')}`)
    }
    const task = c.task as Task
    const reasoning =
      c.reasoning && EFFORTS.includes(c.reasoning) ? (c.reasoning as ReasoningEffort) : undefined
    const label = c.label || `${task} · ${c.model}${reasoning ? ` (${reasoning})` : ''}`
    return { task, model: c.model, reasoning, label }
  })
  return { combos, repeat }
}

type Pricing = { prompt: number; completion: number }

// Per-token USD pricing from OpenRouter's public model list (best-effort).
async function loadPricing(): Promise<Map<string, Pricing>> {
  const map = new Map<string, Pricing>()
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    const json = (await res.json()) as {
      data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }>
    }
    for (const m of json.data ?? []) {
      if (m.pricing) {
        map.set(m.id, {
          prompt: Number(m.pricing.prompt ?? 0),
          completion: Number(m.pricing.completion ?? 0),
        })
      }
    }
  } catch {
    // pricing is optional; cost shows as n/a when unavailable
  }
  return map
}

type RunMetrics = { promptTokens: number; completionTokens: number; ok: boolean; note: string }

async function runTask(task: Task, config: ProviderConfig): Promise<RunMetrics> {
  if (task === 'translate') {
    const r = await translateSegment(TRANSLATE_INPUT, config)
    return {
      promptTokens: r.tokenUsage.promptTokens,
      completionTokens: r.tokenUsage.completionTokens,
      ok: r.targetText.trim().length > 0,
      note: r.targetText.slice(0, 32),
    }
  }
  if (task === 'explain') {
    const r = await generateExplain(EXPLAIN_INPUT, config)
    return {
      promptTokens: r.tokenUsage.promptTokens,
      completionTokens: r.tokenUsage.completionTokens,
      ok: typeof (r.body as { romaji?: unknown }).romaji === 'string',
      note: Object.keys(r.body).join(','),
    }
  }
  const r = await draftCharacterFromDictation(DICTATION_PROMPT, config)
  return {
    promptTokens: r.tokenUsage?.promptTokens ?? 0,
    completionTokens: r.tokenUsage?.completionTokens ?? 0,
    ok: r.draft.ok,
    note: r.draft.ok ? 'draft ok' : 'fallback',
  }
}

type Result = Combo & {
  ok: boolean
  latencyMs: number
  promptTokens: number
  completionTokens: number
  tps: number
  costUsd: number | null
  note: string
}

function renderMarkdown(rows: Result[], repeat: number): string {
  const sorted = [...rows].sort(
    (a, b) => a.task.localeCompare(b.task) || a.latencyMs - b.latencyMs,
  )
  const lines = [
    `# Model bench — ${new Date().toISOString()} (repeat=${repeat})`,
    '',
    '| Task | Model | Reasoning | OK | Latency | Prompt tok | Out tok | tok/s | Cost (USD) | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...sorted.map((r) => {
      const cost = r.costUsd != null ? `$${r.costUsd.toFixed(5)}` : 'n/a'
      const note = r.note.replace(/\|/g, '/')
      return `| ${r.task} | \`${r.model}\` | ${r.reasoning ?? '—'} | ${r.ok ? '✅' : '❌'} | ${Math.round(r.latencyMs)}ms | ${r.promptTokens} | ${r.completionTokens} | ${r.tps.toFixed(1)} | ${cost} | ${note} |`
    }),
  ]
  return lines.join('\n')
}

const apiKey = loadApiKey()
const { combos, repeat } = apiKey ? loadConfig() : { combos: [] as Combo[], repeat: 1 }
const results: Result[] = []
let pricing = new Map<string, Pricing>()

if (apiKey === '' || combos.length === 0) {
  describe.skip('model bench (set OPENROUTER_API_KEY + combos in bench/bench.toml)', () => {
    it('skipped', () => undefined)
  })
} else {
  describe('model bench', () => {
    beforeAll(async () => {
      pricing = await loadPricing()
    })

    it.each(combos)(
      '$label',
      async (combo) => {
        const config: ProviderConfig = {
          apiKey,
          modelId: combo.model,
          reasoning: combo.reasoning,
        }
        const latencies: number[] = []
        let last: RunMetrics = { promptTokens: 0, completionTokens: 0, ok: false, note: '' }
        let error = ''

        for (let i = 0; i < repeat; i += 1) {
          const t0 = Date.now()
          try {
            last = await runTask(combo.task, config)
            latencies.push(Date.now() - t0)
          } catch (e) {
            error = e instanceof Error ? e.message : String(e)
            break
          }
        }

        const latencyMs = latencies.length
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0
        const price = pricing.get(combo.model)
        const costUsd = price
          ? last.promptTokens * price.prompt + last.completionTokens * price.completion
          : null
        const tps = latencyMs > 0 ? last.completionTokens / (latencyMs / 1000) : 0

        results.push({
          ...combo,
          ok: error === '' && last.ok,
          latencyMs,
          promptTokens: last.promptTokens,
          completionTokens: last.completionTokens,
          tps,
          costUsd,
          note: error ? `ERROR: ${error.slice(0, 60)}` : last.note,
        })

        const summary = error
          ? `FAILED — ${error.slice(0, 80)}`
          : `${Math.round(latencyMs)}ms · ${last.completionTokens} out tok · ${tps.toFixed(1)} tok/s · ${costUsd != null ? `$${costUsd.toFixed(5)}` : 'n/a'}`
        console.log(`[BENCH] ${combo.label} — ${summary}`)
      },
      300_000,
    )

    afterAll(() => {
      if (results.length === 0) return
      const table = renderMarkdown(results, repeat)
      console.log(`\n${table}\n`)
      const outDir = join(BENCH_DIR, 'results')
      mkdirSync(outDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = join(outDir, `bench-${stamp}.md`)
      writeFileSync(file, `${table}\n`)
      console.log(`Saved ${file}`)
    })
  })
}
