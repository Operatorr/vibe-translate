// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useThreadExport,
  type ThreadExportSource,
} from '@/components/app/use-thread-export'
import { keys } from '@/lib/query-keys'
import type { Character, Segment, ThreadShare } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
  download: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/markdown-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/markdown-export')>()),
  downloadTextFile: mocks.download,
}))

const character = {
  id: 'c',
  name: 'Oba-chan',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  defaultVibe: 'casual',
} as Character
const seg = (n: number): Segment => ({
  id: `s${n}`,
  threadId: 't',
  sourceText: `source ${n}`,
  targetText: `target ${n}`,
  vibe: 'casual',
  tokenAlignment: [],
  tokenUsage: {},
  createdAt: `2026-01-0${n}T00:00:00Z`,
  updatedAt: `2026-01-0${n}T00:00:00Z`,
})
const SHARE: ThreadShare = {
  shared: true,
  token: 'tok',
  url: 'https://vibe.test/share/tok',
}
const HISTORY_URL = '/api/segments?threadId=t'
const SHARE_URL = '/api/threads/t/share'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Clipboard writes need transient user activation; WebKit also refuses writes
// started after an await in the handler. jsdom has neither, so the clipboard
// mocks accept a write only during the synchronous turn of a simulated click.
let activation = false
const click = (name: string) => {
  activation = true
  try {
    fireEvent.click(screen.getByRole('button', { name }))
  } finally {
    activation = false
  }
}
const refused = () =>
  Promise.reject(new DOMException('No user activation', 'NotAllowedError'))
class Item {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}
const clipboard = {
  writeText: vi.fn((_text: string) =>
    activation ? Promise.resolve() : refused(),
  ),
  write: vi.fn(async (items: Item[]) => {
    if (!activation) return refused()
    await items[0].items['text/plain']
  }),
}
const writtenText = async () =>
  (await clipboard.write.mock.calls[0][0][0].items['text/plain']).text()

let client: QueryClient
let fetch: ReturnType<typeof vi.fn>
const requests = (url: string) =>
  fetch.mock.calls.filter(([input]) => String(input) === url).length

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('ClipboardItem', Item)
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
})

function Exporter({ source }: { source: ThreadExportSource }) {
  const exporter = useThreadExport(source)
  // Never disabled: the hook itself must absorb clicks that slip through.
  return (
    <>
      <button onClick={exporter.download}>Download</button>
      <button onClick={exporter.copy}>Copy</button>
      <span>{exporter.preparing ? 'preparing' : 'idle'}</span>
    </>
  )
}
const mount = (source: Partial<ThreadExportSource> = {}) =>
  render(
    <QueryClientProvider client={client}>
      <Exporter
        source={{
          thread: { id: 't', title: 'Trip plans' },
          character,
          segments: [seg(3)],
          complete: false,
          ...source,
        }}
      />
    </QueryClientProvider>,
  )
const settle = () => vi.waitFor(() => screen.getByText('idle'))

