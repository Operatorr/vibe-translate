import { UserButton, useClerk } from '@clerk/react'
import { Link } from '@tanstack/react-router'
import * as React from 'react'
import { toast } from 'sonner'

import { LANG_FLAG, LANG_NAME, getVibesForLang } from '@/components/vibe-design/design-data'
import { Icon } from '@/components/vibe-design/icon'
import { DEFAULT_PALETTE_ITEMS, type PaletteItem } from '@/components/vibe-design/palette-items'
import { CommandPalette, SiteNav } from '@/components/vibe-design/shell'
import { useVibeFrame } from '@/components/vibe-design/use-vibe-frame'
import {
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
import { ApiError } from '@/lib/api'
import { cssVars } from '@/lib/css-vars'
import { downloadTextFile, slugify, threadToMarkdown } from '@/lib/markdown-export'
import { timeAgo } from '@/lib/time'
import { speak, stopSpeaking } from '@/lib/tts'
import type { Character, SegmentToken, Thread, VibeStop } from '@/lib/types'
import { copyText } from '@/lib/clipboard'

import { CharacterPanel } from './character-panel'
import { Composer, type ComposerHandle } from './composer'
import { PendingSegmentCard, SegmentCard, type SegmentView } from './segment-card'
import { SharePopover, ThreadOptionsMenu } from './thread-menus'

const FLAGS = LANG_FLAG as Record<string, string>
const LANGUAGE_NAMES = LANG_NAME as Record<string, string>
const NEW_THREAD_TITLE = 'New thread'
const ACTIVE_CHAR_KEY = 'vibe-translate:active-character'

type Pane = 'chars' | 'threads' | 'workspace'
type Panel = { mode: 'create' } | { mode: 'edit'; character: Character } | null

const langName = (code: string) => LANGUAGE_NAMES[code] ?? code

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 402) return 'Out of credits — upgrade or add an OpenRouter key to keep translating.'
    return error.message
  }
  return error instanceof Error ? error.message : fallback
}

function readStoredCharacter(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CHAR_KEY)
  } catch {
    return null
  }
}

