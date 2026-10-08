// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SharePopover } from '@/components/app/thread-menus'
import { useShareOpen } from '@/components/app/use-share-open'
import type { ThreadShare } from '@/lib/types'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

beforeAll(() => {
  // Radix positions popper content with ResizeObserver, absent from jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(cleanup)

const SHARED: ThreadShare = {
  shared: true,
  token: 'tok',
  url: 'https://vibe.test/share/tok',
}

type Props = {
  threadId: string | null
  share?: ThreadShare
  error?: boolean
  loading?: boolean
  onRetry?: () => void
  onToggle?: (shared: boolean) => void
  // Every render's lazy-read flag, as the shell would pass to useThreadShare.
  reads?: Array<[string | null, boolean]>
  notify?: (open: boolean) => void
}

// Mirrors the shell: it owns the open flag, and the header (with the popover)
// exists only while a Thread is selected.
function Shell({
  threadId,
  share,
  error = false,
  loading = false,
  onRetry,
  onToggle = () => {},
  reads,
  notify,
}: Props) {
  const [open, setOpen] = useShareOpen(threadId)
  reads?.push([threadId, open])
  return threadId ? (
    <SharePopover
      open={open}
      onOpenChange={(next) => {
        notify?.(next)
        setOpen(next)
      }}
      error={error}
      onRetry={onRetry}
      share={share}
      loading={loading}
      onToggle={onToggle}
    />
  ) : null
}
const mount = (props: Props) => {
  const view = render(
    <StrictMode>
      <Shell {...props} />
    </StrictMode>,
  )
  return {
    ...view,
    update: (next: Props) =>
      view.rerender(
        <StrictMode>
          <Shell {...next} />
        </StrictMode>,
      ),
  }
}
const trigger = () => screen.getByRole('button', { name: 'Share thread' })
const toggle = () => screen.getByRole('switch', { name: 'Public link' })
const dialog = () => screen.queryByRole('dialog', { name: 'Share thread' })

describe('SharePopover', () => {
  it('reports opening and closing to its owner', () => {
    const notify = vi.fn()
    const reads: Props['reads'] = []
    mount({ threadId: 'a', share: SHARED, notify, reads })
    expect(reads.at(-1)).toEqual(['a', false])
    fireEvent.click(trigger())
    expect(notify).toHaveBeenLastCalledWith(true)
    expect(dialog()).not.toBeNull()
    expect(reads.at(-1)).toEqual(['a', true])
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    expect(notify).toHaveBeenLastCalledWith(false)
    expect(dialog()).toBeNull()
    expect(reads.at(-1)).toEqual(['a', false])
  })

  it('keeps the switch disabled while status is unknown', () => {
    const props: Props = { threadId: 'a', share: undefined, loading: true }
    const view = mount(props)
    fireEvent.click(trigger())
    expect(screen.getByText('Checking link status…')).not.toBeNull()
    expect(toggle()).toHaveProperty('disabled', true)
    // Settled without data (e.g. offline): still not a known "off".
    view.update({ ...props, loading: false })
    expect(toggle()).toHaveProperty('disabled', true)
  })

  it('shows a failed read with a retry, then recovers', () => {
    const onRetry = vi.fn()
    const onToggle = vi.fn()
    const props: Props = { threadId: 'a', error: true, onRetry, onToggle }
    const view = mount(props)
    fireEvent.click(trigger())
    expect(screen.getByText('Could not check link status.')).not.toBeNull()
    expect(toggle()).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    view.update({ ...props, loading: true })
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveProperty(
      'disabled',
      true,
    )

    view.update({ ...props, error: false, share: SHARED })
    expect(screen.queryByText('Could not check link status.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(
      screen.getByRole('textbox', { name: 'Public share link' }),
    ).toHaveProperty('value', SHARED.url)
    fireEvent.click(toggle())
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('never carries an open popover (or its lazy read) to another Thread', () => {
    const reads: Props['reads'] = []
    const view = mount({ threadId: 'a', share: SHARED, reads })
    fireEvent.click(trigger())
    expect(dialog()).not.toBeNull()
    view.update({ threadId: 'b', share: undefined, reads })
    // Closed from the new Thread's first render, so its status isn't fetched.
    expect(reads.filter(([id]) => id === 'b').every(([, o]) => !o)).toBe(true)
    expect(dialog()).toBeNull()
  })

  it('resets when the header unmounts while open, and remounts closed', () => {
    const reads: Props['reads'] = []
    const view = mount({ threadId: 'a', share: SHARED, reads })
    fireEvent.click(trigger())
    expect(reads.at(-1)).toEqual(['a', true])
    view.update({ threadId: null, reads })
    expect(trigger).toThrow()
    expect(reads.at(-1)).toEqual([null, false])
    view.update({ threadId: 'a', share: SHARED, reads })
    expect(dialog()).toBeNull()
    expect(reads.at(-1)).toEqual(['a', false])
    // And it still opens normally afterwards.
    fireEvent.click(trigger())
    expect(dialog()).not.toBeNull()
  })
})
