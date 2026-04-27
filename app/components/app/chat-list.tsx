import type { Chat } from '@/lib/types'

type ChatListProps = {
  chats: Chat[]
  isLoading: boolean
}

export function ChatList({ chats, isLoading }: ChatListProps) {
  if (isLoading) {
    return <p className="mt-6 text-sm text-muted">Loading chats...</p>
  }

  if (chats.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-border bg-panel p-8">
        <h2 className="font-semibold">No chats yet</h2>
        <p className="mt-2 text-sm text-muted">Create chat API wiring is scaffolded and ready.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-3">
      {chats.map((chat) => (
        <article key={chat.id} className="rounded-lg border border-border bg-panel p-4">
          <h2 className="font-semibold">{chat.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {chat.sourceLanguage} to {chat.targetLanguage}
          </p>
        </article>
      ))}
    </div>
  )
}
