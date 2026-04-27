import { UserButton } from '@clerk/react'
import { MessageSquareText, Search } from 'lucide-react'

export function AppHeader() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-panel px-5">
      <div className="flex items-center gap-3">
        <MessageSquareText className="size-5 text-accent" />
        <span className="font-semibold">VibeTranslate</span>
      </div>
      <div className="flex items-center gap-2">
        <button className="icon-button" type="button" aria-label="Quick find">
          <Search className="size-4" />
        </button>
        <UserButton />
      </div>
    </header>
  )
}
