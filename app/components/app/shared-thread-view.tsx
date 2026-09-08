import * as React from 'react'
import { toast } from 'sonner'

import { LANG_FLAG, LANG_NAME, getVibesForLang } from '@/components/vibe-design/design-data'
import { Icon } from '@/components/vibe-design/icon'
import { cssVars } from '@/lib/css-vars'
import { downloadTextFile, slugify, threadToMarkdown } from '@/lib/markdown-export'
import { speak, stopSpeaking } from '@/lib/tts'
import type { SegmentToken, SharedThread } from '@/lib/types'
import { copyText } from '@/lib/clipboard'

import { SegmentCard, type SegmentView } from './segment-card'

const FLAGS = LANG_FLAG as Record<string, string>
const LANGUAGE_NAMES = LANG_NAME as Record<string, string>

// Read-only rendering of a shared thread: every segment expanded, copy and
// browser-TTS speak only (no retry/explain — those need an account).
export function SharedThreadView({ data }: { data: SharedThread }) {
  const { thread, character, segments } = data
  const vibes = getVibesForLang(character.targetLanguage)
  const [hoveredTok, setHoveredTok] = React.useState<{ segId: string; token: SegmentToken } | null>(null)
  const [speakingId, setSpeakingId] = React.useState<string | null>(null)
  const ordered = [...segments].reverse()

  const copy = async (seg: SegmentView) => {
    try {
      await copyText(seg.targetText)
      toast.success('Copied translation.')
    } catch {
      toast.error('Copy failed.')
    }
  }
  const speakSeg = async (seg: SegmentView) => {
    if (speakingId === seg.id) {
      stopSpeaking()
      setSpeakingId(null)
      return
    }
    setSpeakingId(seg.id)
    try {
      await speak({
        text: seg.targetText,
        languageCode: character.targetLanguage,
        vibe: seg.vibe ?? character.defaultVibe,
        onEnd: () => setSpeakingId((id) => (id === seg.id ? null : id)),
      })
    } catch (error) {
      setSpeakingId(null)
      toast.error(error instanceof Error ? error.message : 'Playback failed.')
    }
  }
  const download = () => {
    downloadTextFile(
      `${slugify(thread.title)}.md`,
      threadToMarkdown({ title: thread.title, character, segments, shareUrl: window.location.href }),
    )
  }

  return (
    <main className="workspace share-workspace">
      <div className="workspace__head">
        <div className="workspace__head-left">
          <div className="threads__char-avatar" style={cssVars({ background: character.color ?? 'var(--blue-400)' })}>
            {character.initials ?? character.name[0]}
          </div>
          <div className="workspace__title-block">
            <h2 className="workspace__title">{thread.title}</h2>
            <div className="workspace__pair">
              {character.name}
              <span className="arrow">·</span>
              {FLAGS[character.sourceLanguage]} {LANGUAGE_NAMES[character.sourceLanguage] ?? character.sourceLanguage}
              <span className="arrow">→</span>
              {FLAGS[character.targetLanguage]} {LANGUAGE_NAMES[character.targetLanguage] ?? character.targetLanguage}
              <span className="arrow">·</span>
              {segments.length} translation{segments.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="workspace__head-right">
          <button className="workspace__icon-btn" title="Download as Markdown" onClick={download}>
            <Icon name="download" />
          </button>
        </div>
      </div>
      <div className="workspace__scroll" style={{ paddingBottom: 80 }}>
        {ordered.length === 0 && (
          <div className="welcome">
            <p className="welcome__sub">This thread has no translations yet.</p>
          </div>
        )}
        {ordered.map((s, i) => (
          <SegmentCard
            key={s.id}
            seg={s}
            idx={ordered.length - i}
            isActive={i === 0}
            collapsed={false}
            sourceLanguage={character.sourceLanguage}
            targetLanguage={character.targetLanguage}
            vibes={vibes}
            defaultVibe={character.defaultVibe}
            onExpand={() => undefined}
            hoveredTok={hoveredTok}
            onHoverTok={setHoveredTok}
            onCopy={(seg) => void copy(seg)}
            onSpeak={(seg) => void speakSeg(seg)}
            speaking={speakingId === s.id}
            readOnly
          />
        ))}
      </div>
    </main>
  )
}
