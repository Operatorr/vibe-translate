import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { scopedMutation } from '../scoped-mutation'

describe('mutation ownership', () => {
  it.each(['success', 'error'] as const)(
    'ignores late %s cache callbacks after an account switch',
    async (outcome) => {
      const client = new QueryClient()
      let owner = 'a'
      let finish!: () => void
      let started!: () => void
      const ready = new Promise<void>((r) => {
        started = r
      })
      const pending = new Promise<void>((r) => {
        finish = r
      })
      const onSuccess = vi.fn(() => {
        client.setQueryData(['characters'], ['old a'])
      })
      const onError = vi.fn(() => {
        client.setQueryData(['characters'], ['rollback a'])
      })
      const options = scopedMutation(
        {
          mutationFn: async () => {
            started()
            await pending
            if (outcome === 'error') throw new Error('failed')
            return 'ok'
          },
          onSuccess,
          onError,
        },
        () => owner,
      )
      const observer = new MutationObserver(client, options)
      const sent = observer.mutate(undefined).catch(() => undefined)
      await ready
      owner = 'b'
      client.clear()
      client.setQueryData(['characters'], ['b'])
      // Observer options also update on re-render; ownership must remain captured.
      observer.setOptions(
        scopedMutation(
          { mutationFn: options.mutationFn, onSuccess, onError },
          () => owner,
        ),
      )
      finish()
      await sent
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(client.getQueryData(['characters'])).toEqual(['b'])
      client.clear()
    },
  )
})
