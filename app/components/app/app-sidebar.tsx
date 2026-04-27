import { Link } from '@tanstack/react-router'
import { CalendarDays, Languages, Settings } from 'lucide-react'

const items = [
  { label: 'Chats', icon: Languages, to: '/app' as never },
  { label: 'Calendar', icon: CalendarDays, to: '/app' as never },
  { label: 'Settings', icon: Settings, to: '/app' as never },
] as const

export function AppSidebar() {
  return (
    <aside className="border-r border-border bg-panel p-4">
      <div className="mb-6 px-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted">
        Workspace
      </div>
      <nav className="space-y-1">
        {items.map((item) => (
          <Link key={item.label} className="sidebar-link" to={item.to}>
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
