// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RubyPart } from '@/lib/readings'
import type { SegmentToken } from '@/lib/types'

import { SegmentCard } from '../segment-card'

// Readings run for real unless a test supplies controlled ones.
const readings = vi.hoisted(() => ({
  load: vi.fn<(tokens: string[], language: string) => Promise<RubyPart[][]>>(),
}))
vi.mock('@/lib/readings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/readings')>()
  readings.load.mockImplementation(actual.loadReadings)
  return { ...actual, loadReadings: readings.load }
})
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

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
    {
      id: 'friend',
      label: 'Friend',
      native: 'Friend',
      hint: 'tomodachi',
      color: '#0f0',
    },
    {
      id: 'casual',
      label: 'Casual',
      native: 'Casual',
      hint: 'teineigo',
      color: '#00f',
    },
    {
      id: 'keigo',
      label: 'Keigo',
      native: 'Keigo',
      hint: 'honorific',
      color: '#f00',
    },
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
        defaultPerspective="to"
        defaultTemperature={0.4}
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
      { vibe: 'keigo', perspective: 'to', temperature: 0.4 },
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('retries at the temperature and perspective picked in the dialog', async () => {
    const user = userEvent.setup()
    const handlers = actions()
    renderCard(handlers)
    const retry = screen.getByRole('button', { name: /retry/i })
    await user.click(retry)
    const dialog = screen.getByRole('dialog', { name: 'Pick a vibe stop' })
    const temp = within(dialog).getByRole<HTMLInputElement>('slider', {
      name: 'Temperature',
    })
    expect(temp.value).toBe('0.4')
    fireEvent.change(temp, { target: { value: '0.8' } })
    expect(within(dialog).getByText('0.80')).toBeTruthy()
    const as = within(dialog).getByRole<HTMLInputElement>('radio', {
      name: 'As the Character',
    })
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', {
        name: 'To the Character',
      }).checked,
    ).toBe(true)
    await user.click(as)
    await user.click(within(dialog).getByRole('button', { name: /confirm/i }))
    expect(handlers.onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      { vibe: 'casual', perspective: 'as', temperature: 0.8 },
    )

    // The next open starts over from the Segment and Character values.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(retry)
    const reopened = screen.getByRole('dialog', { name: 'Pick a vibe stop' })
    expect(
      within(reopened).getByRole<HTMLInputElement>('slider', {
        name: 'Temperature',
      }).value,
    ).toBe('0.4')
    expect(
      within(reopened).getByRole<HTMLInputElement>('radio', {
        name: 'To the Character',
      }).checked,
    ).toBe(true)
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
      { vibe: 'casual', perspective: 'to', temperature: 0.4 },
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
  const ZH_TOKENS: SegmentToken[] = [
    { t: '火車', src: 'train' },
    { t: '什麼時候', src: 'When' },
    { t: '會到', src: 'will arrive' },
    { t: '?', src: '?' },
  ]
  const chineseCard = (
    targetLanguage = 'zh-TW',
    tokenAlignment = ZH_TOKENS,
  ) => (
    <SegmentCard
      seg={{
        id: 's1',
        sourceText: 'When will the train arrive?',
        targetText: '火車什麼時候會到?',
        vibe: 'casual',
        tokenAlignment,
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
    />
  )
  const renderChinese = (targetLanguage?: string) =>
    render(chineseCard(targetLanguage))

  const rts = (container: HTMLElement) =>
    [...container.querySelectorAll('rt')].map((rt) => rt.textContent)
  const targetTokens = (container: HTMLElement) => [
    ...container.querySelectorAll<HTMLElement>('.segment__tgt-text .tok'),
  ]
  // A token's text as read, without the readings drawn above it.
  const baseText = (tok: HTMLElement) => {
    const copy = tok.cloneNode(true) as HTMLElement
    copy.querySelectorAll('rt').forEach((rt) => rt.remove())
    return copy.textContent
  }
  const deferred = () => {
    let resolve!: (parts: RubyPart[][]) => void
    let reject!: (error: Error) => void
    const promise = new Promise<RubyPart[][]>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  afterEach(() => {
    readings.load.mockClear()
    toastError.mockClear()
  })

  it('shows Pinyin over the characters, keeping alignment tokens intact', async () => {
    const user = userEvent.setup()
    const { container } = renderChinese()
    const toggle = screen.getByRole('button', { name: 'Pinyin' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('rt')).toBeNull()
    await user.click(toggle)
    await waitFor(() =>
      expect(rts(container)).toEqual([
        'huǒ',
        'chē',
        'shén',
        'me',
        'shí',
        'hòu',
        'huì',
        'dào',
      ]),
    )
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Pinyin shown')
    const toks = targetTokens(container)
    expect(toks.map(baseText)).toEqual(ZH_TOKENS.map((tok) => tok.t))
    // Hover and tap still pair a ruby token with its source word.
    const word = (text: string) =>
      [...container.querySelectorAll('.segment__src-text .tok')].find(
        (el) => el.textContent === text,
      )!
    await user.hover(toks[1].querySelector('ruby')!)
    expect(word('When').classList.contains('is-paired')).toBe(true)
    await user.click(toks[0].querySelector('ruby')!)
    expect(word('train').classList.contains('is-paired')).toBe(true)
    expect(word('When').classList.contains('is-paired')).toBe(false)
    await user.click(toggle)
    expect(container.querySelector('rt')).toBeNull()
  })

  it('shows Kana over kanji only, leaving okurigana bare', async () => {
    const user = userEvent.setup()
    readings.load.mockResolvedValueOnce([
      [{ base: 'こんばんは、' }],
      [{ base: 'また' }, { base: '明日', rt: 'あした' }],
    ])
    const { container } = render(card())
    const toggle = screen.getByRole('button', { name: 'Kana' })
    await user.click(toggle)
    await waitFor(() => expect(rts(container)).toEqual(['あした']))
    expect(readings.load).toHaveBeenCalledWith(
      ['こんばんは、', 'また明日'],
      'ja-JP',
    )
    const ruby = container.querySelector('ruby')!
    expect(baseText(ruby)).toBe('明日')
    expect(ruby.parentElement?.firstChild?.textContent).toBe('また')
    expect(targetTokens(container).map(baseText)).toEqual([
      'こんばんは、',
      'また明日',
    ])
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await user.click(toggle)
    expect(container.querySelector('rt')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('announces loading and resets the toggle when loading fails', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    readings.load.mockReturnValueOnce(pending.promise)
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    const { container } = render(card())
    const toggle = screen.getByRole('button', { name: 'Kana' })
    await user.click(toggle)
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('Loading Kana…')
    pending.reject(new Error('Offline'))
    await waitFor(() =>
      expect(toggle.getAttribute('aria-pressed')).toBe('false'),
    )
    expect(toggle.getAttribute('aria-busy')).toBe('false')
    expect(toastError).toHaveBeenCalledWith('Could not load Kana.')
    expect(container.querySelector('rt')).toBeNull()
  })

  it('ignores a result that arrives after the toggle is turned off', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    readings.load.mockReturnValueOnce(pending.promise)
    const { container } = render(card())
    const toggle = screen.getByRole('button', { name: 'Kana' })
    await user.click(toggle)
    await user.click(toggle)
    pending.resolve([[{ base: 'こんばんは、' }], [{ base: '明日', rt: 'X' }]])
    await pending.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('rt')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('installs only the readings for the current alignment after a retry', async () => {
    const user = userEvent.setup()
    const stale = deferred()
    const current = deferred()
    readings.load
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise)
    const view = render(chineseCard())
    await user.click(screen.getByRole('button', { name: 'Pinyin' }))
    const retried = [{ t: '火車什麼時候會到?', src: 'train' }]
    view.rerender(chineseCard('zh-TW', retried))
    await waitFor(() => expect(readings.load).toHaveBeenCalledTimes(2))
    stale.resolve(ZH_TOKENS.map((tok) => [{ base: tok.t, rt: 'stale' }]))
    await stale.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.container.querySelector('rt')).toBeNull()
    current.resolve([[{ base: '火車什麼時候會到?', rt: 'current' }]])
    await waitFor(() => expect(rts(view.container)).toEqual(['current']))
  })

  it('reloads readings when the target language changes', async () => {
    const user = userEvent.setup()
    const view = render(chineseCard())
    await user.click(screen.getByRole('button', { name: 'Pinyin' }))
    await waitFor(() => expect(rts(view.container)).toHaveLength(8))
    const kana = deferred()
    readings.load.mockReturnValueOnce(kana.promise)
    // Same Segment, same alignment array: only the Character's language moved.
    view.rerender(chineseCard('ja-JP'))
    const toggle = screen.getByRole('button', { name: 'Kana' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelector('rt')).toBeNull()
    expect(readings.load).toHaveBeenLastCalledWith(
      ZH_TOKENS.map((tok) => tok.t),
      'ja-JP',
    )
    kana.resolve(ZH_TOKENS.map((tok) => [{ base: tok.t, rt: 'かな' }]))
    await waitFor(() => expect(rts(view.container)).toHaveLength(4))
    view.rerender(chineseCard('th-TH'))
    expect(screen.queryByRole('button', { name: 'Kana' })).toBeNull()
    expect(view.container.querySelector('rt')).toBeNull()
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
