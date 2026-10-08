import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText, copyTextWhenReady } from '../clipboard'

afterEach(() => vi.unstubAllGlobals())

describe('clipboard fallback', () => {
  const setup = () => {
    const field = {
      value: '',
      setAttribute: vi.fn(),
      style: {},
      select: vi.fn(),
      remove: vi.fn(),
    }
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', {
      createElement: () => field,
      body: { appendChild: vi.fn() },
      execCommand,
    })
    return { field, execCommand }
  }

  it('removes the field if selection throws', async () => {
    const { field } = setup()
    field.select.mockImplementation(() => {
      throw new Error('selection failed')
    })
    await expect(copyText('hello')).rejects.toThrow('selection failed')
    expect(field.remove).toHaveBeenCalledOnce()
  })

  it('removes the field if copying throws', async () => {
    const { field, execCommand } = setup()
    execCommand.mockImplementation(() => {
      throw new Error('copy failed')
    })
    await expect(copyText('hello')).rejects.toThrow('copy failed')
    expect(field.remove).toHaveBeenCalledOnce()
  })

  it('removes the field when copying is denied', async () => {
    const { field, execCommand } = setup()
    execCommand.mockReturnValue(false)
    await expect(copyText('hello')).rejects.toThrow('Copy failed')
    expect(field.remove).toHaveBeenCalledOnce()
  })
})

describe('deferred clipboard write', () => {
  class Item {
    constructor(readonly items: Record<string, Promise<Blob>>) {}
  }

  it('starts the write before the text resolves', async () => {
    const write = vi.fn(async (items: Item[]) => {
      await items[0].items['text/plain']
    })
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write } })
    let resolve!: (text: string) => void
    const done = copyTextWhenReady(new Promise((r) => (resolve = r)))
    // Synchronous: no await between the call and the write.
    expect(write).toHaveBeenCalledOnce()
    resolve('# Thread')
    await done
    const blob = await write.mock.calls[0][0][0].items['text/plain']
    expect(blob.type).toBe('text/plain')
    expect(await blob.text()).toBe('# Thread')
  })

  it('rejects without writing when ClipboardItem is unavailable', async () => {
    const write = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { write } })
    await expect(copyTextWhenReady(Promise.resolve('x'))).rejects.toThrow(
      'unsupported',
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects when the text fails, without an unhandled item rejection', async () => {
    const write = vi.fn(async (items: Item[]) => {
      await items[0].items['text/plain']
    })
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write } })
    await expect(
      copyTextWhenReady(Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline')
  })
})
