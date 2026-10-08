import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scopedMutation } from '../scoped-mutation'

const clients: QueryClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

// A mutation whose request (or, for a rejected preparation, onMutate) waits
// until the test has optionally switched accounts and replaced observer options,
// as a re-render does while the request is in flight.
async function run(
  outcome: 'success' | 'error' | 'rejected preparation',
  switchAccount: boolean,
) {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryData(['characters'], ['a'])
  let owner = 'a'
  const sentinel = { previous: ['a'] }
  const failure = new Error('failed')
  let started!: () => void
  let finish!: () => void
  const ready = new Promise<void>((r) => {
    started = r
  })
  const pending = new Promise<void>((r) => {
    finish = r
  })
  const gate = async () => {
    started()
    await pending
  }
  const callbacks = () => ({
    onSuccess: vi.fn((data: string) => {
      client.setQueryData(['characters'], [data])
    }),
    onError: vi.fn(() => {
      client.setQueryData(['characters'], ['rollback a'])
    }),
    onSettled: vi.fn(),
  })
  const before = callbacks()
  const after = callbacks()
  const mutationFn = vi.fn(async (name: string) => {
    await gate()
    if (outcome === 'error') throw failure
    return `${name} saved`
  })
  const onMutate = async () => {
    if (outcome !== 'rejected preparation') return sentinel
    await gate()
    throw failure
  }
  const observer = new MutationObserver(
    client,
    scopedMutation({ mutationFn, onMutate, ...before }, () => owner),
  )
  const sent = observer.mutate('x').catch(() => undefined)
  await ready
  if (switchAccount) {
    owner = 'b'
    client.clear()
    client.setQueryData(['characters'], ['b'])
  }
  observer.setOptions(
    scopedMutation({ mutationFn, onMutate, ...after }, () => owner),
  )
  finish()
  await sent
  return { client, sentinel, failure, before, after, mutationFn }
}

const context = (client: QueryClient) => expect.objectContaining({ client })
const notCalled = (...groups: Record<string, ReturnType<typeof vi.fn>>[]) => {
  for (const fn of groups.flatMap(Object.values))
    expect(fn).not.toHaveBeenCalled()
}

describe('mutation ownership', () => {
  it('forwards same-owner success with the unwrapped onMutate result', async () => {
    const { client, sentinel, before, after } = await run('success', false)
    expect(after.onSuccess).toHaveBeenCalledExactlyOnceWith(
      'x saved',
      'x',
      sentinel,
      context(client),
    )
    expect(after.onSettled).toHaveBeenCalledExactlyOnceWith(
      'x saved',
      null,
      'x',
      sentinel,
      context(client),
    )
    expect(after.onError).not.toHaveBeenCalled()
    // The replaced options run; the first render's closures do not.
    notCalled(before)
    expect(client.getQueryData(['characters'])).toEqual(['x saved'])
  })

  it('forwards a same-owner error to rollback and settle', async () => {
    const { client, sentinel, failure, before, after } = await run(
      'error',
      false,
    )
    expect(after.onError).toHaveBeenCalledExactlyOnceWith(
      failure,
      'x',
      sentinel,
      context(client),
    )
    expect(after.onSettled).toHaveBeenCalledExactlyOnceWith(
      undefined,
      failure,
      'x',
      sentinel,
      context(client),
    )
    expect(after.onSuccess).not.toHaveBeenCalled()
    notCalled(before)
    expect(client.getQueryData(['characters'])).toEqual(['rollback a'])
  })

  it('forwards a same-owner rejected preparation with no onMutate result', async () => {
    const { client, failure, before, after, mutationFn } = await run(
      'rejected preparation',
      false,
    )
    expect(mutationFn).not.toHaveBeenCalled()
    expect(after.onError).toHaveBeenCalledExactlyOnceWith(
      failure,
      'x',
      undefined,
      context(client),
    )
    expect(after.onSettled).toHaveBeenCalledExactlyOnceWith(
      undefined,
      failure,
      'x',
      undefined,
      context(client),
    )
    expect(after.onSuccess).not.toHaveBeenCalled()
    notCalled(before)
    expect(client.getQueryData(['characters'])).toEqual(['rollback a'])
  })

  it.each(['success', 'error', 'rejected preparation'] as const)(
    'ignores late %s callbacks after an account switch',
    async (outcome) => {
      const { client, before, after } = await run(outcome, true)
      notCalled(before, after)
      expect(client.getQueryData(['characters'])).toEqual(['b'])
    },
  )
})
