// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VibePreset } from '@/components/vibe-design/design-data'
import { Composer } from '../composer'

const VIBES: VibePreset[] = [
  {
    id: 'casual',
    label: 'Casual',
    native: 'Casual',
    hint: 'friends',
    color: 'rgb(1, 2, 3)',
  },
  {
    id: 'polite',
    label: 'Polite',
    native: 'Polite',
    hint: 'teineigo',
    color: 'rgb(4, 5, 6)',
  },
  {
    id: 'keigo',
    label: 'Keigo',
    native: 'Keigo',
    hint: 'honorific',
    color: 'rgb(7, 8, 9)',
  },
]
const storedKey = (owner: string) => `vibe-translate:drafts:${owner}`

type ComposerProps = React.ComponentProps<typeof Composer>

function renderComposer(props: Partial<ComposerProps> = {}) {
  const onVibeChange = vi.fn()
  const onTemperatureChange = vi.fn()
  const onTemperatureCommit = vi.fn()
  const onPerspectiveChange = vi.fn()
  const onSend = vi.fn(async () => true)
  // Stateful like AppExperience, so controlled sliders and radios actually
  // move. `perspective` only seeds the state; spreading it again would pin it.
  function Harness({
    perspective: initialPerspective = 'to',
    ...over
  }: Partial<ComposerProps>) {
    const [vibeIdx, setVibeIdx] = React.useState(over.vibeIdx ?? 0)
    const [temperature, setTemperature] = React.useState(0.4)
    const [perspective, setPerspective] = React.useState(initialPerspective)
    return (
      <Composer
        contextId="t1"
        placeholder="Type to translate"
        sourceLanguage="en-US"
        vibes={VIBES}
        vibeIdx={vibeIdx}
        onVibeChange={(idx) => {
          onVibeChange(idx)
          setVibeIdx(idx)
        }}
        temperature={temperature}
        onTemperatureChange={(value) => {
          onTemperatureChange(value)
          setTemperature(value)
        }}
        onTemperatureCommit={onTemperatureCommit}
        perspective={perspective}
        onPerspectiveChange={(value) => {
          onPerspectiveChange(value)
          setPerspective(value)
        }}
        onSend={onSend}
        sending={false}
        {...over}
      />
    )
  }
  const view = render(<Harness {...props} />)
  return {
    ...view,
    rerender: (next: Partial<ComposerProps>) =>
      view.rerender(<Harness {...props} {...next} />),
    onVibeChange,
    onTemperatureChange,
    onTemperatureCommit,
    onPerspectiveChange,
    onSend,
  }
}

const toggle = (vibe = 'Casual', perspective = 'To the Character') =>
  screen.getByRole('button', {
    name: `Translation settings · ${vibe} · ${perspective}`,
  })
