import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({
  default: class {
    static APIError = class extends Error {}
    chat = { completions: { create } }
  },
}))
import { chatJson } from '../openrouter'

beforeEach(() => create.mockReset())
const reply = (
  content: string,
  cost: number | null,
  tokens: { prompt_tokens?: unknown; completion_tokens?: unknown } = {
    prompt_tokens: 773,
    completion_tokens: 59,
  },
) => ({
  model: 'openai/gpt-6-luna',
  choices: [{ message: { content } }],
  usage: { ...tokens, cost },
})
const args = {
  apiKey: 'test',
  model: 'openai/gpt-6-luna',
  messages: [],
  schema: z.strictObject({ text: z.string() }),
  schemaName: 'test',
}
describe('provider cost accounting', () => {
  it('retains the sub-cent provider cost without rounding it to zero', async () => {
    create.mockResolvedValue(reply('{"text":"ok"}', 0.0001068))
    expect((await chatJson(args)).tokenUsage.costUsd).toBe(0.0001068)
  })
  it('includes both calls when malformed JSON requires a corrective retry', async () => {
    create
      .mockResolvedValueOnce(reply('bad json', 0.0001068))
      .mockResolvedValueOnce(reply('{"text":"ok"}', 0.000125))
    expect((await chatJson(args)).tokenUsage).toMatchObject({
      promptTokens: 1546,
      completionTokens: 118,
      requests: 2,
      costUsd: 0.0002318,
    })
  })
  it('leaves cost absent when any attempt omits it, so all usage can be priced', async () => {
    create
      .mockResolvedValueOnce(reply('bad json', null))
      .mockResolvedValueOnce(reply('{"text":"ok"}', 0.000125))
    const usage = (await chatJson(args)).tokenUsage
    expect(usage.costUsd).toBeUndefined()
    expect(usage.promptTokens).toBe(1546)
  })
})

describe('provider token counts', () => {
  it.each([
    ['input', { completion_tokens: 59 }, null, 59],
    ['output', { prompt_tokens: 773 }, 773, null],
    ['both', {}, null, null],
  ])(
    'reports a missing %s count as unknown, not zero',
    async (_, tokens, promptTokens, completionTokens) => {
      create.mockResolvedValue(reply('{"text":"ok"}', 0.01, tokens))
      expect((await chatJson(args)).tokenUsage).toMatchObject({
        promptTokens,
        completionTokens,
        costUsd: 0.01,
      })
    },
  )
  it('keeps a count unknown when only the failed first attempt omitted it', async () => {
    create
      .mockResolvedValueOnce(reply('bad json', 0.01, { completion_tokens: 59 }))
      .mockResolvedValueOnce(reply('{"text":"ok"}', 0.01))
    expect((await chatJson(args)).tokenUsage).toMatchObject({
      promptTokens: null,
      completionTokens: 118,
      requests: 2,
    })
  })
  it.each([-100, 0.5, '773', Number.NaN])(
    'treats a malformed reported count (%s) as unknown',
    async (count) => {
      create.mockResolvedValue(
        reply('{"text":"ok"}', 0.01, {
          prompt_tokens: count,
          completion_tokens: 59,
        }),
      )
      expect((await chatJson(args)).tokenUsage.promptTokens).toBeNull()
    },
  )
})
