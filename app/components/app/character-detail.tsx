import type { Character } from '@/lib/types'

type CharacterDetailProps = {
  character?: Character
}

export function CharacterDetail({ character }: CharacterDetailProps) {
  return (
    <aside className="rounded-lg border border-border bg-panel p-5">
      <h2 className="font-semibold">{character?.name ?? 'Character'}</h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Select a character to review default vibe, temperature, persona, and thread history.
      </p>
    </aside>
  )
}
