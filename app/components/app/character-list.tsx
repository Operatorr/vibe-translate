import type { Character } from '@/lib/types'

type CharacterListProps = {
  characters: Character[]
  isLoading: boolean
}

export function CharacterList({ characters, isLoading }: CharacterListProps) {
  if (isLoading) {
    return <p className="mt-6 text-sm text-muted">Loading characters...</p>
  }

  if (characters.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-border bg-panel p-8">
        <h2 className="font-semibold">No characters yet</h2>
        <p className="mt-2 text-sm text-muted">Create character API wiring is scaffolded and ready.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-3">
      {characters.map((character) => (
        <article key={character.id} className="rounded-lg border border-border bg-panel p-4">
          <h2 className="font-semibold">{character.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {character.sourceLanguage} → {character.targetLanguage} · vibe: {character.defaultVibe}
          </p>
        </article>
      ))}
    </div>
  )
}