const drawerOf = (button: HTMLElement) => {
  const drawer = document.getElementById(button.getAttribute('aria-controls')!)
  expect(drawer).not.toBeNull()
  return drawer!
}
const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  )

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('composer settings disclosure', () => {
  it('starts collapsed with the settings out of the focus order and accessibility tree', () => {
    renderComposer()
    const button = toggle()
    const drawer = drawerOf(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(drawer.hasAttribute('inert')).toBe(true)
    expect(drawer.getAttribute('aria-hidden')).toBe('true')
    // Rendered (for the open transition) but unreachable while collapsed.
    expect(drawer.querySelector('[role="slider"]')).not.toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('opens and closes with a click, exposing working Vibe and Temperature controls', async () => {
    const user = userEvent.setup()
    const {
      onVibeChange,
      onTemperatureChange,
      onTemperatureCommit,
      onPerspectiveChange,
    } = renderComposer()
    const button = toggle()
    await user.click(button)
    const drawer = drawerOf(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(drawer.hasAttribute('inert')).toBe(false)
    expect(drawer.getAttribute('aria-hidden')).toBe('false')
    await nextFrame()
    // A pointer click leaves focus on the toggle.
    expect(document.activeElement).toBe(button)

    const vibe = screen.getByRole('slider', { name: 'Vibe' })
    vibe.focus()
    await user.keyboard('{ArrowRight}')
    expect(onVibeChange).toHaveBeenLastCalledWith(1)
    expect(vibe.getAttribute('aria-valuetext')).toBe('Polite')

    const temperature = screen.getByRole('slider', { name: 'Temperature' })
    fireEvent.change(temperature, { target: { value: '0.7' } })
    expect(onTemperatureChange).toHaveBeenLastCalledWith(0.7)
    fireEvent.keyUp(temperature, { key: 'ArrowRight' })
    expect(onTemperatureCommit).toHaveBeenLastCalledWith(0.7)

    const perspective = screen.getByRole('radiogroup', { name: 'PERSPECTIVE' })
    expect(perspective).not.toBeNull()
    const as = screen.getByRole('radio', { name: 'As the Character' })
    const to = screen.getByRole('radio', { name: 'To the Character' })
    expect((to as HTMLInputElement).checked).toBe(true)
    await user.click(as)
    expect(onPerspectiveChange).toHaveBeenLastCalledWith('as')
    expect((as as HTMLInputElement).checked).toBe(true)
    expect((to as HTMLInputElement).checked).toBe(false)

    await user.click(toggle('Polite', 'As the Character'))
    expect(
      toggle('Polite', 'As the Character').getAttribute('aria-expanded'),
    ).toBe('false')
    expect(drawer.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('opening from the keyboard moves focus to the first setting, which Tab continues from', async () => {
    const user = userEvent.setup()
    renderComposer()
    const button = toggle()
    button.focus()
    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('slider', { name: 'Vibe' }),
      ),
    )
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('slider', { name: 'Temperature' }),
    )
    // Closing from the keyboard keeps focus on the toggle.
    button.focus()
    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await nextFrame()
    expect(document.activeElement).toBe(button)
  })

  it('moves the perspective choice from a seeded "As" to "To"', async () => {
    const user = userEvent.setup()
    const { onPerspectiveChange } = renderComposer({ perspective: 'as' })
    await user.click(toggle('Casual', 'As the Character'))
    const as = screen.getByRole<HTMLInputElement>('radio', {
      name: 'As the Character',
    })
    const to = screen.getByRole<HTMLInputElement>('radio', {
      name: 'To the Character',
    })
    expect(as.checked).toBe(true)
    await user.click(to)
    expect(onPerspectiveChange).toHaveBeenLastCalledWith('to')
    expect(to.checked).toBe(true)
    expect(as.checked).toBe(false)
    expect(toggle('Casual', 'To the Character')).toBeTruthy()
  })

  it('makes the perspective radios one tab stop that arrow keys move through', async () => {
    // user-event 14 models native radio groups by `name`: Tab stops only on
    // the checked radio and arrows walk the group. Radios with different
    // names, or taken out of the tab order, fail here.
    const user = userEvent.setup()
    const { onPerspectiveChange } = renderComposer()
    await user.click(toggle())
    const as = screen.getByRole<HTMLInputElement>('radio', {
      name: 'As the Character',
    })
    const to = screen.getByRole<HTMLInputElement>('radio', {
      name: 'To the Character',
    })
    expect(as.name).not.toBe('')
    expect(as.name).toBe(to.name)

    // Tab from the help button skips the unchecked "As" and lands on "To".
    screen.getByRole('button', { name: 'About perspective' }).focus()
    await user.tab()
    expect(document.activeElement).toBe(to)

    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(as)
    expect(as.checked).toBe(true)
    expect(to.checked).toBe(false)
    expect(onPerspectiveChange).toHaveBeenLastCalledWith('as')

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(to)
    expect(to.checked).toBe(true)
    expect(onPerspectiveChange).toHaveBeenLastCalledWith('to')

    // One Tab leaves the group; Shift+Tab comes back to the checked radio.
    await user.tab()
    expect(document.activeElement).not.toBe(as)
    expect(document.activeElement).not.toBe(to)
    expect(
      screen
        .getByRole('radiogroup', { name: 'PERSPECTIVE' })
        .contains(document.activeElement),
    ).toBe(false)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(to)
  })

  it('explains both perspectives from the "?" next to Perspective', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(toggle())
    const trigger = screen.getByRole('button', { name: 'About perspective' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Perspective' })
    for (const heading of ['As the Character', 'To the Character'])
      expect(
        within(dialog).getByRole('heading', { name: heading }),
      ).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Perspective' })).toBeNull(),
    )
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    // The radios are untouched by opening the help.
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'To the Character' })
        .checked,
    ).toBe(true)
  })

  it('shows the selected Vibe on the collapsed toggle', () => {
    renderComposer({ vibeIdx: 2 })
    const button = toggle('Keigo')
    expect(button.getAttribute('title')).toBe(
      'Translation settings · Keigo · To the Character',
    )
    const dot = button.querySelector<HTMLElement>('.composer__settings-vibe')
    expect(dot?.style.background).toBe('rgb(7, 8, 9)')
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('composer drafts', () => {
  it('persists the draft per account and restores it after a remount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderComposer({ draftOwner: 'u1' })
    await user.type(screen.getByRole('textbox'), 'Hello')
    expect(sessionStorage.getItem(storedKey('u1'))).toBe('{"t1":"Hello"}')
    unmount()
    renderComposer({ draftOwner: 'u1' })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Hello',
    )
  })

  it('never shows another account’s drafts, and keeps an ownerless draft in memory', async () => {
    const user = userEvent.setup()
    const { rerender } = renderComposer({ draftOwner: 'u1' })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'Secret')
    rerender({ draftOwner: 'u2' })
    expect(textarea.value).toBe('')
    await user.type(textarea, 'Mine')
    expect(sessionStorage.getItem(storedKey('u2'))).toBe('{"t1":"Mine"}')
    expect(sessionStorage.getItem(storedKey('u1'))).toBe('{"t1":"Secret"}')
    rerender({ draftOwner: 'u1' })
    expect(textarea.value).toBe('Secret')
    rerender({ draftOwner: null })
    expect(textarea.value).toBe('')
    await user.type(textarea, 'Offline')
    expect(textarea.value).toBe('Offline')
    expect(sessionStorage.length).toBe(2)
  })

  it('clears the persisted draft only after a successful send', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ draftOwner: 'u1' })
    onSend.mockResolvedValueOnce(false)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'Hello')
    await user.keyboard('{Enter}')
    // A 402/timeout keeps the source, in memory and in storage.
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello'))
    expect(textarea.value).toBe('Hello')
    expect(sessionStorage.getItem(storedKey('u1'))).toBe('{"t1":"Hello"}')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(textarea.value).toBe(''))
    expect(sessionStorage.getItem(storedKey('u1'))).toBeNull()
  })

  it('clears the stored draft when the send lands after the composer unmounted', async () => {
    const user = userEvent.setup()
    let land!: (ok: boolean) => void
    const { onSend, unmount } = renderComposer({ draftOwner: 'u1' })
    onSend.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          land = resolve
        }),
    )
    await user.type(screen.getByRole('textbox'), 'Hello')
    await user.keyboard('{Enter}')
    unmount()
    await act(async () => land(true))
    expect(sessionStorage.getItem(storedKey('u1'))).toBeNull()
  })

  it('keeps working in memory when storage throws', async () => {
    const fail = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(fail)
    const user = userEvent.setup()
    const { onSend } = renderComposer({ draftOwner: 'u1' })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    await user.type(textarea, 'Hello')
    expect(textarea.value).toBe('Hello')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(textarea.value).toBe(''))
    expect(onSend).toHaveBeenCalledWith('Hello')
  })
})
