'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addGroceryItem } from '@/lib/recipes/grocery-client';
import { allPlaces, matchNavItems, orderRooms, type NavGroup } from './nav-links';
import { loadNavBadges, type NavBadges } from './nav-badges';
import { Door, ExploreMeter, RoomGrid, type RoomContext } from './Rooms';
import { useFoundPlaces, useRecentPages } from './useNavPins';
import './launcher.css';

type Hit = { kind: string; title: string; url: string; subtitle?: string; snippet?: string };

const KIND_ICON: Record<string, string> = { post: '📝', album: '🖼️', photo: '📷', document: '📄', project: '🛠️', page: '🔗' };
/** Typing one of these words first makes adding to the list what Enter does. */
const ADD_PREFIX = /^(add|buy|get)\s+/i;

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
};

/**
 * Everything on the site in one place, and the way to find anything in it. Open
 * it with the Explore button, "/" or Ctrl+K. Empty, it's a map of rooms by what
 * you came to do; type, and it's pages, then content, then "add to the list".
 */
export default function Launcher({ groups, pins, togglePin, current, signedIn, theme, onToggleTheme, onFollow, onClose }: {
  groups: NavGroup[];
  pins: string[];
  togglePin: (href: string) => void;
  current?: string;
  signedIn: boolean;
  theme: string;
  onToggleTheme: () => void;
  onFollow: (href: string) => (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [badges, setBadges] = useState<NavBadges>({});
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useRecentPages();
  const found = useFoundPlaces();

  const q = query.trim();
  const items = useMemo(() => allPlaces(groups), [groups]);
  const byHref = (href: string) => items.find((i) => i.href === href);
  // A visitor's pins are only the defaults, which the rooms already show.
  const pinnedItems = signedIn ? pins.flatMap((href) => byHref(href) ?? []) : [];
  const recentItems = recent.flatMap((href) => (href !== current && !pinnedItems.some((p) => p.href === href) ? byHref(href) ?? [] : [])).slice(0, 4);
  const shortcuts = [...pinnedItems, ...recentItems];
  const ctx: RoomContext = { signedIn, found, badges, pins, togglePin, current, onFollow, onLeave: onClose };
  const pageHits = useMemo(() => matchNavItems(items, q), [items, q]);
  const pageUrls = new Set(pageHits.map((i) => i.href));
  const contentHits = hits.filter((h) => !pageUrls.has(h.url));
  const groceryText = q.replace(ADD_PREFIX, '').trim();
  const addFirst = ADD_PREFIX.test(q) && groceryText.length > 0;

  useEffect(() => {
    let cancelled = false;
    loadNavBadges().then((b) => { if (!cancelled) setBadges(b); }).catch(() => { /* no counts, still works */ });
    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { cancelled = true; document.body.style.overflow = overflow; };
  }, []);

  useEffect(() => {
    if (!q || addFirst) { setHits([]); return; }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setHits(d.results || []))
        .catch(() => { /* pages still match */ });
    }, 150);
    return () => { clearTimeout(t); controller.abort(); };
  }, [q, addFirst]);

  const addToList = async () => {
    if (!groceryText) return;
    const ok = await addGroceryItem(groceryText);
    setFlash({ text: ok ? `Added “${groceryText}” to your grocery list` : 'Couldn’t reach the list. Try again.', ok });
    if (ok) setQuery('');
    inputRef.current?.focus();
  };

  // Arrow keys walk the links in order; Tab stays inside the dialog.
  const move = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    const all = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-lc]') ?? [])];
    if (e.key === 'Tab') {
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('a, button, input') ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      return;
    }
    const inInput = document.activeElement === inputRef.current;
    if (inInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    if (inInput) { if (forward) all[0]?.focus(); return; }
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at + (forward ? 1 : -1);
    if (next < 0) inputRef.current?.focus();
    else all[next]?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !q) return;
    e.preventDefault();
    if (addFirst) { void addToList(); return; }
    const url = pageHits[0]?.href ?? contentHits[0]?.url;
    if (url) { onClose(); router.push(url); } else void addToList();
  };

  const jumpTo = (id: string) => panelRef.current?.querySelector(`[data-room="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const addRow = groceryText && (
    <button type="button" data-lc className="lc-row" onClick={addToList}>
      <span className="lc-icon" aria-hidden>🛒</span>
      <span className="lc-text"><strong>Add “{groceryText}” to your grocery list</strong></span>
    </button>
  );

  // Portal: stays clear of the header's stacking.
  return createPortal(
    <div className="lc-backdrop" onClick={onClose}>
      <div ref={panelRef} className="lc-panel" role="dialog" aria-modal="true" aria-label="Explore the site" onClick={(e) => e.stopPropagation()} onKeyDown={move}>
        <div className="lc-search">
          <span aria-hidden>🔍</span>
          <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setFlash(null); }} onKeyDown={onInputKey}
            placeholder="Jump to a page, search posts and recipes, or “add milk”" aria-label="Search the site" enterKeyHint="go" />
          <button type="button" className="lc-close" onClick={onClose} aria-label="Close">Esc</button>
        </div>

        {flash && (
          <p className={`lc-flash${flash.ok ? '' : ' is-error'}`} role="status">
            {flash.text}
            {flash.ok && <Link href="/recipes?view=list" onClick={onClose}>Open the list</Link>}
          </p>
        )}

        <div className="lc-body">
          {q ? (
            <>
              {addFirst && addRow}
              {pageHits.length > 0 && (
                <section aria-label="Pages">
                  <h2>Pages</h2>
                  <ul className="rm-doors lc-hits">{pageHits.map((item) => <Door key={item.href} item={item} ctx={ctx} />)}</ul>
                </section>
              )}
              {contentHits.length > 0 && (
                <section aria-label="On the site">
                  <h2>On the site</h2>
                  {contentHits.map((hit) => (
                    <Link data-lc key={`${hit.kind}-${hit.url}-${hit.title}`} className="lc-row" href={hit.url} onClick={onFollow(hit.url)}>
                      <span className="lc-icon" aria-hidden>{KIND_ICON[hit.kind] || '•'}</span>
                      <span className="lc-text">
                        <strong>{hit.title}</strong>
                        {hit.subtitle && <small>{hit.subtitle}</small>}
                        {hit.snippet && <small>{hit.snippet}</small>}
                      </span>
                    </Link>
                  ))}
                </section>
              )}
              {!addFirst && (
                <section aria-label="Actions">
                  {pageHits.length + contentHits.length === 0 && <p className="lc-none">Nothing on the site matches “{q}”.</p>}
                  {addRow}
                </section>
              )}
            </>
          ) : (
            <>
              <div className="lc-intro">
                <div>
                  <h2>{greeting()} What are you up to?</h2>
                </div>
                <ExploreMeter groups={groups} ctx={ctx} />
              </div>
              {/* On a phone the rooms run long: one tap to the one you want. */}
              <nav className="lc-jump" aria-label="Jump to a room">
                {orderRooms(groups, signedIn).map((room) => (
                  <button key={room.id} type="button" style={{ '--room': room.color } as React.CSSProperties} onClick={() => jumpTo(room.id)}>
                    <span aria-hidden>{room.icon}</span>{room.label}
                  </button>
                ))}
              </nav>
              {shortcuts.length > 0 && (
                <section className="lc-chips" aria-label="Your shortcuts">
                  {shortcuts.map((item) => (
                    <Link data-lc key={item.href} href={item.href} onClick={onFollow(item.href)}>
                      <span aria-hidden>{item.icon}</span>{item.label}
                      {badges[item.href] && <span className="rm-badge">{badges[item.href]}</span>}
                    </Link>
                  ))}
                </section>
              )}
              <RoomGrid groups={groups} ctx={ctx} />
            </>
          )}
        </div>

        <footer className="lc-foot">
          <button type="button" onClick={onToggleTheme}>{theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}</button>
          {!signedIn && <button type="button" onClick={() => { onClose(); window.dispatchEvent(new Event('site:sign-in')); }}>👤 Sign in</button>}
          <span className="lc-keys" aria-hidden><kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · ☆ to pin</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
