import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '../clipboard'

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
