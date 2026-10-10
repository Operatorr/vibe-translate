// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VibePreset } from '@/components/vibe-design/design-data'
import { Composer } from '../composer'

const VIBES: VibePreset[] = [
  { id: 'casual', label: 'Casual', hint: 'friends', color: 'rgb(1, 2, 3)' },
  { id: 'polite', label: 'Polite', hint: 'teineigo', color: 'rgb(4, 5, 6)' },
  { id: 'keigo', label: 'Keigo', hint: 'honorific', color: 'rgb(7, 8, 9)' },
]
const storedKey = (owner: string) => `vibe-translate:drafts:${owner}`

type ComposerProps = React.ComponentProps<typeof Composer>

function renderComposer(props: Partial<ComposerProps> = {}) {
  const onVibeChange = vi.fn()
  const onTemperatureChange = vi.fn()
  const onTemperatureCommit = vi.fn()
  const onSend = vi.fn(async () => true)
  // Stateful like AppExperience, so controlled sliders actually move.
  function Harness(over: Partial<ComposerProps>) {
    const [vibeIdx, setVibeIdx] = React.useState(over.vibeIdx ?? 0)
    const [temperature, setTemperature] = React.useState(0.4)
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
    onSend,
  }
}

const toggle = (vibe = 'Casual') =>
  screen.getByRole('button', { name: `Vibe and temperature · ${vibe}` })
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
    const { onVibeChange, onTemperatureChange, onTemperatureCommit } =
      renderComposer()
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

    await user.click(toggle('Polite'))
    expect(toggle('Polite').getAttribute('aria-expanded')).toBe('false')
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

  it('shows the selected Vibe on the collapsed toggle', () => {
    renderComposer({ vibeIdx: 2 })
    const button = toggle('Keigo')
    expect(button.getAttribute('title')).toBe('Vibe and temperature · Keigo')
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