export function AppExperience() {
  const frame = useVibeFrame('/app')
  const { signOut } = useClerk()

  // ---- data ---------------------------------------------------------------
  const me = useMe()
  const characters = useCharacters()
  const [activeCharId, setActiveCharIdState] = React.useState<string | null>(readStoredCharacter)
  const setActiveCharId = React.useCallback((id: string | null) => {
    setActiveCharIdState(id)
    try {
      if (id) localStorage.setItem(ACTIVE_CHAR_KEY, id)
    } catch {
      // ignore
    }
  }, [])
  const charList = React.useMemo(() => characters.data ?? [], [characters.data])
  const char = charList.find((c) => c.id === activeCharId) ?? null

  React.useEffect(() => {
    if (!characters.data) return
    if (!char && characters.data.length > 0) setActiveCharId(characters.data[0].id)
  }, [characters.data, char, setActiveCharId])

  const threads = useThreads(char?.id ?? null)
  const threadList = React.useMemo(() => threads.data ?? [], [threads.data])
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null)
  const thread = threadList.find((t) => t.id === activeThreadId) ?? null

  React.useEffect(() => {
    if (!threads.data) return
    if (!thread) setActiveThreadId(threads.data[0]?.id ?? null)
  }, [threads.data, thread])

  const segments = useSegments(thread?.id ?? null)
  const segList = React.useMemo(() => segments.data ?? [], [segments.data])
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
  const share = useThreadShare(thread?.id ?? null)
  const setShare = useSetThreadShare()
  const fetchTts = useTtsFetch()

  // ---- ui state -----------------------------------------------------------
  const [pane, setPane] = React.useState<Pane>(() =>
    window.matchMedia('(max-width: 900px)').matches && !readStoredCharacter() ? 'chars' : 'workspace',
  )
  const [panel, setPanel] = React.useState<Panel>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [explainOpenId, setExplainOpenId] = React.useState<string | null>(null)
  const [hoveredTok, setHoveredTok] = React.useState<{ segId: string; token: SegmentToken } | null>(null)
  const [speakingId, setSpeakingId] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const [renameDraft, setRenameDraft] = React.useState('')
  const composerRef = React.useRef<ComposerHandle>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const vibes = React.useMemo(() => getVibesForLang(char?.targetLanguage ?? 'ja-JP'), [char?.targetLanguage])
  const [vibeIdx, setVibeIdx] = React.useState(0)
  const [temp, setTemp] = React.useState(0.4)
  React.useEffect(() => {
    if (!char) return
    setVibeIdx(Math.max(0, vibes.findIndex((v) => v.id === char.defaultVibe)))
    setTemp(char.temperature)
  }, [char?.id, char?.defaultVibe, char?.temperature, vibes]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setPane('threads')
  }
  const selectThread = (id: string) => {
    setActiveThreadId(id)
    setPane('workspace')
  }

  const newThread = React.useCallback(async () => {
    if (!char) {
      setPanel({ mode: 'create' })
      return null
    }
    try {
      const created = await createThread.mutateAsync({ characterId: char.id, title: NEW_THREAD_TITLE })
      setActiveThreadId(created.id)
      setPane('workspace')
      requestAnimationFrame(() => composerRef.current?.focus())
      return created
    } catch (error) {
      toast.error(errorMessage(error, 'Could not create the thread.'))
      return null
    }
  }, [char, createThread])

  const send = async (text: string) => {
    if (!char) return
    let target: Thread | null = thread
    if (!target) target = await newThread()
    if (!target) return
    const vibe = vibes[vibeIdx]?.id as VibeStop
    try {
      const created = await createSegment.mutateAsync({ threadId: target.id, sourceText: text, vibe })
      setExpanded(new Set())
      setExplainOpenId(null)
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      if (target.title === NEW_THREAD_TITLE && target.segmentCount === 0) {
        const title = text.replace(/\s+/g, ' ').slice(0, 60).trim() || NEW_THREAD_TITLE
        updateThread.mutate({ id: target.id, characterId: char.id, title })
      }
      if (!created.tokenAlignment.length) toast.message('Translated (alignment unavailable).')
    } catch (error) {
      toast.error(errorMessage(error, 'Translation failed.'))
    }
  }

  const commitTemperature = (value: number) => {
    if (!char || Math.abs(value - char.temperature) < 0.001) return
    updateCharacter.mutate(
      { id: char.id, temperature: Math.round(value * 100) / 100 },
      { onError: (error) => toast.error(errorMessage(error, 'Could not save the temperature.')) },
    )
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
    const useElevenLabs =
      me.data?.limits.elevenLabsTts === true && char.targetLanguage.toLowerCase().startsWith('ja')
    setSpeakingId(seg.id)
    try {
      await speak({
        text: seg.targetText,
        languageCode: char.targetLanguage,
        vibe: seg.vibe ?? char.defaultVibe,
        fetchAudio: useElevenLabs ? fetchTts : undefined,
        onEnd: () => setSpeakingId((id) => (id === seg.id ? null : id)),
      })
    } catch (error) {
      setSpeakingId(null)
      toast.error(errorMessage(error, 'Playback failed.'))
    }
  }

  const markdownFor = () =>
    thread && char
      ? threadToMarkdown({
          title: thread.title,
          character: char,
          segments: segList,
          shareUrl: share.data?.url ?? null,
        })
      : null

  const download = () => {
    const md = markdownFor()
    if (!md || !thread) return
    downloadTextFile(`${slugify(thread.title)}.md`, md)
    toast.success('Downloaded Markdown.')
  }

  const copyMarkdown = async () => {
    const md = markdownFor()
    if (!md) return
    try {
      await copyText(md)
      toast.success('Thread copied as Markdown.')
    } catch {
      toast.error('Copy failed.')
    }
  }

  const toggleStar = () => {
    if (!thread || !char) return
    updateThread.mutate(
      { id: thread.id, characterId: char.id, starred: !thread.starred },
      { onError: (error) => toast.error(errorMessage(error, 'Could not update the star.')) },
    )
  }

  const toggleShare = (shared: boolean) => {
    if (!thread) return
    setShare.mutate(
      { threadId: thread.id, shared },
      {
        onSuccess: (res) => {
          if (res.shared && res.url) {
            void copyText(res.url).then(
              () => toast.success('Public link created and copied.'),
              () => toast.success('Public link created.'),
            )
          } else toast.message('Public link disabled.')
        },
        onError: (error) => toast.error(errorMessage(error, 'Could not update sharing.')),
      },
    )
  }

  const startRename = () => {
    if (!thread) return
    setRenameDraft(thread.title)
    setRenaming(true)
  }
  const finishRename = (save: boolean) => {
    setRenaming(false)
    const title = renameDraft.trim()
    if (!save || !thread || !char || !title || title === thread.title) return
    updateThread.mutate(
      { id: thread.id, characterId: char.id, title },
      { onError: (error) => toast.error(errorMessage(error, 'Rename failed.')) },
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
    if (!window.confirm(`Delete "${thread.title}" and its ${thread.segmentCount} translations?`)) return
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
        await updateCharacter.mutateAsync({ id: panel.character.id, ...input })
        toast.success('Character saved.')
      } else {
        const created = await createCharacter.mutateAsync(input)
        setActiveCharId(created.id)
        setActiveThreadId(null)
        setPane('threads')
        toast.success(`${created.name} is ready.`)
        if (me.data && !me.data.onboardingComplete) updateMe.mutate({ onboardingComplete: true })
      }
      setPanel(null)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the character.'))
    }
  }

  const removeCharacter = () => {
    if (panel?.mode !== 'edit') return
    const target = panel.character
    if (!window.confirm(`Delete ${target.name} and every thread under them? This cannot be undone.`)) return
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
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void newThread()
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        frame.onToggleTheme()
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newThread, frame])

  // ---- palette ------------------------------------------------------------
  const paletteItems = React.useMemo<PaletteItem[]>(
    () => [
      ...DEFAULT_PALETTE_ITEMS,
      { id: 'new-character', label: 'New character', icon: 'user-plus', hint: null },
      ...charList.map((c) => ({ id: `char:${c.id}`, label: `Open ${c.name}`, icon: 'user-square', group: 'character' })),
      ...threadList.map((t) => ({ id: `thread:${t.id}`, label: t.title, icon: 'file-text', group: 'thread' })),
    ],
    [charList, threadList],
  )
  const onPalettePick = (id: string) => {
    if (id === 'theme') frame.onToggleTheme()
    else if (id === 'new') void newThread()
    else if (id === 'focus') requestAnimationFrame(() => composerRef.current?.focus())
    else if (id === 'new-character') setPanel({ mode: 'create' })
    else if (id === 'logout') void signOut({ redirectUrl: '/' })
    else if (id.startsWith('char:')) selectCharacter(id.slice(5))
    else if (id.startsWith('thread:')) selectThread(id.slice(7))
  }

  // ---- derived ------------------------------------------------------------
  const activeVibe = vibes[vibeIdx] ?? vibes[0]
  const starred = threadList.filter((t) => t.starred)
  const recent = threadList.filter((t) => !t.starred)
  const pendingHere = createSegment.isPending && createSegment.variables?.threadId === thread?.id
  const retryingId = retrySegment.isPending ? retrySegment.variables?.id : null
  const credits = me.data?.credits.balance
  const tier = me.data?.tier ?? 'free'
  const loadingChars = characters.isLoading && !characters.data

  const threadRow = (t: Thread) => (
    <button
      key={t.id}
      className={'thread ' + (t.id === thread?.id ? 'thread--active' : '')}
      onClick={() => selectThread(t.id)}
    >
      <p className="thread__title">
        {t.starred && <Icon name="star" fill className="thread__star" />}
        {t.title}
      </p>
      <div className="thread__meta">
        <span className="count">
          {t.segmentCount} translation{t.segmentCount === 1 ? '' : 's'}
        </span>
        <span style={{ margin: '0 6px', color: 'var(--fg-disabled)' }}>·</span>
        <span>{timeAgo(t.updatedAt)}</span>
      </div>
    </button>
  )

  return (
    <div className="app-shell">
      <SiteNav
        theme={frame.theme}
        onToggleTheme={frame.onToggleTheme}
        route="/app"
        onNavigate={frame.onNavigate}
        onOpenPalette={() => frame.setPaletteOpen(true)}
        account={<UserButton />}
      />
      <div className="app-body" data-pane={pane}>
        {/* CHARACTERS sidebar */}
        <aside className="chars">
          <div className="chars__head">
            <span className="chars__head-title">CHARACTERS · {charList.length}</span>
            <button className="chars__new" aria-label="New character" title="New character" onClick={() => setPanel({ mode: 'create' })}>
              <Icon name="plus" />
            </button>
          </div>
          <div className="chars__list">
            {loadingChars && <div className="chars__empty">Loading…</div>}
            {!loadingChars && charList.length === 0 && (
              <div className="chars__empty">
                <p>No characters yet.</p>
                <button className="vt-btn vt-btn--primary vt-btn--block" onClick={() => setPanel({ mode: 'create' })}>
                  <Icon name="user-plus" /> Create your first
                </button>
              </div>
            )}
            {charList.map((c) => (
              <button
                key={c.id}
                className={'char ' + (c.id === char?.id ? 'char--active' : '')}
                style={cssVars({ '--char-color': c.color ?? 'var(--blue-400)' })}
                onClick={() => selectCharacter(c.id)}
              >
                <div className="char__avatar" style={{ background: c.color ?? 'var(--blue-400)' }}>
                  {c.initials ?? c.name[0]}
                </div>
                <div className="char__body">
                  <div className="char__name">{c.name}</div>
                  <div className="char__meta">
                    {FLAGS[c.sourceLanguage] ?? c.sourceLanguage}
                    <span className="arrow">→</span>
                    {FLAGS[c.targetLanguage] ?? c.targetLanguage} ·{' '}
                    {getVibesForLang(c.targetLanguage).find((v) => v.id === c.defaultVibe)?.label}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="chars__foot">
            <Link className="vt-side-foot chars__status" style={{ padding: 0, border: 0 }} to={'/pricing' as never}>
              <div
                className="vt-status-dot"
                style={{ background: tier === 'free' ? 'var(--amber-400)' : 'var(--turq-400)' }}
              ></div>
              <div className="vt-status-text">
                {tier === 'free' ? 'Free' : tier === 'pro' ? 'Pro' : 'Team'}
                {credits !== undefined && ` · ${credits.toLocaleString()} credits`}
              </div>
              <Icon name="external-link" className="vt-status-ext" />
            </Link>
          </div>
        </aside>

        {/* THREADS sidebar */}
        <aside className="threads">
          {char ? (
            <>
              <div className="threads__head" style={cssVars({ '--char-color': char.color ?? 'var(--blue-400)' })}>
                <div className="threads__char-row">
                  <button className="mobile-only mobile-back" onClick={() => setPane('chars')} aria-label="Back to characters">
                    <Icon name="chevron-left" />
                  </button>
                  <div className="threads__char-avatar" style={{ background: char.color ?? 'var(--blue-400)' }}>
                    {char.initials ?? char.name[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="threads__char-name">{char.name}</div>
                    <div className="threads__char-meta">
                      {langName(char.sourceLanguage)} → {langName(char.targetLanguage)}
                    </div>
                  </div>
                </div>
                <button className="threads__customize" onClick={() => setPanel({ mode: 'edit', character: char })}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="settings-2" />
                    Customize character
                  </span>
                  <Icon name="chevron-right" />
                </button>
                <button className="threads__newbtn" onClick={() => void newThread()} disabled={createThread.isPending}>
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
                <div className="threads__group-h">RECENT</div>
                {threads.isLoading && !threads.data && <div className="chars__empty">Loading…</div>}
                {threads.data && threadList.length === 0 && (
                  <div className="chars__empty">No threads yet — start one above.</div>
                )}
                {recent.map(threadRow)}
              </div>
            </>
          ) : (
            <div className="chars__empty" style={{ padding: 24 }}>
              <button className="mobile-only mobile-back" onClick={() => setPane('chars')} aria-label="Back to characters">
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
              <button className="mobile-only mobile-back" onClick={() => setPane('threads')} aria-label="Back to threads">
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
                  <h2 className="workspace__title" onDoubleClick={startRename} title="Double-click to rename">
                    {thread?.title ?? (char ? 'New translation' : 'Welcome')}
                  </h2>
                )}
                {char && (
                  <div className="workspace__pair">
                    {FLAGS[char.sourceLanguage]} {langName(char.sourceLanguage)}
                    <span className="arrow">→</span>
                    {FLAGS[char.targetLanguage]} {langName(char.targetLanguage)}
                    <span className="arrow">·</span>
                    <span style={{ color: activeVibe?.color }}>{activeVibe?.label}</span>
                    <span className="arrow">·</span>
                    T={temp.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            {thread && char && (
              <div className="workspace__head-right">
                <button
                  className={'workspace__icon-btn ' + (thread.starred ? 'is-active is-star' : '')}
                  title={thread.starred ? 'Unstar' : 'Star'}
                  aria-pressed={thread.starred}
                  onClick={toggleStar}
                >
                  <Icon name="star" fill={thread.starred} />
                </button>
                <SharePopover share={share.data} loading={share.isLoading || setShare.isPending} onToggle={toggleShare} />
                <button className="workspace__icon-btn" title="Download as Markdown" onClick={download} disabled={segList.length === 0}>
                  <Icon name="download" />
                </button>
                <ThreadOptionsMenu
                  onRename={startRename}
                  onArchive={archiveThread}
                  onDelete={removeThread}
                  onCopyMarkdown={() => void copyMarkdown()}
                  onClearExplain={explainOpenId ? () => setExplainOpenId(null) : undefined}
                />
              </div>
            )}
          </div>

          <div className="workspace__scroll" ref={scrollRef}>
            {!char ? (
              <div className="welcome">
                <Icon name="languages" style={{ width: 32, height: 32, color: 'var(--fg-subtle)' }} />
                <h3 className="welcome__title">Who are you translating for?</h3>
                <p className="welcome__sub">
                  A character carries the intent — language pair, vibe, dialect, personality — so you
                  never have to say "translate this to Japanese, casually."
                </p>
                <button className="vt-btn vt-btn--primary" onClick={() => setPanel({ mode: 'create' })}>
                  <Icon name="user-plus" /> Create a character
                </button>
              </div>
            ) : segments.isLoading && !segments.data && thread ? (
              <div className="welcome">
                <Icon name="loader" className="vt-spin" style={{ width: 24, height: 24, color: 'var(--fg-subtle)' }} />
              </div>
            ) : ordered.length === 0 && !pendingHere ? (
              <div className="welcome">
                <Icon name="languages" style={{ width: 32, height: 32, color: 'var(--fg-subtle)' }} />
                <h3 className="welcome__title">No translations yet</h3>
                <p className="welcome__sub">
                  Type below to translate something. {char.name}'s settings carry the intent — you don't
                  have to say "translate to {langName(char.targetLanguage)}."
                </p>
              </div>
            ) : (
              <>
                {pendingHere && createSegment.variables && (
                  <PendingSegmentCard
                    idx={segList.length + 1}
                    sourceText={createSegment.variables.sourceText}
                    sourceLanguage={char.sourceLanguage}
                    targetLanguage={char.targetLanguage}
                    vibe={vibes.find((v) => v.id === createSegment.variables?.vibe)}
                  />
                )}
                {ordered.map((s, i) => (
                  <SegmentCard
                    key={s.id}
                    seg={s}
                    idx={ordered.length - i}
                    isActive={i === 0 && !pendingHere}
                    collapsed={!(i === 0 && !pendingHere) && !expanded.has(s.id)}
                    sourceLanguage={char.sourceLanguage}
                    targetLanguage={char.targetLanguage}
                    vibes={vibes}
                    defaultVibe={char.defaultVibe}
                    onExpand={(id) => setExpanded((prev) => new Set(prev).add(id))}
                    explain={{
                      open: explainOpenId === s.id,
                      body: explainOpenId === s.id ? explain.data?.body : undefined,
                      isLoading: explainOpenId === s.id && explain.isLoading,
                      error: explainOpenId === s.id ? explain.error : null,
                      onToggle: () => setExplainOpenId((curr) => (curr === s.id ? null : s.id)),
                      onRetry: () => void explain.refetch(),
                    }}
                    hoveredTok={hoveredTok}
                    onHoverTok={setHoveredTok}
                    onCopy={(seg) => void copySegment(seg)}
                    onRetry={retry}
                    retrying={retryingId === s.id}
                    onSpeak={(seg) => void speakSegment(seg)}
                    speaking={speakingId === s.id}
                  />
                ))}
              </>
            )}
          </div>

          {char && (
            <Composer
              ref={composerRef}
              placeholder={`Translate to ${langName(char.targetLanguage)} as ${char.name} · ${activeVibe?.label}…`}
              sourceLanguage={char.sourceLanguage}
              vibes={vibes}
              vibeIdx={vibeIdx}
              onVibeChange={setVibeIdx}
              temperature={temp}
              onTemperatureChange={setTemp}
              onTemperatureCommit={commitTemperature}
              onSend={(text) => void send(text)}
              sending={createSegment.isPending}
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
          saving={createCharacter.isPending || updateCharacter.isPending || deleteCharacter.isPending}
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
