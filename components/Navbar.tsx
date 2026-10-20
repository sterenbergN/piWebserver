'use client';

import Link from 'next/link';
import SiteSearch from './SiteSearch';
import AccountMenu, { type NavUser } from './AccountMenu';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from './ThemeProvider';
import { isCurrentItem, navGroups, sectionOf, type NavGroup, type NavItem } from './nav-links';

// The URL's #hash, which picks the open tool on /tools.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash.slice(1);

export default function Navbar({ isAdmin, user }: { isAdmin: boolean; user: NavUser }) {
  const pathname = usePathname();
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = useRef<string | null>(null);

  const groups = navGroups(isAdmin);
  const section = sectionOf(pathname);
  const allItems = groups.flatMap((g) => g.items);
  const itemIsCurrent = (item: NavItem) => isCurrentItem(item, section, hash, allItems);
  const groupIsCurrent = (group: NavGroup) => group.items.some(itemIsCurrent);

  // Close an open dropdown on an outside click or Escape.
  useEffect(() => {
    if (!openGroup) return;
    const onPointer = (e: PointerEvent) => {
      if (!groupsRef.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroup(null); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  // Mouse users get the dropdown on hover; touch and keyboard open it by tapping the label.
  const hoverOpen = (label: string) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (openGroup !== label) openedByHover.current = label;
    setOpenGroup(label);
  };
  const hoverClose = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    openedByHover.current = null;
    hoverTimer.current = setTimeout(() => setOpenGroup(null), 180);
  };
  const toggleGroup = (label: string) => {
    // A click right after hovering a menu open keeps it open instead of closing it.
    if (openedByHover.current === label) {
      openedByHover.current = null;
      setOpenGroup(label);
      return;
    }
    setOpenGroup((g) => (g === label ? null : label));
  };

  const follow = (item: NavItem) => (e: React.MouseEvent) => {
    setOpenGroup(null);
    setMenuOpen(false);
    // A link to another #hash of this page: change the hash so the page hears it.
    const [path, itemHash] = item.href.split('#');
    if (itemHash && path === pathname) {
      e.preventDefault();
      window.location.hash = itemHash;
    }
  };

  const themeButton = (
    <button
      onClick={toggleTheme}
      className="btn btn-secondary nav-icon-btn"
      aria-label="Toggle theme"
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );

  return (
    <nav className="glass-nav">
      <Link href="/" style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--foreground)', flexShrink: 0 }}>
        🐾 Noah Stuf
      </Link>

      {/* One search for desktop and mobile; the auto margin keeps it beside the links. */}
      <div style={{ marginLeft: 'auto', marginRight: '0.5rem', display: 'flex' }}>
        <SiteSearch />
      </div>

      {/* Desktop links: one link per section, or a dropdown for a group of them */}
      <div className="nav-links" ref={groupsRef}>
        {groups.map((group) => {
          if (group.items.length === 1) {
            const item = group.items[0];
            return (
              <Link key={group.label} href={item.href} onClick={follow(item)} className="nav-link"
                aria-current={itemIsCurrent(item) ? 'page' : undefined}>
                {item.label}
              </Link>
            );
          }
          const open = openGroup === group.label;
          const menuId = `nav-menu-${group.label.toLowerCase()}`;
          return (
            <div key={group.label} className="nav-group" onPointerEnter={hoverOpen(group.label)} onPointerLeave={hoverClose}>
              <button type="button" className="nav-link" onClick={() => toggleGroup(group.label)}
                aria-expanded={open} aria-controls={menuId} data-current={groupIsCurrent(group) || undefined}>
                {group.label}<span className="nav-caret" aria-hidden>▾</span>
              </button>
              {open && (
                <div className="nav-menu" id={menuId}>
                  <div className="nav-menu-panel">
                    {group.items.map((item) => (
                      <Link key={item.href} href={item.href} onClick={follow(item)} aria-current={itemIsCurrent(item) ? 'page' : undefined}>
                        <span aria-hidden>{item.icon}</span>{item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {themeButton}
      </div>

      <AccountMenu user={user} />

      {/* Mobile Right: Theme Toggle + Hamburger */}
      <div className="nav-mobile-controls">
        {themeButton}
        <button
          className="hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile menu: groups fold away; the one you're in starts open */}
      {menuOpen && (
        <div className="mobile-menu">
          {groups.map((group) => group.items.length === 1 ? (
            <Link key={group.label} href={group.items[0].href} onClick={follow(group.items[0])} className="mobile-link"
              aria-current={itemIsCurrent(group.items[0]) ? 'page' : undefined}>
              {group.items[0].label}
            </Link>
          ) : (
            <details key={group.label} className="mobile-group" open={groupIsCurrent(group)}>
              <summary data-current={groupIsCurrent(group) || undefined}>{group.label}</summary>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} onClick={follow(item)} className="mobile-link is-sub"
                  aria-current={itemIsCurrent(item) ? 'page' : undefined}>
                  <span aria-hidden>{item.icon}</span>{item.label}
                </Link>
              ))}
            </details>
          ))}
        </div>
      )}
    </nav>
  );
}