describe('thread export preparation', () => {
  it('fetches the complete history when older pages remain, and resolves the share link into its cache', async () => {
    fetch.mockImplementation(async (input: RequestInfo | URL) =>
      Response.json(String(input) === SHARE_URL ? SHARE : [1, 2, 3].map(seg)),
    )
    mount()
    click('Download')
    screen.getByText('preparing')
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    const [filename, markdown] = mocks.download.mock.calls[0]
    expect(filename).toBe('trip-plans.md')
    expect(markdown).toContain('**Translations:** 3')
    expect(markdown).toContain('> source 1')
    expect(markdown).toContain('(https://vibe.test/share/tok)')
    expect(requests(HISTORY_URL)).toBe(1)
    expect(client.getQueryData(keys.share('t'))).toEqual(SHARE)
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Markdown download started.',
    )
    await settle()
  })

  it('exports a complete cached history offline without any request', async () => {
    onlineManager.setOnline(false)
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    mount({ segments: [seg(1), seg(2)], complete: true })
    click('Download')
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    const markdown = mocks.download.mock.calls[0][1]
    expect(markdown).toContain('**Translations:** 2')
    expect(markdown).toContain('Exported from Vibe Translate.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('exports without the link when the share lookup fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    mount({ segments: [seg(1)], complete: true })
    click('Download')
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalledOnce())
    expect(mocks.download.mock.calls[0][1]).toContain(
      'Exported from Vibe Translate.',
    )
    expect(requests(HISTORY_URL)).toBe(0)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('downloads synchronously when history and share status are cached', () => {
    client.setQueryData(keys.share('t'), SHARE)
    mount({ segments: [seg(1)], complete: true })
    click('Download')
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    screen.getByText('idle')
  })

  it('advises reconnecting, not copying, when preparation fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    mount()
    click('Download')
    await vi.waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'Could not load the full thread — check your connection and try again.',
      ),
    )
    expect(mocks.download).not.toHaveBeenCalled()
    await settle()
  })

  it('suggests copying only when the browser save fails', () => {
    client.setQueryData(keys.share('t'), SHARE)
    mocks.download.mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    mount({ complete: true })
    click('Download')
    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Download failed — try “Copy as Markdown” instead.',
    )
  })

  it('shares one request and saves one file across repeated clicks', async () => {
    client.setQueryData(keys.share('t'), SHARE)
    const history = deferred<Response>()
    fetch.mockReturnValue(history.promise)
    mount()
    click('Download')
    click('Download')
    click('Copy')
    click('Copy')
    history.resolve(Response.json([1, 2, 3].map(seg)))
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenCalledOnce()
    expect(mocks.download).toHaveBeenCalledOnce()
    expect(clipboard.write).toHaveBeenCalledOnce()
    expect(await writtenText()).toBe(mocks.download.mock.calls[0][1])
    await settle()
  })
})

describe('thread export clipboard', () => {
  it('writes directly inside the click when the text is cached', () => {
    client.setQueryData(keys.share('t'), SHARE)
    mount({ segments: [seg(1)], complete: true })
    click('Copy')
    expect(clipboard.writeText).toHaveBeenCalledOnce()
    expect(clipboard.writeText.mock.calls[0][0]).toContain('> source 1')
  })

  it('starts a promise-backed write inside the click, before the history request settles', async () => {
    const history = deferred<Response>()
    fetch.mockImplementation((input: RequestInfo | URL) =>
      String(input) === SHARE_URL
        ? Promise.resolve(Response.json(SHARE))
        : history.promise,
    )
    mount()
    click('Copy')
    expect(clipboard.write).toHaveBeenCalledOnce()
    history.resolve(Response.json([1, 2, 3].map(seg)))
    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Thread copied as Markdown.',
      ),
    )
    const text = await writtenText()
    expect(text).toContain('**Translations:** 3')
    expect(text).toContain('(https://vibe.test/share/tok)')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('offers a second-click copy when deferred writes are unsupported', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    fetch.mockImplementation(async (input: RequestInfo | URL) =>
      Response.json(String(input) === SHARE_URL ? SHARE : [1, 2].map(seg)),
    )
    mount()
    click('Copy')
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce())
    expect(clipboard.writeText).not.toHaveBeenCalled()
    const [title, options] = mocks.toast.mock.calls[0]
    expect(title).toBe('Markdown ready to copy.')
    expect(options.action.label).toBe('Copy')
    // The toast button is a fresh click with its own activation.
    activation = true
    try {
      options.action.onClick()
    } finally {
      activation = false
    }
    expect(clipboard.writeText).toHaveBeenCalledOnce()
    expect(clipboard.writeText.mock.calls[0][0]).toContain(
      '**Translations:** 2',
    )
    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'Thread copied as Markdown.',
      ),
    )
  })

  it('offers a second-click copy when the browser refuses the deferred write', async () => {
    clipboard.write.mockImplementationOnce(refused)
    client.setQueryData(keys.share('t'), SHARE)
    fetch.mockImplementation(async () => Response.json([1, 2].map(seg)))
    mount()
    click('Copy')
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'Markdown ready to copy.',
        expect.anything(),
      ),
    )
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('reports a preparation failure once, without offering a copy', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    mount()
    click('Copy')
    await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledOnce())
    expect(mocks.toast.error.mock.calls[0][0]).toContain(
      'check your connection',
    )
    expect(mocks.toast).not.toHaveBeenCalled()
    await settle()
  })
})
