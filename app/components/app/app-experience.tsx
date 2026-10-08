import { Link } from '@tanstack/react-router'
import * as React from 'react'
import { toast } from 'sonner'

import {
  LANG_FLAG,
  LANG_NAME,
  getVibesForLang,
} from '@/components/vibe-design/design-data'
import { Icon } from '@/components/vibe-design/icon'
import {
  DEFAULT_PALETTE_ITEMS,
  type PaletteItem,
} from '@/components/vibe-design/palette-items'
import { CommandPalette, SiteNav } from '@/components/vibe-design/shell'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import {
  useAppBootstrap,
  useCharacters,
  useCreateCharacter,
  useCreateSegment,
  useCreateThread,
  useDeleteCharacter,
  useDeleteThread,
  useExplain,
  useMe,
  useRetrySegment,
  useSegments,
  useSetThreadShare,
  useThreadShare,
  useThreads,
  useTtsFetch,
  useUpdateCharacter,
  useUpdateMe,
  useUpdateThread,
  type CharacterInput,
} from '@/hooks/use-app-data'
import { ApiError, apiFetch } from '@/lib/api'
import { authClient, signOut } from '@/lib/auth-client'
import { toCharacterPatch } from '@/lib/character-draft'
import { cssVars } from '@/lib/css-vars'
import {
  downloadTextFile,
  slugify,
  threadToMarkdown,
} from '@/lib/markdown-export'
import { timeAgo } from '@/lib/time'
import { speak, stopSpeaking } from '@/lib/tts'
import type { Character, Segment, Thread, VibeStop } from '@/lib/types'
import { copyText } from '@/lib/clipboard'
import { initialsFor } from '@/lib/initials'

import { AccountMenu } from './account-menu'
import { CharacterPanel } from './character-panel'
import { Composer, type ComposerHandle } from './composer'
import {
  PendingSegmentCard,
  SegmentCard,
  type SegmentView,
} from './segment-card'
import { historySegments } from '@/lib/segment-history'

import { SharePopover, ThreadOptionsMenu } from './thread-menus'

const FLAGS = LANG_FLAG as Record<string, string>
const LANGUAGE_NAMES = LANG_NAME as Record<string, string>
const NEW_THREAD_TITLE = 'New thread'
const ACTIVE_CHAR_KEY = 'vibe-translate:active-character'
const NARROW_QUERY = '(max-width: 900px)'

type Pane = 'chars' | 'threads' | 'workspace'
const PANE_DEPTH: Record<Pane, number> = { chars: 0, threads: 1, workspace: 2 }
type PaneHistoryState = { vtPane?: Pane; vtStack?: number } | null
type Panel = { mode: 'create' } | { mode: 'edit'; character: Character } | null

const langName = (code: string) => LANGUAGE_NAMES[code] ?? code

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 402)
      return 'Out of credits — upgrade or add an OpenRouter key.'
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

// Scoped per signed-in user so switching accounts on one device doesn't carry the
// previous user's selection over.
const activeCharKey = (userId: string | null | undefined) =>
  `${ACTIVE_CHAR_KEY}:${userId ?? 'anon'}`

function readStoredCharacter(userId: string | null | undefined): string | null {
  try {
    return localStorage.getItem(activeCharKey(userId))
  } catch {
    return null
  }
}

function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: Thread
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={'thread ' + (active ? 'thread--active' : '')}
      onClick={() => onSelect(thread.id)}
    >
      <p className="thread__title">
        {thread.starred && <Icon name="star" fill className="thread__star" />}
        {thread.title}
      </p>
      <div className="thread__meta">
        <span className="count">
          {thread.segmentCount} translation
          {thread.segmentCount === 1 ? '' : 's'}
        </span>
        <span className="thread__sep">·</span>
        <time dateTime={thread.updatedAt}>{timeAgo(thread.updatedAt)}</time>
      </div>
    </button>
  )
}

