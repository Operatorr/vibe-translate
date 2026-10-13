// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CharacterPanel } from '../character-panel'

import type { Character } from '@/lib/types'

const character = (
  persona: Character['persona'],
  overrides: Partial<Character> = {},
): Character => ({
  id: 'c1',
  name: 'Lin',
  sourceLanguage: 'en-US',
  targetLanguage: 'zh-TW',
  defaultVibe: 'casual',
  perspective: 'to',
  temperature: 0.4,
  persona,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

const renderPanel = (persona: Character['persona'] = { traits: [] }) => {
  const onClose = vi.fn()
  const onSave = vi.fn()
  render(
    <CharacterPanel
      character={character(persona)}
      onClose={onClose}
      onSave={onSave}
      saving={false}
    />,
  )
  return { onClose, onSave, user: userEvent.setup() }
}

afterEach(cleanup)

describe('setting help dialogs inside the Character editor', () => {
  it.each(['verbosity', 'temperature', 'perspective'])(
    'Escape closes the %s help without closing the editor or losing edits',
    async (setting) => {
      const { onClose, user } = renderPanel()
      const name = screen.getByLabelText('Name')
      await user.clear(name)
      await user.type(name, 'Mei')

      const trigger = screen.getByRole('button', { name: `About ${setting}` })
      await user.click(trigger)
      expect(
        screen.getByRole('dialog', { name: new RegExp(setting, 'i') }),
      ).toBeTruthy()

      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: new RegExp(setting, 'i') }),
        ).toBeNull(),
      )
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Mei')
      await waitFor(() => expect(document.activeElement).toBe(trigger))

      // With the help closed, Escape goes back to dismissing the editor.
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )
})

describe('existing voice notes', () => {
  it('stay editable after being cleared, so they can be replaced', async () => {
    const { onSave, user } = renderPanel({
      formality: 'very formal',
      traits: [],
    })
    const notes = screen.getByLabelText<HTMLInputElement>(
      'Existing voice notes',
    )
    await user.tripleClick(notes)
    await user.keyboard('{Backspace}')
    expect(screen.getByLabelText('Existing voice notes')).toBe(notes)

    await user.type(notes, 'gentle but direct')
    await user.click(screen.getByRole('button', { name: 'Save character' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: expect.objectContaining({ formality: 'gentle but direct' }),
      }),
    )
  })

  it('are removed from the saved persona when left empty', async () => {
    const { onSave, user } = renderPanel({
      formality: 'very formal',
      traits: [],
    })
    await user.clear(screen.getByLabelText('Existing voice notes'))
    await user.click(screen.getByRole('button', { name: 'Save character' }))
    expect(onSave.mock.calls[0][0].persona).not.toHaveProperty('formality')
  })

  it('are not shown for Characters without them', () => {
    renderPanel()
    expect(screen.queryByLabelText('Existing voice notes')).toBeNull()
  })
})

describe('legacy-language Characters', () => {
  it('save unrelated edits without choosing a new language', async () => {
    const onSave = vi.fn()
    render(
      <CharacterPanel
        character={{
          ...character({ traits: [] }),
          sourceLanguage: 'ko-KR',
          targetLanguage: 'fr-FR',
        }}
        onClose={vi.fn()}
        onSave={onSave}
        saving={false}
      />,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Name'), 'a')
    await user.click(screen.getByRole('button', { name: 'Save character' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lina', targetLanguage: 'fr-FR' }),
    )
  })
})

describe('perspective in the Character editor', () => {
  const radio = (name: 'As the Character' | 'To the Character') =>
    screen.getByRole<HTMLInputElement>('radio', { name })
  // The compiled prompt preview: its PERSPECTIVE line names who is talking.
  const preview = () =>
    screen.getByText(/PERSPECTIVE: speaking (AS|TO) the character/).textContent
  const speaker = { age: '60s', traits: [] }

  const onSave = vi.fn()
  // Mounts and unmounts the panel like AppExperience, so reopening starts a
  // fresh draft from the saved Character.
  function Host({ saved }: { saved: Character | null }) {
    const [open, setOpen] = React.useState(true)
    return open ? (
      <CharacterPanel
        character={saved}
        onClose={() => setOpen(false)}
        onSave={onSave}
        saving={false}
      />
    ) : (
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
    )
  }
  const renderHost = (saved: Character | null) => {
    onSave.mockClear()
    render(<Host saved={saved} />)
    return userEvent.setup()
  }

  it('previews and saves a switch from "As" to "To"', async () => {
    const user = renderHost(character(speaker, { perspective: 'as' }))
    expect(radio('As the Character').checked).toBe(true)
    expect(radio('To the Character').checked).toBe(false)
    expect(preview()).toContain('PERSPECTIVE: speaking AS the character')
    expect(preview()).toContain('CHARACTER PERSONA (the speaker;')

    await user.click(radio('To the Character'))
    expect(radio('To the Character').checked).toBe(true)
    expect(radio('As the Character').checked).toBe(false)
    expect(preview()).toContain('PERSPECTIVE: speaking TO the character')
    expect(preview()).toContain('CHARACTER PERSONA (the person being addressed')
    expect(preview()).not.toContain('speaking AS')

    await user.click(screen.getByRole('button', { name: 'Save character' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0].perspective).toBe('to')
  })

  it('defaults a new Character to "To"', async () => {
    const user = renderHost(null)
    expect(radio('To the Character').checked).toBe(true)
    expect(preview()).toContain('PERSPECTIVE: speaking TO the character')
    await user.type(screen.getByLabelText('Name'), 'Mei')
    await user.click(screen.getByRole('button', { name: 'Create character' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Mei', perspective: 'to' }),
    )
  })

  it('drops an unsaved choice on Cancel, reopening with the saved one', async () => {
    const user = renderHost(character(speaker, { perspective: 'as' }))
    await user.click(radio('To the Character'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('radiogroup')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(radio('As the Character').checked).toBe(true)
    expect(preview()).toContain('PERSPECTIVE: speaking AS the character')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps "As" through an unrelated edit', async () => {
    const user = renderHost(character(speaker, { perspective: 'as' }))
    await user.type(screen.getByLabelText('Name'), 'a')
    await user.click(screen.getByRole('button', { name: 'Save character' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lina', perspective: 'as' }),
    )
  })
})
