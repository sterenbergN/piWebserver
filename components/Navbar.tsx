'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import AccountMenu, { type NavUser } from './AccountMenu';
import { useSessionCheck } from './account-session';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from './ThemeProvider';
import { Icon, studyGlyph } from './study/Icon';
import { allPlaces, atPlace, isCurrentItem, isStudyPath, navGroups, placesFor, sectionOf, type NavItem } from './nav-links';
import { markFound, rememberPage, useNavPins } from './useNavPins';
import Calculator from './daily/Calculator';

// Loaded when first opened: it brings the recipe and habit code along for its counts.
const loadLauncher = () => import('./Launcher');
const Launcher = dynamic(loadLauncher, { ssr: false });
const Confetti = dynamic(() => import('./habits/Confetti'), { ssr: false });

// The URL's #hash, which picks the open tool on /tools.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash.slice(1);

/** How many pins fit along the bottom of a phone, beside the All button. */
const DOCK_PINS = 4;
/** These have their own bottom bar. */
/** A page's mark: a line icon inside Study, and the emoji everywhere else. */
function Glyph({ item, inStudy }: { item: NavItem; inStudy: boolean }) {
  const name = inStudy ? studyGlyph(item.href) : undefined;
  return <span aria-hidden>{name ? <Icon name={name} /> : item.icon}</span>;
}

const NO_DOCK = ['/workout', '/party', '/study/partner', '/study/games/snake', '/reader', '/notes', '/golf'];
/** Full-screen, printable or shared-by-link pages, where a row of other pages is only in the way. */
const NO_BAR = ['/workout/active', '/workout/station', '/workout/shared-', '/workout/config/qr', '/workout/users', '/daily/report', '/study/partner', '/reader', '/notes'];
const EVERYWHERE_KEY = 'nav:everywhere-shown';