export function AppExperience() {
  const frame = useVibeFrame('/app')
  const userId = authClient.useSession().data?.user.id

  // ---- data ---------------------------------------------------------------
  const [storedCharId] = React.useState(() => readStoredCharacter(userId))
  const bootstrap = useAppBootstrap(storedCharId)
  const domainReady = !bootstrap.isFetching
  const me = useMe(domainReady)
  const characters = useCharacters(domainReady)
  const [activeCharId, setActiveCharIdState] = React.useState<string | null>(
    storedCharId,
  )
  const setActiveCharId = React.useCallback(
    (id: string | null) => {
      setActiveCharIdState(id)
      try {
        if (id) localStorage.setItem(activeCharKey(userId), id)
      } catch {
        // ignore
      }
    },
    [userId],
  )
  const charList = React.useMemo(() => characters.data ?? [], [characters.data])
  const char = charList.find((c) => c.id === activeCharId) ?? null

  React.useEffect(() => {
    if (!characters.data) return
    if (!char && characters.data.length > 0)
      setActiveCharId(characters.data[0].id)
  }, [characters.data, char, setActiveCharId])

  const threads = useThreads(char?.id ?? null)
  const threadList = React.useMemo(() => threads.data ?? [], [threads.data])
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(
    null,
  )
  const thread = threadList.find((t) => t.id === activeThreadId) ?? null

  // Account switch without a remount: restore that user's own selection.
  const lastUserId = React.useRef(userId)
  React.useEffect(() => {
    if (lastUserId.current === userId) return
    lastUserId.current = userId
    setActiveCharIdState(readStoredCharacter(userId))
    setActiveThreadId(null)
  }, [userId])

  React.useEffect(() => {
    if (!threads.data) return
    if (!thread) setActiveThreadId(threads.data[0]?.id ?? null)
  }, [threads.data, thread])

  const segments = useSegments(thread?.id ?? null)
  const segList = React.useMemo(
    () => historySegments(segments.data),
    [segments.data],
  )
  // Newest first on screen; the API returns oldest first.
  const ordered = React.useMemo(() => [...segList].reverse(), [segList])

  // ---- mutations ----------------------------------------------------------
  const createCharacter = useCreateCharacter()
  const updateCharacter = useUpdateCharacter()
  const deleteCharacter = useDeleteCharacter()
  const createThread = useCreateThread()
  const updateThread = useUpdateThread()
  const deleteThread = useDeleteThread()
  const createSegment = useCreateSegment()
  const retrySegment = useRetrySegment()
  const updateMe = useUpdateMe()
  const [shareOpen, setShareOpen] = React.useState(false)
  const share = useThreadShare(thread?.id ?? null, shareOpen)
  const setShare = useSetThreadShare()
  const fetchTts = useTtsFetch()

  // ---- ui state -----------------------------------------------------------
  const [pane, setPane] = React.useState<Pane>(() => {
    if (!window.matchMedia(NARROW_QUERY).matches) return 'workspace'
    return (
      (window.history.state as PaneHistoryState)?.vtPane ??
      (storedCharId ? 'workspace' : 'chars')
    )
  })
  // Below the breakpoint the columns are a stack: going deeper pushes a history
  // entry so the hardware/gesture back button steps chars ← threads ← workspace
  // instead of leaving /app. In-UI back chevrons pop those same entries.
  const paneRef = React.useRef(pane)
  const stackRef = React.useRef(
    (window.history.state as PaneHistoryState)?.vtStack ?? 0,
  )
  const pendingPaneRef = React.useRef<Pane | null>(null)
  React.useEffect(() => {
    paneRef.current = pane
  }, [pane])
  React.useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as PaneHistoryState
      stackRef.current = state?.vtStack ?? 0
      const next = pendingPaneRef.current ?? state?.vtPane ?? 'workspace'
      pendingPaneRef.current = null
      setPane(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const goPane = React.useCallback((next: Pane) => {
    const curr = paneRef.current
    if (next === curr) return
    if (!window.matchMedia(NARROW_QUERY).matches) {
      setPane(next)
      return
    }
    if (PANE_DEPTH[next] > PANE_DEPTH[curr]) {
      stackRef.current += 1
      window.history.pushState(
        { ...window.history.state, vtPane: next, vtStack: stackRef.current },
        '',
      )
      paneRef.current = next
      setPane(next)
      return
    }
    const steps = Math.min(
      stackRef.current,
      PANE_DEPTH[curr] - PANE_DEPTH[next],
    )
    if (steps > 0) {
      pendingPaneRef.current = next
      window.history.go(-steps)
    } else {
      paneRef.current = next
      setPane(next)
    }
  }, [])
  // The pane stack only exists below the breakpoint; widening past it (resize,
  // rotation) drops back to the workspace so re-narrowing doesn't strand the
  // user on a sidebar.
  React.useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = () => {
      if (!mq.matches) setPane('workspace')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const [panel, setPanel] = React.useState<Panel>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [explainOpenId, setExplainOpenId] = React.useState<string | null>(null)
  const [speakingId, setSpeakingId] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const [renameDraft, setRenameDraft] = React.useState('')
  const composerRef = React.useRef<ComposerHandle>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  // Threads created by "new thread" in this session that still carry the
  // placeholder title. Only these get auto-titled from the first translation
  // (a user who names a thread "New thread" keeps it), and an empty one is
  // reused instead of minting duplicates on repeated ⌘N.
  const autoTitled = React.useRef<Set<string>>(new Set())
  // In-flight temperature PATCH; send waits for it so the worker translates at
  // the temperature the header shows.
  const tempCommit = React.useRef<Promise<unknown> | null>(null)
  // Serialize star/share toggles: two fast clicks would both read the same
  // pre-toggle state.
  const starBusy = React.useRef(false)
  const shareBusy = React.useRef(false)

  const vibes = React.useMemo(
    () => getVibesForLang(char?.targetLanguage ?? 'ja-JP'),
    [char?.targetLanguage],
  )
  const [vibeIdx, setVibeIdx] = React.useState(0)
  const [temp, setTemp] = React.useState(0.4)
  // Separate effects: committing the temperature PATCHes the Character, and that
  // must not snap the Vibe slider back to the Character's default stop.
  const charId = char?.id
  const charDefaultVibe = char?.defaultVibe
  const charTemperature = char?.temperature
  React.useEffect(() => {
    if (!charId || !charDefaultVibe) return
    setVibeIdx(
      Math.max(
        0,
        vibes.findIndex((v) => v.id === charDefaultVibe),
      ),
    )
  }, [charId, charDefaultVibe, vibes])
  React.useEffect(() => {
    if (charId && charTemperature !== undefined) setTemp(charTemperature)
  }, [charId, charTemperature])

  React.useEffect(() => {
    setExplainOpenId(null)
    setExpanded(new Set())
    setRenaming(false)
    stopSpeaking()
    setSpeakingId(null)
  }, [thread?.id])

  const explain = useExplain(explainOpenId, explainOpenId !== null)

  // ---- actions ------------------------------------------------------------
  const selectCharacter = (id: string) => {
    setActiveCharId(id)
    setActiveThreadId(null)
    goPane('threads')
  }
  const selectThread = (id: string) => {
    setActiveThreadId(id)
    goPane('workspace')
  }

  const newThread = React.useCallback(async () => {
    if (!char) {
      setPanel({ mode: 'create' })
      return null
    }
    const open = (t: Thread) => {
      setActiveThreadId(t.id)
      goPane('workspace')
      requestAnimationFrame(() => composerRef.current?.focus())
      return t
    }
    const blank = threadList.find(
      (t) => t.segmentCount === 0 && autoTitled.current.has(t.id),
    )
    if (blank) return open(blank)
    if (createThread.isPending) return null
    try {
      const created = await createThread.mutateAsync({
        characterId: char.id,
        title: NEW_THREAD_TITLE,
      })
      autoTitled.current.add(created.id)
      return open(created)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not create the thread.'))
      return null
    }
  }, [char, createThread, threadList, goPane])

  // Serialize within a thread (or a character's not-yet-created thread), while
  // allowing translations in other threads to proceed independently.
  const sendingRef = React.useRef(new Set<string>())
  const [pendingSends, setPendingSends] = React.useState<
    Map<string, { sourceText: string; vibe: VibeStop }>
  >(() => new Map())
  const composerContext = thread?.id ?? `new:${char?.id ?? ''}`
  const activeThreadRef = React.useRef(activeThreadId)
  activeThreadRef.current = activeThreadId
  // Resolves true when the Segment landed, so the composer knows to clear.
  const send = async (text: string): Promise<boolean> => {
    // While the thread list is loading, "no active thread" is unknown, not
    // "create one" — sending now would mint a spare thread.
    if (!char || threads.isPending || sendingRef.current.has(composerContext))
      return false
    const locked = [composerContext]
    const pending = { sourceText: text, vibe: vibes[vibeIdx].id as VibeStop }
    sendingRef.current.add(composerContext)
    setPendingSends((prev) => new Map(prev).set(composerContext, pending))
    try {
      let target: Thread | null = thread
      if (!target) target = await newThread()
      if (!target) return false
      if (target.id !== composerContext) {
        if (sendingRef.current.has(target.id)) return false
        locked.push(target.id)
        sendingRef.current.add(target.id)
        setPendingSends((prev) => new Map(prev).set(target.id, pending))
      }
      // A thread that wasn't in the list before this send was created for it.
      const createdForSend = threadList.some((t) => t.id === target.id)
        ? null
        : target
      const vibe = pending.vibe
      await tempCommit.current
      let created
      try {
        created = await createSegment.mutateAsync({
          threadId: target.id,
          sourceText: text,
          vibe,
        })
      } catch (error) {
        toast.error(errorMessage(error, 'Translation failed.'))
        // Don't leave an empty thread behind for a translation that never landed.
        if (createdForSend) {
          autoTitled.current.delete(createdForSend.id)
          deleteThread.mutate({ id: createdForSend.id, characterId: char.id })
        }
        return false
      }
      // A background completion must not collapse or scroll the thread the
      // user has switched to in the meantime.
      if (activeThreadRef.current === target.id) {
        setExpanded(new Set())
        setExplainOpenId(null)
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (autoTitled.current.has(target.id)) {
        autoTitled.current.delete(target.id)
        const title =
          text.replace(/\s+/g, ' ').slice(0, 60).trim() || NEW_THREAD_TITLE
        updateThread.mutate({ id: target.id, characterId: char.id, title })
      }
      if (!created.tokenAlignment.length)
        toast.message('Translated (alignment unavailable).')
      return true
    } finally {
      locked.forEach((key) => sendingRef.current.delete(key))
      setPendingSends((prev) => {
        const next = new Map(prev)
        locked.forEach((key) => next.delete(key))
        return next
      })
    }
  }

  const commitTemperature = (value: number) => {
    if (!char || Math.abs(value - char.temperature) < 0.001) return
    const saved = char.temperature
    const commit = updateCharacter
      .mutateAsync({ id: char.id, temperature: Math.round(value * 100) / 100 })
      .catch((error: unknown) => {
        // Don't leave the header showing a temperature the worker won't use.
        setTemp(saved)
        toast.error(errorMessage(error, 'Could not save the temperature.'))
      })
      .finally(() => {
        if (tempCommit.current === commit) tempCommit.current = null
      })
    tempCommit.current = commit
  }

  const copySegment = async (seg: SegmentView) => {
    try {
      await copyText(seg.targetText)
      toast.success('Copied translation.')
    } catch {
      toast.error('Copy failed.')
    }
  }

  const retry = (seg: SegmentView) => {
    if (!thread) return
    retrySegment.mutate(
      { id: seg.id, threadId: thread.id },
      {
        onSuccess: () => {
          if (explainOpenId === seg.id) setExplainOpenId(null)
          toast.success('Re-translated.')
        },
        onError: (error) => toast.error(errorMessage(error, 'Retry failed.')),
      },
    )
  }

  const speakSegment = async (seg: SegmentView) => {
    if (!char) return
    if (speakingId === seg.id) {
      stopSpeaking()
      setSpeakingId(null)
      return
    }
    setSpeakingId(seg.id)
    // Eligibility comes from /api/users/me; if it hasn't loaded yet, wait for
    // it rather than silently playing the browser voice on the first Speak.
    const limits = me.data?.limits ?? (await me.refetch()).data?.limits
    const useElevenLabs =
      limits?.elevenLabsTts === true && /^ja([-_]|$)/i.test(char.targetLanguage)
    try {
      await speak({
        text: seg.targetText,
        languageCode: char.targetLanguage,
        vibe: seg.vibe ?? 'casual',
        fetchAudio: useElevenLabs ? fetchTts : undefined,
        onStart: (engine) => {
          if (useElevenLabs && engine === 'browser')
            toast.message(
              'Premium voice unavailable — using the browser voice.',
            )
        },
        onEnd: () => setSpeakingId((id) => (id === seg.id ? null : id)),
      })
    } catch (error) {
      // Only reached on a genuine failure: a stopped or superseded utterance
      // resolves quietly inside speak().
      setSpeakingId((id) => (id === seg.id ? null : id))
      toast.error(errorMessage(error, 'Playback failed.'))
    }
  }

  const markdownFor = async () =>
    thread && char
      ? threadToMarkdown({
          title: thread.title,
          character: char,
          // Export is deliberately complete, even when only one UI page loaded.
          segments: await apiFetch<Segment[]>(
            `/api/segments?threadId=${thread.id}`,
          ),
          shareUrl: share.data?.url ?? null,
        })
      : null

  const download = async () => {
    if (!thread) return
    try {
      const md = await markdownFor()
      if (!md) return
      downloadTextFile(`${slugify(thread.title)}.md`, md)
      toast.success('Markdown download started.')
    } catch {
      toast.error('Download failed — try “Copy as Markdown” instead.')
    }
  }

  const copyMarkdown = async () => {
    try {
      const md = await markdownFor()
      if (!md) return
      await copyText(md)
      toast.success('Thread copied as Markdown.')
    } catch {
      toast.error('Copy failed.')
    }
  }

  const toggleStar = () => {
    if (!thread || !char || starBusy.current) return
    starBusy.current = true
    updateThread.mutate(
      { id: thread.id, characterId: char.id, starred: !thread.starred },
      {
        onError: (error) =>
          toast.error(errorMessage(error, 'Could not update the star.')),
        onSettled: () => {
          starBusy.current = false
        },
      },
    )
  }

  const toggleShare = (shared: boolean) => {
    if (!thread || shareBusy.current) return
    shareBusy.current = true
    setShare.mutate(
      { threadId: thread.id, shared },
      {
        onSettled: () => {
          shareBusy.current = false
        },
        onSuccess: (res) => {
          if (res.shared && res.url) {
            void copyText(res.url).then(
              () => toast.success('Public link created and copied.'),
              () => toast.success('Public link created.'),
            )
          } else toast.message('Public link disabled.')
        },
        onError: (error) =>
          toast.error(errorMessage(error, 'Could not update sharing.')),
      },
    )
  }

  // One commit path per rename session: Enter and Escape both unmount the input,
  // which fires onBlur — without this guard Escape would save and Enter would
  // PATCH twice.
  const renameDoneRef = React.useRef(false)
  const startRename = () => {
    if (!thread) return
    renameDoneRef.current = false
    setRenameDraft(thread.title)
    setRenaming(true)
  }
  const finishRename = (save: boolean) => {
    if (renameDoneRef.current) return
    renameDoneRef.current = true
    setRenaming(false)
    const title = renameDraft.trim()
    if (!save || !thread || !char || !title || title === thread.title) return
    autoTitled.current.delete(thread.id)
    updateThread.mutate(
      { id: thread.id, characterId: char.id, title },
      {
        onError: (error) => toast.error(errorMessage(error, 'Rename failed.')),
      },
    )
  }

  const archiveThread = () => {
    if (!thread || !char) return
    updateThread.mutate(
      { id: thread.id, characterId: char.id, archived: true },
      {
        onSuccess: () => {
          toast.success('Thread archived.')
          setActiveThreadId(null)
        },
        onError: (error) => toast.error(errorMessage(error, 'Archive failed.')),
      },
    )
  }

  const removeThread = () => {
    if (!thread || !char) return
    if (
      !window.confirm(
        `Delete "${thread.title}" and its ${thread.segmentCount} translations?`,
      )
    )
      return
    deleteThread.mutate(
      { id: thread.id, characterId: char.id },
      {
        onSuccess: () => {
          toast.success('Thread deleted.')
          setActiveThreadId(null)
        },
        onError: (error) => toast.error(errorMessage(error, 'Delete failed.')),
      },
    )
  }

  const saveCharacter = async (input: CharacterInput) => {
    try {
      if (panel?.mode === 'edit') {
        await updateCharacter.mutateAsync({
          id: panel.character.id,
          ...toCharacterPatch(input, panel.character),
        })
        toast.success('Character saved.')
      } else {
        const created = await createCharacter.mutateAsync(input)
        setActiveCharId(created.id)
        setActiveThreadId(null)
        goPane('threads')
        toast.success(`${created.name} is ready.`)
        // Also when `me` hasn't loaded yet — the PATCH is idempotent.
        if (!me.data?.onboardingComplete)
          updateMe.mutate({ onboardingComplete: true })
      }
      setPanel(null)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the character.'))
    }
  }

  const removeCharacter = () => {
    if (panel?.mode !== 'edit') return
    // Type-to-confirm happens inside CharacterPanel before this is called.
    const target = panel.character
    deleteCharacter.mutate(target.id, {
      onSuccess: () => {
        setPanel(null)
        if (activeCharId === target.id) {
          setActiveCharId(null)
          setActiveThreadId(null)
        }
        toast.success('Character deleted.')
      },
      onError: (error) => toast.error(errorMessage(error, 'Delete failed.')),
    })
  }

  // ---- keyboard -----------------------------------------------------------
  // `frame` is a fresh object every render; depend on its stable callback so
  // the window listener isn't torn down and re-added on each paint.
  const toggleTheme = frame.onToggleTheme
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void newThread()
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'l'
      ) {
        event.preventDefault()
        toggleTheme()
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread, toggleTheme])

  // ---- palette ------------------------------------------------------------
  const paletteItems = React.useMemo<PaletteItem[]>(
    () => [
      ...DEFAULT_PALETTE_ITEMS,
      {
        id: 'new-character',
        label: 'New character',
        icon: 'user-plus',
        hint: null,
      },
      ...charList.map((c) => ({
        id: `char:${c.id}`,
        label: `Open ${c.name}`,
        icon: 'user-square',
        group: 'character',
      })),
      ...threadList.map((t) => ({
        id: `thread:${t.id}`,
        label: t.title,
        icon: 'file-text',
        group: 'thread',
      })),
    ],
    [charList, threadList],
  )
  const onPalettePick = (id: string) => {
    if (id === 'theme') frame.onToggleTheme()
    else if (id === 'new') void newThread()
    else if (id === 'focus')
      requestAnimationFrame(() => composerRef.current?.focus())
    else if (id === 'new-character') setPanel({ mode: 'create' })
    else if (id === 'logout') void signOut()
    else if (id.startsWith('char:')) selectCharacter(id.slice(5))
    else if (id.startsWith('thread:')) selectThread(id.slice(7))
  }

  // ---- derived ------------------------------------------------------------
  const activeVibe = vibes[vibeIdx] ?? vibes[0]
  const starred = threadList.filter((t) => t.starred)
  const recent = threadList.filter((t) => !t.starred)
  const pendingSend = pendingSends.get(composerContext)
  const pendingHere = !!pendingSend
  const retryingId = retrySegment.isPending ? retrySegment.variables?.id : null
  const credits = me.data?.credits.balance
  const tier = me.data?.tier ?? 'free'
  const loadingChars = characters.isLoading && !characters.data

  const threadRow = (t: Thread) => (
    <ThreadRow
      key={t.id}
      thread={t}
      active={t.id === thread?.id}
      onSelect={selectThread}
    />
  )

  return (
    <div className="app-shell">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/app"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
        account={<AccountMenu />}
      />
      <div className="app-body" data-pane={pane}>
        {/* CHARACTERS sidebar */}
        <aside className="chars">
          <div className="chars__head">
            <span className="chars__head-title">
              CHARACTERS · {charList.length}
            </span>
            <button
              type="button"
              className="chars__new"
              aria-label="New character"
              title="New character"
              onClick={() => setPanel({ mode: 'create' })}
            >
              <Icon name="plus" />
            </button>
          </div>
          <div className="chars__list">
            {loadingChars && <div className="chars__empty">Loading…</div>}
            {characters.isError && !characters.data && (
              <div className="chars__empty">
                <p>Could not load characters.</p>
                <button
                  type="button"
                  className="vt-btn vt-btn--ghost vt-btn--block"
                  onClick={() => void characters.refetch()}
                >
                  Try again
                </button>
              </div>
            )}
            {characters.data && charList.length === 0 && (
              <div className="chars__empty">
                <p>No characters yet.</p>
                <button
                  type="button"
                  className="vt-btn vt-btn--primary vt-btn--block"
                  onClick={() => setPanel({ mode: 'create' })}
                >
                  <Icon name="user-plus" /> Create your first character
                </button>
              </div>
            )}
            {charList.map((c) => (
              <button
                key={c.id}
                type="button"
                className={'char ' + (c.id === char?.id ? 'char--active' : '')}
                style={cssVars({
                  '--char-color': c.color ?? 'var(--blue-400)',
                })}
                onClick={() => selectCharacter(c.id)}
              >
                <div
                  className="char__avatar"
                  style={{ background: c.color ?? 'var(--blue-400)' }}
                >
                  {c.initials || initialsFor(c.name)}
                </div>
                <div className="char__body">
                  <div className="char__name">{c.name}</div>
                  <div className="char__meta">
                    {FLAGS[c.sourceLanguage] ?? c.sourceLanguage}
                    <span className="arrow">→</span>
                    {FLAGS[c.targetLanguage] ?? c.targetLanguage} ·{' '}
                    {
                      getVibesForLang(c.targetLanguage).find(
                        (v) => v.id === c.defaultVibe,
                      )?.label
                    }
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="chars__foot">
            <Link className="vt-side-foot chars__status" to="/pricing">
              <div
                className="vt-status-dot"
                style={{
                  background:
                    tier === 'free' ? 'var(--amber-400)' : 'var(--turq-400)',
                }}
              ></div>
              <div className="vt-status-text">
                {tier === 'free' ? 'Free' : tier === 'pro' ? 'Pro' : 'Team'}
                {credits !== undefined &&
                  ` · ${credits.toLocaleString()} credits`}
              </div>
              <Icon name="external-link" className="vt-status-ext" />
            </Link>
          </div>
        </aside>

        {/* THREADS sidebar */}
        <aside className="threads">
          {char ? (
            <>
              <div
                className="threads__head"
                style={cssVars({
                  '--char-color': char.color ?? 'var(--blue-400)',
                })}
              >
                <div className="threads__char-row">
                  <button
                    type="button"
                    className="mobile-only mobile-back"
                    onClick={() => goPane('chars')}
                    aria-label="Back to characters"
                  >
                    <Icon name="chevron-left" />
                  </button>
                  <div
                    className="threads__char-avatar"
                    style={{ background: char.color ?? 'var(--blue-400)' }}
                  >
                    {char.initials || initialsFor(char.name)}
                  </div>
                  <div className="threads__char-info">
                    <div className="threads__char-name">{char.name}</div>
                    <div className="threads__char-meta">
                      {langName(char.sourceLanguage)} →{' '}
                      {langName(char.targetLanguage)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="threads__customize"
                  onClick={() => setPanel({ mode: 'edit', character: char })}
                >
                  <span className="threads__customize-label">
                    <Icon name="settings-2" />
                    Customize character
                  </span>
                  <Icon name="chevron-right" />
                </button>
                <button
                  type="button"
                  className="threads__newbtn"
                  onClick={() => void newThread()}
                  disabled={createThread.isPending}
                >
                  <Icon name="plus" /> New translation thread
                </button>
              </div>
              <div className="threads__list">
                {starred.length > 0 && (
                  <>
                    <div className="threads__group-h">STARRED</div>
                    {starred.map(threadRow)}
                  </>
                )}
                {recent.length > 0 && (
                  <div className="threads__group-h">RECENT</div>
                )}
                {threads.isLoading && !threads.data && (
                  <div className="threads__empty">Loading…</div>
                )}
                {threads.isError && !threads.data && (
                  <div className="threads__empty">
                    Could not load threads.{' '}
                    <button
                      type="button"
                      className="vt-btn vt-btn--ghost"
                      onClick={() => void threads.refetch()}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {threads.data && threadList.length === 0 && (
                  <div className="threads__empty">
                    No threads yet — start one above.
                  </div>
                )}
                {recent.map(threadRow)}
              </div>
            </>
          ) : (
            <div className="threads__empty threads__empty--pane">
              <button
                type="button"
                className="mobile-only mobile-back"
                onClick={() => goPane('chars')}
                aria-label="Back to characters"
              >
                <Icon name="chevron-left" />
              </button>
              Pick a character to see their threads.
            </div>
          )}
        </aside>

        {/* WORKSPACE */}
        <main className="workspace">
          <div className="workspace__head">
            <div className="workspace__head-left">
              <button
                type="button"
                className="mobile-only mobile-back"
                onClick={() => goPane('threads')}
                aria-label="Back to threads"
              >
                <Icon name="chevron-left" />
              </button>
              <div className="workspace__title-block">
                {renaming ? (
                  <input
                    className="workspace__rename"
                    autoFocus
                    value={renameDraft}
                    aria-label="Thread title"
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => finishRename(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') finishRename(true)
                      if (e.key === 'Escape') finishRename(false)
                    }}
                  />
                ) : (
                  <h2
                    className="workspace__title"
                    onDoubleClick={startRename}
                    title="Double-click to rename"
                  >
                    {thread?.title ?? (char ? 'New translation' : 'Welcome')}
                  </h2>
                )}
                {char && (
                  <div className="workspace__pair">
                    {FLAGS[char.sourceLanguage]} {langName(char.sourceLanguage)}
                    <span className="arrow">→</span>
                    {FLAGS[char.targetLanguage]} {langName(char.targetLanguage)}
                    <span className="arrow">·</span>
                    <span style={{ color: activeVibe?.color }}>
                      {activeVibe?.label}
                    </span>
                    <span className="arrow">·</span>
                    T={temp.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            {thread && char && (
              <div className="workspace__head-right">
                <button
                  type="button"
                  className={
                    'workspace__icon-btn ' +
                    (thread.starred ? 'is-active is-star' : '')
                  }
                  title={thread.starred ? 'Unstar' : 'Star'}
                  aria-label={thread.starred ? 'Unstar thread' : 'Star thread'}
                  aria-pressed={thread.starred}
                  onClick={toggleStar}
                >
                  <Icon name="star" fill={thread.starred} />
                </button>
                <SharePopover
                  onOpenChange={setShareOpen}
                  error={share.isError}
                  onRetry={() => void share.refetch()}
                  share={share.data}
                  loading={share.isPending || setShare.isPending}
                  onToggle={toggleShare}
                />
                <button
                  type="button"
                  className="workspace__icon-btn"
                  title="Download as Markdown"
                  aria-label="Download as Markdown"
                  onClick={() => void download()}
                  disabled={segList.length === 0}
                >
                  <Icon name="download" />
                </button>
                <ThreadOptionsMenu
                  onRename={startRename}
                  onArchive={archiveThread}
                  onDelete={removeThread}
                  onCopyMarkdown={() => void copyMarkdown()}
                  onClearExplain={
                    explainOpenId ? () => setExplainOpenId(null) : undefined
                  }
                />
              </div>
            )}
          </div>

          <div className="workspace__scroll" ref={scrollRef}>
            {characters.isError && !characters.data ? (
              <div className="welcome">
                <Icon name="alert-triangle" className="welcome__icon" />
                <h3 className="welcome__title">
                  Could not load your characters
                </h3>
                <p className="welcome__sub">
                  {errorMessage(
                    characters.error,
                    'Check your connection and try again.',
                  )}
                </p>
                <button
                  type="button"
                  className="vt-btn vt-btn--primary"
                  onClick={() => void characters.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : !char ? (
              <div className="welcome">
                <Icon name="languages" className="welcome__icon" />
                <h3 className="welcome__title">Who are you translating for?</h3>
                <p className="welcome__sub">
                  A character carries the intent — language pair, vibe, dialect,
                  personality — so you never have to spell out the language and
                  tone with every request.
                </p>
                <button
                  type="button"
                  className="vt-btn vt-btn--primary"
                  onClick={() => setPanel({ mode: 'create' })}
                >
                  <Icon name="user-plus" /> Create a character
                </button>
              </div>
            ) : segments.isError && !segments.data && thread ? (
              <div className="welcome">
                <Icon name="alert-triangle" className="welcome__icon" />
                <h3 className="welcome__title">Could not load this thread</h3>
                <p className="welcome__sub">
                  {errorMessage(
                    segments.error,
                    'Check your connection and try again.',
                  )}
                </p>
                <button
                  type="button"
                  className="vt-btn vt-btn--primary"
                  onClick={() => void segments.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : segments.isLoading && !segments.data && thread ? (
              <div className="welcome">
                <Icon
                  name="loader"
                  className="welcome__icon welcome__icon--sm vt-spin"
                />
              </div>
            ) : ordered.length === 0 && !pendingHere ? (
              <div className="welcome">
                <Icon name="languages" className="welcome__icon" />
                <h3 className="welcome__title">No translations yet</h3>
                <p className="welcome__sub">
                  Type below to translate something. The settings for{' '}
                  {char.name} carry the intent — you don't have to say
                  "translate to {langName(char.targetLanguage)}."
                </p>
              </div>
            ) : (
              <>
                {pendingSend && (
                  <PendingSegmentCard
                    idx={segList.length + 1}
                    sourceText={pendingSend.sourceText}
                    sourceLanguage={char.sourceLanguage}
                    targetLanguage={char.targetLanguage}
                    vibe={vibes.find((v) => v.id === pendingSend.vibe)}
                  />
                )}
                {ordered.map((s, i) => (
                  <SegmentCard
                    key={s.id}
                    seg={s}
                    idx={(thread?.segmentCount ?? ordered.length) - i}
                    isActive={i === 0 && !pendingHere}
                    collapsed={
                      !(i === 0 && !pendingHere) && !expanded.has(s.id)
                    }
                    sourceLanguage={char.sourceLanguage}
                    targetLanguage={char.targetLanguage}
                    vibes={vibes}
                    onExpand={(id) =>
                      setExpanded((prev) => new Set(prev).add(id))
                    }
                    explain={{
                      open: explainOpenId === s.id,
                      body:
                        explainOpenId === s.id ? explain.data?.body : undefined,
                      isLoading: explainOpenId === s.id && explain.isLoading,
                      error: explainOpenId === s.id ? explain.error : null,
                      onToggle: () =>
                        setExplainOpenId((curr) =>
                          curr === s.id ? null : s.id,
                        ),
                      onRetry: () => void explain.refetch(),
                    }}
                    onCopy={(seg) => void copySegment(seg)}
                    onRetry={retry}
                    retrying={retryingId === s.id}
                    onSpeak={(seg) => void speakSegment(seg)}
                    speaking={speakingId === s.id}
                  />
                ))}
                {segments.hasNextPage && (
                  <button
                    type="button"
                    className="vt-btn vt-btn--ghost"
                    disabled={segments.isFetching}
                    onClick={() =>
                      void segments.fetchNextPage({ cancelRefetch: false })
                    }
                  >
                    {segments.isFetchingNextPage
                      ? 'Loading…'
                      : segments.isFetchNextPageError
                        ? 'Try loading older translations again'
                        : 'Load older translations'}
                  </button>
                )}
              </>
            )}
          </div>

          {char && (
            <Composer
              contextId={composerContext}
              ref={composerRef}
              placeholder={`Translate to ${langName(char.targetLanguage)} as ${char.name} · ${activeVibe?.label}…`}
              sourceLanguage={char.sourceLanguage}
              vibes={vibes}
              vibeIdx={vibeIdx}
              onVibeChange={setVibeIdx}
              temperature={temp}
              onTemperatureChange={setTemp}
              onTemperatureCommit={commitTemperature}
              onSend={send}
              sending={pendingHere || threads.isPending}
            />
          )}
        </main>
      </div>

      {panel && (
        <CharacterPanel
          key={panel.mode === 'edit' ? panel.character.id : 'create'}
          character={panel.mode === 'edit' ? panel.character : null}
          onClose={() => setPanel(null)}
          onSave={saveCharacter}
          onDelete={panel.mode === 'edit' ? removeCharacter : undefined}
          saving={
            createCharacter.isPending ||
            updateCharacter.isPending ||
            deleteCharacter.isPending
          }
        />
      )}

      <CommandPalette
        open={frame.paletteOpen}
        onClose={() => frame.setPaletteOpen(false)}
        onPick={onPalettePick}
        items={paletteItems}
      />
    </div>
  )
}
