// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SegmentCard } from '../segment-card'

const SOURCE = 'Good evening, see you tomorrow'
const TARGET = 'こんばんは、また明日'
// What AppExperience's pane stack and TanStack Router keep in history.state.
const SEEDED = { vtPane: 'workspace', vtStack: 1, __TSR_index: 3 }

const card = (props: { readOnly?: boolean; speaking?: boolean } = {}) => (
  <SegmentCard
    seg={{
      id: 's1',
      sourceText: SOURCE,
      targetText: TARGET,
      vibe: 'casual',
      tokenAlignment: [
        { t: 'こんばんは、', src: 'Good evening,' },
        { t: 'また明日', src: 'see you tomorrow' },
      ],
      createdAt: '2026-10-09T00:00:00Z',
    }}
    idx={1}
    isActive
    collapsed={false}
    sourceLanguage="en-US"
    targetLanguage="ja-JP"
    vibes={[]}
    onExpand={vi.fn()}
    onCopy={vi.fn()}
    onSpeak={vi.fn()}
    {...props}
  />
)

// jsdom, like browsers, delivers history.back() asynchronously. Rejects
// instead of hanging when no traversal happens.
const nextPopstate = () =>
  new Promise<PopStateEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no popstate')), 1000)
    window.addEventListener(
      'popstate',
      (event) => {
        clearTimeout(timer)
        resolve(event)
      },
      { once: true },
    )
  })

const overlayOpen = () =>
  Boolean((window.history.state as Record<string, unknown> | null)?.vtOverlay)

async function openDisplay(props?: Parameters<typeof card>[0]) {
  const user = userEvent.setup()
  const view = render(card(props))
  const trigger = screen.getByRole('button', {
    name: 'Show translation full screen',
  })
  await user.click(trigger)
  const display = screen.getByRole('dialog', { name: 'Translation display' })
  return { user, view, trigger, display }
}

const queryDisplay = () =>
  screen.queryByRole('dialog', { name: 'Translation display' })

let lengthBefore = 0
beforeEach(() => {
  // Pushing (not replacing) drops forward entries left by earlier tests, so
  // history.length marks the current position.
  window.history.pushState(SEEDED, '')
  lengthBefore = window.history.length
})
afterEach(async () => {
  // Unmounting an open display pops its own entry; let that land before the
  // next test seeds history.
  const popped = overlayOpen() ? nextPopstate() : null
  cleanup()
  await popped
})

describe('full-screen translation display', () => {
  it('shows only the exact target text, marked with the target language', async () => {
    const { display } = await openDisplay()
    const text = within(display).getByText(TARGET)
    expect(text.getAttribute('lang')).toBe('ja-JP')
    expect(display.textContent).not.toContain(SOURCE)
    expect(display.textContent).not.toContain('Good evening')
  })

  it('closes with the Close button and returns focus to the trigger', async () => {
    const { user, trigger, display } = await openDisplay()
    const popped = nextPopstate()
    await user.click(
      within(display).getByRole('button', {
        name: 'Close translation display',
      }),
    )
    expect(queryDisplay()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await popped
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    const { user, trigger } = await openDisplay()
    const popped = nextPopstate()
    await user.keyboard('{Escape}')
    expect(queryDisplay()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await popped
  })

  it('is available on read-only (shared) cards', async () => {
    const { display } = await openDisplay({ readOnly: true })
    expect(within(display).getByText(TARGET).getAttribute('lang')).toBe('ja-JP')
  })
})

describe('full-screen translation display and the Back button', () => {
  it('pushes one entry that keeps the pane stack and router state', async () => {
    const { view } = await openDisplay()
    expect(window.history.length).toBe(lengthBefore + 1)
    expect(window.history.state).toEqual({
      ...SEEDED,
      vtOverlay: expect.any(String),
    })

    // Re-rendering the open card (fresh onClose) must not push again.
    view.rerender(card({ speaking: true }))
    expect(window.history.length).toBe(lengthBefore + 1)
  })

  it('closes on Back without changing the pane', async () => {
    const panes: unknown[] = []
    const paneHandler = (event: PopStateEvent) =>
      panes.push((event.state as typeof SEEDED | null)?.vtPane)
    window.addEventListener('popstate', paneHandler)
    try {
      const { trigger } = await openDisplay()
      const popped = nextPopstate()
      window.history.back()
      await popped

      await waitFor(() => expect(queryDisplay()).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(trigger))
      expect(window.history.state).toEqual(SEEDED)
      expect(panes).toEqual(['workspace'])
    } finally {
      window.removeEventListener('popstate', paneHandler)
    }
  })

  it.each([
    ['the Close button', 'close'],
    ['Escape', 'escape'],
  ] as const)(
    'leaves no extra entry after closing with %s',
    async (_label, how) => {
      const panes: unknown[] = []
      const paneHandler = (event: PopStateEvent) =>
        panes.push((event.state as typeof SEEDED | null)?.vtPane)
      window.addEventListener('popstate', paneHandler)
      try {
        const { user, display } = await openDisplay()
        const popped = nextPopstate()
        if (how === 'close')
          await user.click(
            within(display).getByRole('button', {
              name: 'Close translation display',
            }),
          )
        else await user.keyboard('{Escape}')
        await popped

        expect(window.history.state).toEqual(SEEDED)
        expect(panes).toEqual(['workspace'])
        // Back at the opening position: the next push replaces the popped
        // entry instead of stacking on it.
        window.history.pushState({}, '')
        expect(window.history.length).toBe(lengthBefore + 1)
      } finally {
        window.removeEventListener('popstate', paneHandler)
      }
    },
  )

  it('pops its entry when unmounted while open', async () => {
    const { view } = await openDisplay()
    const popped = nextPopstate()
    view.unmount()
    await popped
    expect(window.history.state).toEqual(SEEDED)
  })

  it('does not pop an entry it no longer owns', async () => {
    const { view } = await openDisplay()
    // e.g. a route change pushed a new entry while the display was open.
    window.history.pushState({ __TSR_index: 4 }, '')
    const back = vi.spyOn(window.history, 'back')
    try {
      view.unmount()
      expect(back).not.toHaveBeenCalled()
    } finally {
      back.mockRestore()
    }
  })
})