export default function Navbar({ isAdmin, user }: { isAdmin: boolean; user: NavUser }) {
  useSessionCheck(isAdmin, user?.username);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '');
  const { theme, toggleTheme } = useTheme();
  const studyHome = !!user?.studyHome;
  const { pins, togglePin } = useNavPins(!!user, studyHome);
  // Open, and what it starts with: "?" opens it ready for a question.
  const [launcher, setLauncher] = useState<false | { query: string }>(false);
  const barRef = useRef<HTMLElement>(null);
  const pinsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const pinWidthsRef = useRef<Map<string, number>>(new Map());
  const fontsMeasuredRef = useRef(false);
  const celebratedRef = useRef<string>('');
  const launcherOpenRef = useRef(false);
  const keyBufRef = useRef<{ str: string; at: number }>({ str: '', at: 0 });
  const [visiblePinCount, setVisiblePinCount] = useState<number>(6);
  const [moreOpen, setMoreOpen] = useState(false);
  const [discovery, setDiscovery] = useState<{ text: string; everywhere: boolean } | null>(null);

  const groups = navGroups(isAdmin);
  const section = sectionOf(pathname);
  const signedIn = isAdmin || !!user;
  const allItems = groups.flatMap((g) => g.items);
  const places = allPlaces(groups);
  const itemIsCurrent = (item: NavItem) => (allItems.includes(item) ? isCurrentItem(item, section, hash, allItems, search) : atPlace(item, section, hash, search));
  const pinned = pins.flatMap((href) => places.find((i) => i.href === href) ?? []);
  const here = allItems.find(itemIsCurrent);
  const foundHere = places.filter(itemIsCurrent).map((p) => p.href).join(' ');
  const barGroup = NO_BAR.some((p) => pathname.startsWith(p)) ? undefined : groups.find((g) => g.bar && g.items.some(itemIsCurrent));
  const showDock = !NO_DOCK.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Study is its own space: its pages replace your pins while you're in it, and Explore is the way out.
  const inStudy = isStudyPath(pathname);
  const headerPins = inStudy ? [] : pinned.slice(0, 6);
  const headerPinsKey = headerPins.map((i) => i.href).join('\n');
  const shownPins = headerPins.slice(0, Math.min(visiblePinCount, headerPins.length));
  const overflowPins = headerPins.slice(shownPins.length);
  const dockItems = inStudy ? groups.find((g) => g.id === 'study')!.items.slice(0, DOCK_PINS) : pinned.slice(0, DOCK_PINS);
  const studyLogo = inStudy || studyHome;

  useEffect(() => { if (here) rememberPage(here.href); }, [here]);

  // Measure pinned header links so overflowing pins move cleanly into +N instead of being clipped.
  useLayoutEffect(() => {
    const container = pinsRef.current;
    if (!container || headerPins.length === 0) {
      setVisiblePinCount(headerPins.length);
      return;
    }

    const computeFit = () => {
      const available = container.clientWidth;
      if (available <= 0) {
        setVisiblePinCount(headerPins.length);
        return;
      }

      for (const el of container.querySelectorAll<HTMLElement>('[data-pin-href]')) {
        const href = el.dataset.pinHref;
        if (href && el.offsetWidth > 0) pinWidthsRef.current.set(href, el.offsetWidth);
      }

      if (headerPins.some((item) => !pinWidthsRef.current.has(item.href))) {
        setVisiblePinCount(headerPins.length);
        return;
      }

      const gap = 4;
      const totalWidth = headerPins.reduce((sum, item, idx) => sum + (pinWidthsRef.current.get(item.href) ?? 0) + (idx > 0 ? gap : 0), 0);
      if (totalWidth <= available) {
        setVisiblePinCount(headerPins.length);
        return;
      }

      const moreWidth = 54;
      let used = 0;
      let fit = 0;
      for (let i = 0; i < headerPins.length; i++) {
        const w = pinWidthsRef.current.get(headerPins[i].href) ?? 0;
        const nextUsed = used + (i > 0 ? gap : 0) + w;
        if (nextUsed + gap + moreWidth <= available) {
          used = nextUsed;
          fit = i + 1;
        } else {
          break;
        }
      }
      setVisiblePinCount(fit);
    };

    computeFit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(computeFit) : null;
    ro?.observe(container);
    let cancelled = false;
    // Widths taken before the web font loaded are re-measured once. Only once: this effect re-runs on
    // every visiblePinCount change, and clearing the cache each time showed every pin again to measure
    // it, which changed the count, which ran this again — an endless render loop when pins overflow.
    if (!fontsMeasuredRef.current) {
      document.fonts?.ready.then(() => {
        if (cancelled || fontsMeasuredRef.current) return;
        fontsMeasuredRef.current = true;
        pinWidthsRef.current.clear();
        computeFit();
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [headerPinsKey, headerPins.length, visiblePinCount]);

  useEffect(() => {
    if (!overflowPins.length && moreOpen) setMoreOpen(false);
  }, [overflowPins.length, moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  // Reaching somewhere new gets a small nod, except on the first page anyone sees or in the middle of something.
  useEffect(() => {
    if (!foundHere) return;
    const { fresh, all, firstVisit } = markFound(foundHere.split(' '));
    const goals = placesFor(navGroups(isAdmin), signedIn);
    const count = goals.filter((p) => all.includes(p.href)).length;
    const everywhere = goals.length > 0 && count === goals.length;
    const scopeKey = `${signedIn ? 'user' : 'guest'}:${goals.length}`;
    let alreadyCelebrated = celebratedRef.current === scopeKey;
    try {
      if (localStorage.getItem(EVERYWHERE_KEY) === scopeKey) alreadyCelebrated = true;
    } catch { /* Private browsing: ref fallback already checked. */ }

    const excluded = firstVisit || isStudyPath(window.location.pathname) || NO_BAR.some((p) => window.location.pathname.startsWith(p));
    if (excluded) return;

    if (everywhere && !alreadyCelebrated) {
      celebratedRef.current = scopeKey;
      try { localStorage.setItem(EVERYWHERE_KEY, scopeKey); } catch { /* ignore */ }
      setDiscovery({ everywhere: true, text: '🏆 You’ve been everywhere on the site!' });
      return;
    }
    if (!fresh.length) return;
    const newest = goals.find((p) => p.href === fresh[fresh.length - 1]);
    if (!newest) return;
    setDiscovery({ everywhere: false, text: `🧭 New place found: ${newest.label} · ${count} of ${goals.length}` });
  }, [foundHere, isAdmin, signedIn]);

  // Timed from the nod itself, so moving on to another page can't leave it up.
  useEffect(() => {
    if (!discovery) return;
    const handle = window.setTimeout(() => setDiscovery(null), discovery.everywhere ? 6000 : 3200);
    return () => window.clearTimeout(handle);
  }, [discovery]);

  // "/" or Ctrl+K opens the panel from anywhere; "?" opens it to jot down a question for Skills.
  // Alt+C toggles/opens the floating calculator; rolling /calc + Space|Enter or /calculator opens it too.
  useEffect(() => {
    launcherOpenRef.current = !!launcher;
  }, [launcher]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // In a text field Alt+C is left alone (on a Mac, Option+C types "ç"), except in the calculator itself.
      const inTextField = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC')
        && (!inTextField || !!target?.closest('.dq-calc'))) {
        e.preventDefault();
        setLauncher(false);
        window.dispatchEvent(new CustomEvent('site:open-calculator', { detail: { toggle: true } }));
        return;
      }
      // defaultPrevented: a widget already used the key (the daily calculator's / makes a fraction).
      const typing = e.defaultPrevented || (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
      const inCalc = !!target?.closest('.dq-calc');
      if ((e.key === '/' && !typing && !inCalc) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        keyBufRef.current.str = '';
        setLauncher({ query: '' });
      } else if (e.key === '?' && !typing && !inCalc && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        keyBufRef.current.str = '';
        setLauncher({ query: '? ' });
      } else if (!typing && !inCalc && !launcherOpenRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        if (now - keyBufRef.current.at > 1200) keyBufRef.current.str = '';
        keyBufRef.current.at = now;
        if (e.key === 'Backspace') {
          keyBufRef.current.str = keyBufRef.current.str.slice(0, -1);
        } else if (e.key === 'Enter') {
          if (keyBufRef.current.str.endsWith('/calc') || keyBufRef.current.str.endsWith('/calculator')) {
            e.preventDefault();
            keyBufRef.current.str = '';
            window.dispatchEvent(new CustomEvent('site:open-calculator'));
          } else {
            keyBufRef.current.str = '';
          }
        } else if (e.key.length === 1) {
          const next = (keyBufRef.current.str + e.key.toLowerCase()).slice(-16);
          keyBufRef.current.str = next;
          if (next.endsWith('/calc ') || next.endsWith('/calculator')) {
            e.preventDefault();
            keyBufRef.current.str = '';
            window.dispatchEvent(new CustomEvent('site:open-calculator'));
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pages with their own header (/reader, /notes) can open Explore via window.dispatchEvent(new Event('site:open-launcher')).
  useEffect(() => {
    const open = () => {
      void loadLauncher();
      setLauncher({ query: '' });
    };
    window.addEventListener('site:open-launcher', open);
    return () => window.removeEventListener('site:open-launcher', open);
  }, []);

  // On a phone the bar scrolls sideways: keep the current page in view.
  useEffect(() => {
    barRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname, barGroup?.label]);

  const follow = (href: string) => (e: React.MouseEvent) => {
    setLauncher(false);
    setMoreOpen(false);
    // A link to another #hash of this page: change the hash so the page hears it.
    const [withQuery, itemHash] = href.split('#');
    const [path, query] = withQuery.split('?');
    if (itemHash && path === window.location.pathname && (!query || `?${query}` === window.location.search)) {
      e.preventDefault();
      const oldURL = window.location.href;
      if (window.location.hash !== `#${itemHash}`) {
        window.location.hash = itemHash;
      }
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
    }
  };

  const openButton = { onClick: () => setLauncher({ query: '' }), onPointerEnter: () => { void loadLauncher(); } };

  return (
    <>
      <nav className="glass-nav" aria-label="Main">
        <Link href={studyLogo ? '/study' : '/'} className="nav-logo">{studyLogo ? '🩺' : '🐾'} <span>{studyLogo ? 'PA Study' : 'Noah Stuf'}</span></Link>

        <div className="nav-pins" ref={pinsRef}>
          <div className="nav-pins-list">
            {shownPins.map((item) => (
              <Link key={item.href} href={item.href} data-pin-href={item.href} onClick={follow(item.href)} className="nav-link" aria-current={itemIsCurrent(item) ? 'page' : undefined}>
                {item.label}
              </Link>
            ))}
          </div>
          {overflowPins.length > 0 && (
            <div className="nav-group" ref={moreRef}>
              <button
                type="button"
                className={`nav-link nav-pins-more${overflowPins.some(itemIsCurrent) ? ' is-current' : ''}`}
                aria-expanded={moreOpen}
                aria-controls="nav-pins-overflow"
                aria-label={`${overflowPins.length} more pinned pages`}
                onClick={() => setMoreOpen((o) => !o)}
              >
                +{overflowPins.length}
              </button>
              {moreOpen && (
                <div className="nav-menu" id="nav-pins-overflow">
                  <div className="nav-menu-panel">
                    {overflowPins.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={follow(item.href)}
                        aria-current={itemIsCurrent(item) ? 'page' : undefined}
                      >
                        <span aria-hidden>{item.icon}</span>{item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
        <AccountMenu user={user} isAdmin={isAdmin} />
      </nav>

      {/* The pages next to this one, so moving around a section takes one tap. */}
      {barGroup && (
        <nav ref={barRef} className={`section-bar${barGroup.bar === 'wide' ? ' is-wide-only' : ''}`} aria-label={barGroup.label}>
          {barGroup.items.map((item) => (
            <Link key={item.href} href={item.href} onClick={follow(item.href)} aria-current={itemIsCurrent(item) ? 'page' : undefined}>
              <Glyph item={item} inStudy={inStudy} />{item.label}
            </Link>
          ))}
        </nav>
      )}

      {/* On a phone, your pins sit under your thumb. */}
      {showDock && (
        <nav className="site-dock" aria-label={inStudy ? 'Study' : 'Pinned pages'}>
          {dockItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={follow(item.href)} aria-current={itemIsCurrent(item) ? 'page' : undefined}>
              <Glyph item={item} inStudy={inStudy} />
              <span>{item.short ?? item.label}</span>
            </Link>
          ))}
          <button type="button" onClick={() => setLauncher({ query: '' })}>
            <span aria-hidden>{inStudy ? <Icon name="compass" /> : '🧭'}</span>
            <span>Explore</span>
          </button>
        </nav>
      )}

      {discovery && !launcher && <div className="nav-discovery" role="status">{discovery.text}</div>}
      {discovery?.everywhere && <Confetti fire={1} />}

      {launcher && (
        <Launcher groups={groups} pins={pins} togglePin={togglePin} current={here?.href} signedIn={!!user} studyFirst={studyHome} theme={theme}
          onToggleTheme={toggleTheme} onFollow={follow} onClose={() => setLauncher(false)} initialQuery={launcher.query} />
      )}
      <Calculator />
    </>
  );
}
