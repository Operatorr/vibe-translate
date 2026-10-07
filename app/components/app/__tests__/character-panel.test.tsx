// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CharacterPanel } from '../character-panel'

import type { Character } from '@/lib/types'

const character = (persona: Character['persona']): Character => ({
  id: 'c1',
  name: 'Lin',
  sourceLanguage: 'en-US',
  targetLanguage: 'zh-TW',
  defaultVibe: 'casual',
  temperature: 0.4,
  persona,
  sortOrder: 0,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
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
  it.each(['verbosity', 'temperature'])(
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
