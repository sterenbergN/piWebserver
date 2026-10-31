'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addGroceryItem } from '@/lib/recipes/grocery-client';
import { matchNavItems, type NavGroup, type NavItem } from './nav-links';
import { loadNavBadges, type NavBadges } from './nav-badges';
import { useRecentPages } from './useNavPins';
import './launcher.css';

type Hit = { kind: string; title: string; url: string; subtitle?: string; snippet?: string };

const KIND_ICON: Record<string, string> = { post: '📝', album: '🖼️', photo: '📷', document: '📄', project: '🛠️', page: '🔗' };
/** Typing one of these words first makes adding to the list what Enter does. */
const ADD_PREFIX = /^(add|buy|get)\s+/i;

const Star = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />
  </svg>
);

/**
 * Everything on the site in one place, and the way to find anything in it. Open
 * it with the All button, "/" or Ctrl+K. Empty, it's every page by section, with
 * today's counts; type, and it's pages, then content, then "add to the list".
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

  const q = query.trim();
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const byHref = (href: string) => items.find((i) => i.href === href);
  const pinnedItems = pins.flatMap((href) => byHref(href) ?? []);
  const recentItems = recent.flatMap((href) => (href !== current && !pins.includes(href) ? byHref(href) ?? [] : [])).slice(0, 4);
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

  const tile = (item: NavItem, keyPrefix = '') => {
    const pinned = pins.includes(item.href);
    return (
      <li key={keyPrefix + item.href} className="lc-tile">
        <Link data-lc href={item.href} onClick={onFollow(item.href)} aria-current={item.href === current ? 'page' : undefined}>
          <span className="lc-icon" aria-hidden>{item.icon}</span>
          <span className="lc-text">
            <strong>{item.label}</strong>
            {item.blurb && <small>{item.blurb}</small>}
          </span>
          {badges[item.href] && <span className="lc-badge">{badges[item.href]}</span>}
        </Link>
        <button type="button" className={`lc-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`} title={pinned ? 'Unpin' : 'Pin to your header and dock'} onClick={() => togglePin(item.href)}>
          <Star on={pinned} />
        </button>
      </li>
    );
  };

  const addRow = groceryText && (
    <button type="button" data-lc className="lc-row" onClick={addToList}>
      <span className="lc-icon" aria-hidden>🛒</span>
      <span className="lc-text"><strong>Add “{groceryText}” to your grocery list</strong></span>
    </button>
  );

  // Portal: stays clear of the header's stacking.
  return createPortal(
    <div className="lc-backdrop" onClick={onClose}>
      <div ref={panelRef} className="lc-panel" role="dialog" aria-modal="true" aria-label="Find anything" onClick={(e) => e.stopPropagation()} onKeyDown={move}>
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
                  <ul className="lc-tiles">{pageHits.map((item) => tile(item))}</ul>
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
              {pinnedItems.length > 0 && (
                <section aria-label="Pinned">
                  <h2>Pinned</h2>
                  <ul className="lc-tiles is-wide">{pinnedItems.map((item) => tile(item, 'pin-'))}</ul>
                </section>
              )}
              {recentItems.length > 0 && (
                <section aria-label="Recent">
                  <h2>Lately</h2>
                  <div className="lc-chips">
                    {recentItems.map((item) => (
                      <Link data-lc key={item.href} href={item.href} onClick={onFollow(item.href)}><span aria-hidden>{item.icon}</span>{item.label}</Link>
                    ))}
                  </div>
                </section>
              )}
              <div className="lc-groups">
                {groups.map((group) => (
                  <section key={group.label} aria-label={group.label}>
                    <h2><span aria-hidden>{group.icon}</span> {group.label}</h2>
                    <ul className="lc-tiles">{group.items.map((item) => tile(item))}</ul>
                  </section>
                ))}
              </div>
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
