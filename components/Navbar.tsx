'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import AccountMenu, { type NavUser } from './AccountMenu';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from './ThemeProvider';
import { allPlaces, atPlace, isCurrentItem, navGroups, sectionOf, type NavItem } from './nav-links';
import { markFound, rememberPage, useNavPins } from './useNavPins';

// Loaded when first opened: it brings the recipe and habit code along for its counts.
const loadLauncher = () => import('./Launcher');
const Launcher = dynamic(loadLauncher, { ssr: false });

// The URL's #hash, which picks the open tool on /tools.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash.slice(1);

/** How many pins fit along the bottom of a phone, beside the All button. */
const DOCK_PINS = 4;
/** These have their own bottom bar. */
const NO_DOCK = ['/workout', '/party'];
/** Full-screen, printable or shared-by-link pages, where a row of other pages is only in the way. */
const NO_BAR = ['/workout/active', '/workout/station', '/workout/shared-', '/workout/config/qr', '/workout/users', '/daily/report'];

export default function Navbar({ isAdmin, user }: { isAdmin: boolean; user: NavUser }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const { theme, toggleTheme } = useTheme();
  const { pins, togglePin } = useNavPins(!!user);
  const [launcher, setLauncher] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  const groups = navGroups(isAdmin);
  const section = sectionOf(pathname);
  const allItems = groups.flatMap((g) => g.items);
  const places = allPlaces(groups);
  const itemIsCurrent = (item: NavItem) => (allItems.includes(item) ? isCurrentItem(item, section, hash, allItems, search) : atPlace(item, section, hash, search));
  const pinned = pins.flatMap((href) => places.find((i) => i.href === href) ?? []);
  const here = allItems.find(itemIsCurrent);
  const foundHere = places.filter(itemIsCurrent).map((p) => p.href).join(' ');
  const barGroup = NO_BAR.some((p) => pathname.startsWith(p)) ? undefined : groups.find((g) => g.bar && g.items.some(itemIsCurrent));
  const showDock = !NO_DOCK.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => { if (here) rememberPage(here.href); }, [here]);
  useEffect(() => { if (foundHere) markFound(foundHere.split(' ')); }, [foundHere]);

  // "/" or Ctrl+K opens the panel from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // defaultPrevented: a widget already used the key (the daily calculator's / makes a fraction).
      const typing = e.defaultPrevented || (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setLauncher(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // On a phone the bar scrolls sideways: keep the current page in view.
  useEffect(() => {
    barRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname, barGroup?.label]);

  const follow = (href: string) => (e: React.MouseEvent) => {
    setLauncher(false);
    // A link to another #hash of this page: change the hash so the page hears it.
    const [path, itemHash] = href.split('#');
    if (itemHash && path === window.location.pathname) {
      e.preventDefault();
      window.location.hash = itemHash;
    }
  };

  const openButton = { onClick: () => setLauncher(true), onPointerEnter: () => { void loadLauncher(); } };

  return (
    <>
      <nav className="glass-nav" aria-label="Main">
        <Link href="/" className="nav-logo">🐾 <span>Noah Stuf</span></Link>

        <div className="nav-pins">
          {pinned.slice(0, 6).map((item) => (
            <Link key={item.href} href={item.href} onClick={follow(item.href)} className="nav-link" aria-current={itemIsCurrent(item) ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </div>

        <button type="button" className="nav-search" aria-label="Search or jump to a page (press /)" title="Search or jump to a page (/)" {...openButton}>
          <span aria-hidden>🔍</span>
          <span className="nav-search-text">Search or jump to…</span>
          <kbd aria-hidden>/</kbd>
        </button>
        <button type="button" className="nav-all" aria-label="Explore everything on the site" title="Explore everything on the site" {...openButton}>
          <span aria-hidden>🧭</span><span>Explore</span>
        </button>
        {/* Both icons, with CSS picking one: the server can't know the theme a browser saved. */}
        <button type="button" onClick={toggleTheme} className="nav-theme" aria-label="Switch between light and dark" title="Switch between light and dark">
          <span className="nav-theme-sun" aria-hidden>☀️</span>
          <span className="nav-theme-moon" aria-hidden>🌙</span>
        </button>
        <AccountMenu user={user} />
      </nav>

      {/* The pages next to this one, so moving around a section takes one tap. */}
      {barGroup && (
        <nav ref={barRef} className={`section-bar${barGroup.bar === 'wide' ? ' is-wide-only' : ''}`} aria-label={barGroup.label}>
          {barGroup.items.map((item) => (
            <Link key={item.href} href={item.href} onClick={follow(item.href)} aria-current={itemIsCurrent(item) ? 'page' : undefined}>
              <span aria-hidden>{item.icon}</span>{item.label}
            </Link>
          ))}
        </nav>
      )}

      {/* On a phone, your pins sit under your thumb. */}
      {showDock && (
        <nav className="site-dock" aria-label="Pinned pages">
          {pinned.slice(0, DOCK_PINS).map((item) => (
            <Link key={item.href} href={item.href} onClick={follow(item.href)} aria-current={itemIsCurrent(item) ? 'page' : undefined}>
              <span aria-hidden>{item.icon}</span>
              <span>{item.short ?? item.label}</span>
            </Link>
          ))}
          <button type="button" onClick={() => setLauncher(true)}>
            <span aria-hidden>🧭</span>
            <span>Explore</span>
          </button>
        </nav>
      )}

      {launcher && (
        <Launcher groups={groups} pins={pins} togglePin={togglePin} current={here?.href} signedIn={!!user} theme={theme}
          onToggleTheme={toggleTheme} onFollow={follow} onClose={() => setLauncher(false)} />
      )}
    </>
  );
}
