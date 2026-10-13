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

describe('segment retry and delete', () => {
  const VIBES = [
    { id: 'friend', label: 'Friend', hint: 'tomodachi', color: '#0f0' },
    { id: 'casual', label: 'Casual', hint: 'teineigo', color: '#00f' },
    { id: 'keigo', label: 'Keigo', hint: 'honorific', color: '#f00' },
  ]
  const actions = () => ({ onRetry: vi.fn(), onDelete: vi.fn() })
  const renderCard = (handlers: ReturnType<typeof actions>) =>
    render(
      <SegmentCard
        seg={{
          id: 's1',
          sourceText: SOURCE,
          targetText: TARGET,
          vibe: 'casual',
          tokenAlignment: [],
          createdAt: '2026-10-09T00:00:00Z',
        }}
        idx={1}
        isActive
        collapsed={false}
        sourceLanguage="en-US"
        targetLanguage="ja-JP"
        vibes={VIBES}
        onExpand={vi.fn()}
        onCopy={vi.fn()}
        onSpeak={vi.fn()}
        {...handlers}
      />,
    )

  it('opens Retry at the stored stop and re-translates at the picked one', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    renderCard(handlers)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    const dialog = screen.getByRole('dialog', { name: 'Pick a vibe stop' })
    const slider = within(dialog).getByRole('slider', { name: 'Vibe' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Casual')
    expect(document.activeElement).toBe(slider)
    await user.keyboard('{ArrowRight}')
    expect(slider.getAttribute('aria-valuetext')).toBe('Keigo')
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }))
    expect(handlers.onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      'keigo',
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('confirms the stored stop unchanged, and Cancel retries nothing', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    renderCard(handlers)
    const retry = screen.getByRole('button', { name: /retry/i })
    await user.click(retry)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(handlers.onRetry).not.toHaveBeenCalled()
    await user.click(retry)
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(handlers.onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      'casual',
    )
  })

  it('deletes the Segment from the number menu', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    renderCard(handlers)
    await user.click(screen.getByRole('button', { name: 'Segment 01 options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /delete segment/i }),
    )
    expect(handlers.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
    )
  })
})

describe('Segment card reading toggle', () => {
  const renderChinese = (targetLanguage = 'zh-TW') =>
    render(
      <SegmentCard
        seg={{
          id: 's1',
          sourceText: 'When will the train arrive?',
          targetText: '火車什麼時候會到?',
          vibe: 'casual',
          tokenAlignment: [
            { t: '火車', src: 'train' },
            { t: '什麼時候', src: 'When' },
            { t: '會到', src: 'will arrive' },
            { t: '?', src: '?' },
          ],
          createdAt: '2026-10-09T00:00:00Z',
        }}
        idx={1}
        isActive
        collapsed={false}
        sourceLanguage="en-US"
        targetLanguage={targetLanguage}
        vibes={[]}
        onExpand={vi.fn()}
        onCopy={vi.fn()}
        onSpeak={vi.fn()}
      />,
    )

  it('shows Pinyin over the characters, keeping alignment tokens intact', async () => {
    const user = userEvent.setup()
    const { container } = renderChinese()
    const toggle = screen.getByRole('button', { name: 'Pinyin' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('rt')).toBeNull()
    await user.click(toggle)
    await waitFor(() =>
      expect(
        [...container.querySelectorAll('rt')].map((rt) => rt.textContent),
      ).toEqual(['huǒ', 'chē', 'shén', 'me', 'shí', 'hòu', 'huì', 'dào']),
    )
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.segment__tgt-text .tok')).toHaveLength(
      4,
    )
    await user.click(toggle)
    expect(container.querySelector('rt')).toBeNull()
  })

  it('offers no reading toggle for languages without one', () => {
    renderChinese('th-TH')
    expect(screen.queryByRole('button', { name: 'Pinyin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kana' })).toBeNull()
  })

  it('renders Copy and Speak as icon-only buttons', () => {
    renderChinese()
    for (const name of ['Copy translation', 'Read aloud'])
      expect(screen.getByRole('button', { name }).textContent).toBe('')
  })
})
