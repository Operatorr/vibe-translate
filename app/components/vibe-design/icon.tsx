import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

// Name → lucide glyph. Rendered inside `.vt-icon` so the design-system sizing
// rules in app.css apply uniformly.
const ICONS: Record<string, LucideIcon> = {
  archive: Icons.Archive,
  'arrow-left': Icons.ArrowLeft,
  'arrow-left-right': Icons.ArrowLeftRight,
  'arrow-right': Icons.ArrowRight,
  'arrow-up-right': Icons.ArrowUpRight,
  book: Icons.Book,
  'book-open': Icons.BookOpen,
  braces: Icons.Braces,
  check: Icons.Check,
  'chevron-down': Icons.ChevronDown,
  'chevron-left': Icons.ChevronLeft,
  'chevron-right': Icons.ChevronRight,
  copy: Icons.Copy,
  download: Icons.Download,
  'external-link': Icons.ExternalLink,
  'file-text': Icons.FileText,
  languages: Icons.Languages,
  link: Icons.Link,
  'link-off': Icons.Unlink,
  loader: Icons.Loader,
  'log-out': Icons.LogOut,
  menu: Icons.Menu,
  mic: Icons.Mic,
  'mic-off': Icons.MicOff,
  minus: Icons.Minus,
  moon: Icons.Moon,
  'more-horizontal': Icons.MoreHorizontal,
  paperclip: Icons.Paperclip,
  pencil: Icons.Pencil,
  plus: Icons.Plus,
  'rotate-ccw': Icons.RotateCcw,
  search: Icons.Search,
  'settings-2': Icons.Settings2,
  'share-2': Icons.Share2,
  'sliders-horizontal': Icons.SlidersHorizontal,
  smartphone: Icons.Smartphone,
  square: Icons.Square,
  star: Icons.Star,
  sun: Icons.Sun,
  'sun-moon': Icons.SunMoon,
  terminal: Icons.Terminal,
  thermometer: Icons.Thermometer,
  trash: Icons.Trash2,
  'user-plus': Icons.UserPlus,
  'user-square': Icons.UserSquare,
  users: Icons.Users,
  'volume-2': Icons.Volume2,
  'volume-x': Icons.VolumeX,
  x: Icons.X,
}

type IconProps = {
  name: string
  className?: string
  style?: CSSProperties
  // `fill` renders a solid glyph (used for the starred state).
  fill?: boolean
}

export function Icon({ name, className, style, fill }: IconProps) {
  const Glyph = ICONS[name] ?? Icons.Circle
  return (
    <i
      className={['vt-icon', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <Glyph strokeWidth={1.5} fill={fill ? 'currentColor' : 'none'} />
    </i>
  )
}
