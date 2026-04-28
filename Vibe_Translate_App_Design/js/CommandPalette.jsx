// CommandPalette.jsx — Cmd-K palette (the one blurred surface)
const PALETTE_ITEMS = [
  { id: 'new',     label: 'New translation',          icon: 'languages',  hint: '⌘ N' },
  { id: 'mem',     label: 'Open translation memory',   icon: 'book-open',  hint: 'G M' },
  { id: 'gloss',   label: 'Open glossary',             icon: 'braces',     hint: 'G G' },
  { id: 'api',     label: 'Open API console',          icon: 'terminal',   hint: 'G A' },
  { id: 'theme',   label: 'Toggle theme',              icon: 'sun-moon',   hint: '⌘ ⇧ L' },
  { id: 'docs',    label: 'Read the docs',             icon: 'book',       hint: '?' },
  { id: 'invite',  label: 'Invite teammate',           icon: 'user-plus',  hint: null },
  { id: 'logout',  label: 'Sign out',                  icon: 'log-out',    hint: null },
];

const CommandPalette = ({ open, onClose, onPick }) => {
  const [q, setQ] = React.useState('');
  const filtered = PALETTE_ITEMS.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
  React.useEffect(() => { if (open) { setQ(''); setTimeout(() => window.lucide?.createIcons({attrs:{"stroke-width":1.5}}), 0); } }, [open]);
  if (!open) return null;
  return (
    <div className="vt-palette-scrim" onClick={onClose}>
      <div className="vt-palette" onClick={(e) => e.stopPropagation()}>
        <div className="vt-palette__head">
          <i data-lucide="search"></i>
          <input autoFocus placeholder="Search or run a command…" value={q} onChange={(e) => setQ(e.target.value)} />
          <kbd>esc</kbd>
        </div>
        <div className="vt-palette__list">
          {filtered.length === 0 && <div className="vt-palette__empty">No results.</div>}
          {filtered.map(i => (
            <button key={i.id} className="vt-palette__item" onClick={() => { onPick && onPick(i.id); onClose(); }}>
              <i data-lucide={i.icon}></i>
              <span className="vt-palette__label">{i.label}</span>
              {i.hint && <kbd className="vt-palette__hint">{i.hint}</kbd>}
            </button>
          ))}
        </div>
        <div className="vt-palette__foot">
          <span className="vt-eyebrow">COMMANDS</span>
          <span className="vt-palette__count">{filtered.length} of {PALETTE_ITEMS.length}</span>
        </div>
      </div>
    </div>
  );
};
window.CommandPalette = CommandPalette;
