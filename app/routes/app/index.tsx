import { createFileRoute } from '@tanstack/react-router'

import { ChatDetail } from '@/components/app/chat-detail'
import { ChatList } from '@/components/app/chat-list'
import { useApiQuery } from '@/hooks/use-api-query'
import type { Chat } from '@/lib/types'

export const Route = createFileRoute('/app/')({
  component: AppHome,
})

function AppHome() {
  const chats = useApiQuery<Chat[]>(['chats'], '/api/chats')

  return (
    <main className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <h1 className="text-2xl font-semibold">Chats</h1>
        <p className="mt-2 text-sm text-muted">Translation workspaces and recent activity.</p>
        <ChatList chats={chats.data ?? []} isLoading={chats.isLoading} />
      </section>
      <ChatDetail />
    </main>
  )
}
