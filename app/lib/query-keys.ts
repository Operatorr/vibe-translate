export const keys = {
  me: ['me'] as const,
  characters: ['characters'] as const,
  threads: (characterId: string | null) => ['threads', characterId] as const,
  segments: (threadId: string | null) => ['segment-pages', threadId] as const,
  explain: (segmentId: string) => ['explain', segmentId] as const,
  share: (threadId: string) => ['share', threadId] as const,
}
