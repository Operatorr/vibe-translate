// SiteNav.jsx — top nav shared across landing/pricing/app pages
const SiteNav = ({ theme, onToggleTheme, route, onNavigate, onOpenPalette }) => {
  return (
    <header className="vt-topnav">
      <div className="vt-topnav__left">
        <a className="vt-mark" href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <mask id="sn-notch">
                <rect width="64" height="64" fill="white"/>
                <circle cx="44" cy="22" r="14" fill="black"/>
              </mask>
            </defs>
            <circle cx="32" cy="32" r="28" fill="currentColor" mask="url(#sn-notch)"/>
            <circle cx="44" cy="22" r="6" fill="#1f7aff"/>
          </svg>
          <span className="vt-mark__name">Vibe Translate</span>
        </a>
        <nav className="vt-topnav__nav">
          <a className={"vt-navlink " + (route === '/' ? 'vt-navlink--active' : '')} href="#/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }}>Product</a>
          <a className={"vt-navlink " + (route === '/pricing' ? 'vt-navlink--active' : '')} href="#/pricing" onClick={(e) => { e.preventDefault(); onNavigate('/pricing'); }}>Pricing</a>
          <a className={"vt-navlink " + (route === '/app' ? 'vt-navlink--active' : '')} href="#/app" onClick={(e) => { e.preventDefault(); onNavigate('/app'); }}>App</a>
          <a className="vt-navlink" href="#" onClick={(e) => e.preventDefault()}>Docs</a>
          <a className="vt-navlink" href="#" onClick={(e) => e.preventDefault()}>Changelog</a>
        </nav>
      </div>
      <div className="vt-topnav__right">
        {route === '/app' && (
          <button className="vt-cmdk" onClick={onOpenPalette}>
            <i data-lucide="search"></i>
            <span>Search or jump to</span>
            <kbd>⌘K</kbd>
          </button>
        )}
        {route !== '/app' && (
          <a className="vt-navlink" href="#/app" onClick={(e) => { e.preventDefault(); onNavigate('/app'); }}>Sign in</a>
        )}
        <button className="vt-iconbtn" aria-label="Toggle theme" onClick={onToggleTheme}>
          <i data-lucide={theme === 'dark' ? 'sun' : 'moon'}></i>
        </button>
        {route !== '/app' && (
          <button
            className="vt-btn vt-btn--primary"
            style={{padding: '8px 14px', fontSize: 13}}
            onClick={() => onNavigate('/app')}
          >
            Start translating
          </button>
        )}
        {route === '/app' && (
          <div className="vt-account">
            <div className="vt-avatar">M</div>
          </div>
        )}
      </div>
    </header>
  );
};
window.SiteNav = SiteNav;
