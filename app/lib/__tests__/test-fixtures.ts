// Typed domain builders shared by the SPA data-layer tests. Not a test file:
// vitest only collects *.test.ts(x).
import type { SegmentCursor, SegmentPage } from '../segment-history'
import type { Character, Me, Segment, Thread } from '../types'

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: 'user-a',
    email: 'a@example.com',
    displayName: 'Fixture',
    tier: 'free',
    limits: {
      characters: 3,
      threadsPerCharacter: 10,
      credits: 100,
      retentionDays: 30,
      aiDictation: false,
      explain: false,
      translationMemory: false,
      customVibeStops: false,
      elevenLabsTts: false,
    },
    credits: { balance: 100, refilledAt: null },
    byok: {
      configured: false,
      last4: null,
      translateModelId: null,
      explainModelId: null,
    },
    onboardingComplete: true,
    ...overrides,
  }
}

export function makeCharacter(
  id: string,
  overrides: Partial<Character> = {},
): Character {
  return {
    id,
    name: `Character ${id}`,
    sourceLanguage: 'en-US',
    targetLanguage: 'ja-JP',
    defaultVibe: 'casual',
    temperature: 0.4,
    persona: { traits: [] },
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeThread(
  id: string,
  characterId: string,
  overrides: Partial<Thread> = {},
): Thread {
  return {
    id,
    characterId,
    title: `Thread ${id}`,
    starred: false,
    segmentCount: 0,
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeSegment(
  id: string,
  createdAt: string,
  overrides: Partial<Segment> = {},
): Segment {
  return {
    id,
    threadId: 't1',
    sourceText: `source ${id}`,
    targetText: `target ${id}`,
    vibe: 'casual',
    tokenAlignment: [],
    tokenUsage: {},
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

// The API's cursor is the page's oldest row, at microsecond precision.
export function cursorOf(segment: Segment): SegmentCursor {
  return {
    id: segment.id,
    createdAt: segment.createdAt.replace(/Z$/, '000Z'),
  }
}

// `segments` oldest first, like the API; a cursor means older rows exist.
export function makePage(segments: Segment[], hasOlder = false): SegmentPage {
  return {
    segments,
    nextCursor: hasOlder && segments[0] ? cursorOf(segments[0]) : null,
  }
}
