import { onlineManager, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'

import { shareQuery } from '@/hooks/use-app-data'
import { apiFetch } from '@/lib/api'
import { copyText, copyTextWhenReady } from '@/lib/clipboard'
import {
  downloadTextFile,
  slugify,
  threadToMarkdown,
} from '@/lib/markdown-export'
import { keys } from '@/lib/query-keys'
import type { Character, Segment, Thread, ThreadShare } from '@/lib/types'

export type ThreadExportSource = {
  thread: Pick<Thread, 'id' | 'title'>
  character: Character
  // Loaded history, oldest first.
  segments: Segment[]
  // No older page remains, so `segments` is the whole Thread.
  complete: boolean
}

const PREPARE_FAILED =
  'Could not load the full thread — check your connection and try again.'

const copied = () => toast.success('Thread copied as Markdown.')
const copyFailed = () => toast.error('Copy failed.')

// The deferred write was unsupported or refused (activation expired): the
// Markdown is ready, so a second click can copy it synchronously.
const offerCopy = (markdown: string) =>
  toast('Markdown ready to copy.', {
    duration: 15_000,
    action: {
      label: 'Copy',
      onClick: () => void copyText(markdown).then(copied, copyFailed),
    },
  })

// Markdown download/copy for the active Thread. Exports are always complete: a
// fully loaded history (also offline) is used as is, otherwise the full history
// is fetched. One preparation runs per Thread and both actions share it.
export function useThreadExport(source: ThreadExportSource | null) {
  const qc = useQueryClient()
  const jobs = React.useRef(new Map<string, Promise<string>>())
  // Actions waiting on a job, so repeated clicks can't save or copy twice.
  const waiting = React.useRef(new Set<string>())
  const [preparing, setPreparing] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // The public link only decorates the footer: resolve it when unknown (into
  // the Share popover's cache), but offline or on error export without it.
  const shareUrl = async (threadId: string) => {
    if (!onlineManager.isOnline()) return null
    try {
      const share = await qc.fetchQuery({
        ...shareQuery(threadId),
        retry: false,
        networkMode: 'always',
      })
      return share.url
    } catch {
      return null
    }
  }

  // A string when everything is already cached, so callers can act inside the
  // click without an await.
  const prepare = (src: ThreadExportSource): string | Promise<string> => {
    const { thread, character } = src
    const render = (segments: Segment[], url: string | null) =>
      threadToMarkdown({
        title: thread.title,
        character,
        segments,
        shareUrl: url,
      })
    const share = qc.getQueryData<ThreadShare>(keys.share(thread.id))
    if (src.complete && share) return render(src.segments, share.url)
    const running = jobs.current.get(thread.id)
    if (running) return running
    const params = new URLSearchParams({ threadId: thread.id })
    const job = Promise.all([
      src.complete
        ? src.segments
        : apiFetch<Segment[]>(`/api/segments?${params}`),
      share ? share.url : shareUrl(thread.id),
    ]).then(([segments, url]) => render(segments, url))
    jobs.current.set(thread.id, job)
    setPreparing((prev) => new Set(prev).add(thread.id))
    const settle = () => {
      jobs.current.delete(thread.id)
      setPreparing((prev) => {
        const next = new Set(prev)
        next.delete(thread.id)
        return next
      })
    }
    job.then(settle, settle)
    return job
  }

  const download = () => {
    if (!source) return
    const key = `download:${source.thread.id}`
    if (waiting.current.has(key)) return
    const filename = `${slugify(source.thread.title)}.md`
    const save = (markdown: string) => {
      try {
        downloadTextFile(filename, markdown)
        toast.success('Markdown download started.')
      } catch {
        // The text is ready; only the browser save failed.
        toast.error('Download failed — try “Copy as Markdown” instead.')
      }
    }
    const markdown = prepare(source)
    if (typeof markdown === 'string') return save(markdown)
    waiting.current.add(key)
    void markdown
      .then(save, () => toast.error(PREPARE_FAILED))
      .finally(() => waiting.current.delete(key))
  }

  const copy = () => {
    if (!source) return
    const key = `copy:${source.thread.id}`
    if (waiting.current.has(key)) return
    const markdown = prepare(source)
    if (typeof markdown === 'string') {
      // Still inside the click: write directly.
      void copyText(markdown).then(copied, copyFailed)
      return
    }
    waiting.current.add(key)
    // Start the write now, inside the click's activation; it completes once
    // the Markdown resolves.
    const written = copyTextWhenReady(markdown).then(
      () => true,
      () => false,
    )
    void markdown
      .then(
        async (text) => ((await written) ? copied() : offerCopy(text)),
        () => toast.error(PREPARE_FAILED),
      )
      .finally(() => waiting.current.delete(key))
  }

  return {
    preparing: !!source && preparing.has(source.thread.id),
    download,
    copy,
  }
}
