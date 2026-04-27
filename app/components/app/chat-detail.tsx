import type { Chat } from '@/lib/types'

type ChatDetailProps = {
  chat?: Chat
}

export function ChatDetail({ chat }: ChatDetailProps) {
  return (
    <aside className="rounded-lg border border-border bg-panel p-5">
      <h2 className="font-semibold">{chat?.title ?? 'Context'}</h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Select a chat to review translation settings, history, and AI context.
      </p>
    </aside>
  )
}
