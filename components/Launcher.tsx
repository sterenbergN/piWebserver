'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addGroceryItem } from '@/lib/recipes/grocery-client';
import { allPlaces, matchNavItems, orderRooms, type NavGroup } from './nav-links';
import { loadNavInfo, type NavInfo } from './nav-badges';
import { Door, ExploreMeter, RoomGrid, type RoomContext } from './Rooms';
import { useFoundPlaces, useRecentPages } from './useNavPins';
import './launcher.css';

type Hit = { kind: string; title: string; url: string; subtitle?: string; snippet?: string };

const KIND_ICON: Record<string, string> = { post: '📝', album: '🖼️', photo: '📷', document: '📄', project: '🛠️', page: '🔗' };
/**
 * What the box is for. Find never saves anything: a question or a grocery item
 * only gets saved from its own mode, so a stray Enter can't put either anywhere.
 */
type Mode = 'find' | 'ask' | 'list';
/** "add milk" / "buy milk" in Find offers (never does) the grocery list. */
const ADD_PREFIX = /^(add|buy)\s+/i;
/** Typing "?" first in Find switches to asking. */
const ASK_PREFIX = /^\?+\s*/;
/** Reads like a question: Find offers to save it, and Enter opens it as one. */
const QUESTION_START = /^(who|what|whats|what's|when|where|why|how|which|is|are|can|could|should|would|does|do|did|will)\b/i;

const MODES: { id: Mode; icon: string; label: string; placeholder: string }[] = [
  { id: 'find', icon: '🔍', label: 'Find', placeholder: 'Jump to a page or search the site' },
  { id: 'ask', icon: '❓', label: 'Ask a question', placeholder: 'What do you want to look up later?' },
  { id: 'list', icon: '🛒', label: 'Grocery list', placeholder: 'An item for the list, e.g. 2 lemons' },
];

/** The Skills subject a page belongs to, so a question asked there is filed with it. */
const subjectHere = () => /^\/skills\/([^/?#]+)/.exec(window.location.pathname)?.[1];

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
};

/**
 * Everything on the site in one place, and the way to find anything in it. Open
 * it with the Explore button, "/" or Ctrl+K. Empty, it's a map of rooms by what
 * you came to do; type, and it's pages, then content. Asking a question or adding to
 * the grocery list each has its own mode, so neither happens by accident.
 */
export default function Launcher({ groups, pins, togglePin, current, signedIn, studyFirst, theme, onToggleTheme, onFollow, onClose, initialQuery = '' }: {
  groups: NavGroup[];
  pins: string[];
  togglePin: (href: string) => void;
  current?: string;
  signedIn: boolean;
  studyFirst?: boolean;
  theme: string;
  onToggleTheme: () => void;
  onFollow: (href: string) => (e: React.MouseEvent) => void;
  onClose: () => void;
  /** Opened with "?": starts as a question. */
  initialQuery?: string;
}) {
  const router = useRouter();
  const startsAsking = signedIn && ASK_PREFIX.test(initialQuery);
  const [mode, setMode] = useState<Mode>(startsAsking ? 'ask' : 'find');
  const [query, setQuery] = useState(startsAsking ? initialQuery.replace(ASK_PREFIX, '') : initialQuery);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [info, setInfo] = useState<NavInfo | undefined>();
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean; href?: string; link?: string } | null>(null);
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
  const ctx: RoomContext = { signedIn, studyFirst, found, info, pins, togglePin, editing, current, onFollow, onLeave: onClose };
  const pageHits = useMemo(() => matchNavItems(items, q), [items, q]);
  const pageUrls = new Set(pageHits.map((i) => i.href));
  const contentHits = hits.filter((h) => !pageUrls.has(h.url));
  const finding = mode === 'find';
  // In Find these are only offers, which switch modes when picked.
  const groceryOffer = ADD_PREFIX.test(q) ? q.replace(ADD_PREFIX, '').trim() : '';
  const looksLikeQuestion = signedIn && (/\?$/.test(q) || QUESTION_START.test(q));
  const modes = MODES.filter((m) => m.id !== 'ask' || signedIn);
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const subjectId = typeof window === 'undefined' ? undefined : subjectHere();
  // "Skills · Site name" → "Skills".
  const askedOn = typeof document === 'undefined' ? '' : document.title.split(/\s[|·–-]\s/)[0].trim();

  useEffect(() => {
    let cancelled = false;
    loadNavInfo().then((i) => { if (!cancelled) setInfo(i); }).catch(() => { /* no counts, still works */ });
    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { cancelled = true; document.body.style.overflow = overflow; };
  }, []);

  useEffect(() => {
    if (!q || !finding) { setHits([]); return; }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setHits(d.results || []))
        .catch(() => { /* pages still match */ });
    }, 150);
    return () => { clearTimeout(t); controller.abort(); };
  }, [q, finding]);

  /** Change what the box is for, keeping (or replacing) what's typed. */
  const switchTo = (next: Mode, text = q) => {
    setMode(next);
    setQuery(text);
    setFlash(null);
    inputRef.current?.focus();
  };

  const onType = (value: string) => {
    setFlash(null);
    if (finding && signedIn && ASK_PREFIX.test(value)) { setMode('ask'); setQuery(value.replace(ASK_PREFIX, '')); return; }
    setQuery(value);
  };

  const addToList = async () => {
    if (!q || busy) return;
    const item = q;
    setBusy(true);
    const ok = await addGroceryItem(item);
    setBusy(false);
    setFlash(ok ? { text: `Added “${item}” to your grocery list`, ok, href: '/recipes?view=list', link: 'Open the list' } : { text: 'Couldn’t reach the list. Try again.', ok });
    if (ok) setQuery('');
    inputRef.current?.focus();
  };

  // Into Skills → Lookups, with the page it was asked on, so it can be looked up later.
  const askLater = async () => {
    if (!q || busy) return;
    const question = q;
    setBusy(true);
    try {
      const { skillsPost } = await import('./skills/api');
      const payload = { question, status: 'open', ...(askedOn ? { context: `Asked on ${askedOn} (${window.location.pathname})` } : {}) };
      // A subject page's id may not be one this account has: then it's filed with no subject.
      await skillsPost('add-inquiry', subjectId ? { ...payload, subjectId } : payload)
        .catch(() => (subjectId ? skillsPost('add-inquiry', payload) : Promise.reject(new Error('failed'))));
      setFlash({ text: `Saved “${question}” to look up later`, ok: true, href: '/skills?view=inquiries', link: 'Open lookups' });
      setQuery('');
    } catch {
      setFlash({ text: 'Couldn’t save the question. Try again.', ok: false });
    }
    setBusy(false);
    inputRef.current?.focus();
  };

  // Left and right walk the icons in order, up and down go to the nearest one that
  // way; Tab stays inside the dialog.
  const move = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (editing) setEditing(false); else onClose(); return; }
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const from = all[at]?.getBoundingClientRect();
      if (!from) return;
      const dir = forward ? 1 : -1;
      const ahead = all.flatMap((el) => {
        const r = el.getBoundingClientRect();
        const down = (r.top - from.top) * dir;
        return down > 8 ? [{ el, score: down + Math.abs(r.left - from.left) * 2 }] : [];
      }).sort((a, b) => a.score - b.score);
      if (ahead[0]) ahead[0].el.focus();
      else if (!forward) inputRef.current?.focus();
      return;
    }
    const next = at + (forward ? 1 : -1);
    if (next < 0) inputRef.current?.focus();
    else all[next]?.focus();
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    // Backspace in an empty box goes back to finding.
    if (e.key === 'Backspace' && !query && !finding) { e.preventDefault(); switchTo('find', ''); return; }
    if (e.key !== 'Enter' || !q) return;
    e.preventDefault();
    if (mode === 'ask') { void askLater(); return; }
    if (mode === 'list') { void addToList(); return; }
    // Find: open the best match. A question opens the question box (it isn't saved
    // until Enter there); anything else with no match does nothing.
    const url = pageHits[0]?.href ?? contentHits[0]?.url;
    if (signedIn && /\?$/.test(q)) switchTo('ask');
    else if (url) { onClose(); router.push(url); }
    else if (looksLikeQuestion) switchTo('ask');
  };

  const jumpTo = (id: string) => panelRef.current?.querySelector(`[data-room="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Offers in Find: each opens its own mode with the text in it, ready to check and save.
  const askOffer = signedIn && (
    <button type="button" data-lc className="lc-row" onClick={() => switchTo('ask')}>
      <span className="lc-icon" aria-hidden>❓</span>
      <span className="lc-text">
        <strong>Ask “{q}” as a question…</strong>
        <small>Opens the question box · saved to Skills → Lookups once you confirm</small>
      </span>
    </button>
  );
  const listOffer = groceryOffer && (
    <button type="button" data-lc className="lc-row" onClick={() => switchTo('list', groceryOffer)}>
      <span className="lc-icon" aria-hidden>🛒</span>
      <span className="lc-text">
        <strong>Put “{groceryOffer}” on the grocery list…</strong>
        <small>Opens the grocery box · added once you confirm</small>
      </span>
    </button>
  );

  // Portal: stays clear of the header's stacking.
  return createPortal(
    <div className="lc-backdrop" onClick={onClose}>
      <div ref={panelRef} className="lc-panel" role="dialog" aria-modal="true" aria-label="Explore the site" onClick={(e) => e.stopPropagation()} onKeyDown={move}>
        <div className={`lc-search is-${mode}`}>
          <span aria-hidden>{modeInfo.icon}</span>
          <input ref={inputRef} value={query} onChange={(e) => onType(e.target.value)} onKeyDown={onInputKey}
            placeholder={modeInfo.placeholder} aria-label={modeInfo.label} enterKeyHint={finding ? 'go' : 'done'} maxLength={finding ? undefined : 500} />
          <button type="button" className="lc-close" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <div className="lc-modes" role="group" aria-label="What the box does">
          {modes.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} className={mode === m.id ? 'is-on' : ''}
              onClick={() => switchTo(m.id, m.id === 'list' && groceryOffer ? groceryOffer : q)}>
              <span aria-hidden>{m.icon}</span>{m.label}
            </button>
          ))}
          {finding && signedIn && <span className="lc-modes-tip">Tip: type <kbd>?</kbd> first to ask</span>}
        </div>

        {flash && (
          <p className={`lc-flash${flash.ok ? '' : ' is-error'}`} role="status">
            {flash.text}
            {flash.href && <Link href={flash.href} onClick={onClose}>{flash.link}</Link>}
          </p>
        )}

        <div className="lc-body">
          {mode === 'ask' ? (
            <section className="lc-compose" aria-label="Save a question">
              <div className="lc-compose-card">
                <span className="lc-icon" aria-hidden>❓</span>
                <span className="lc-text">
                  <strong>{q ? `“${q}”` : 'Type the question in the box above'}</strong>
                  <small>Goes to Skills → Lookups{subjectId ? ', filed with this subject' : ''}{askedOn ? ` · noted as asked on ${askedOn}` : ''}</small>
                </span>
              </div>
              <div className="lc-compose-actions">
                <button type="button" className="btn btn-primary" disabled={!q || busy} onClick={askLater}>{busy ? 'Saving…' : 'Save question'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => switchTo('find')}>{q ? 'Search the site instead' : 'Back to search'}</button>
                <Link className="lc-compose-link" href="/skills?view=inquiries" onClick={onClose}>Your lookups →</Link>
              </div>
              <p className="lc-compose-hint"><kbd>Enter</kbd> saves · <kbd>Backspace</kbd> in an empty box goes back to search</p>
            </section>
          ) : mode === 'list' ? (
            <section className="lc-compose is-list" aria-label="Add to the grocery list">
              <div className="lc-compose-card">
                <span className="lc-icon" aria-hidden>🛒</span>
                <span className="lc-text">
                  <strong>{q ? `Add “${q}” to the grocery list` : 'Type an item in the box above'}</strong>
                  <small>{signedIn ? 'Your household’s list in Recipes' : 'Kept on this device'}</small>
                </span>
              </div>
              <div className="lc-compose-actions">
                <button type="button" className="btn btn-primary" disabled={!q || busy} onClick={addToList}>{busy ? 'Adding…' : 'Add to list'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => switchTo('find', '')}>Cancel</button>
                <Link className="lc-compose-link" href="/recipes?view=list" onClick={onClose}>Open the list →</Link>
              </div>
              <p className="lc-compose-hint"><kbd>Enter</kbd> adds · <kbd>Backspace</kbd> in an empty box goes back to search</p>
            </section>
          ) : q ? (
            <>
              {looksLikeQuestion && askOffer}
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
              <section aria-label="Actions">
                {pageHits.length + contentHits.length === 0 && <p className="lc-none">Nothing on the site matches “{q}”.</p>}
                {!looksLikeQuestion && pageHits.length + contentHits.length === 0 && askOffer}
                {listOffer}
              </section>
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
                {orderRooms(groups, signedIn, studyFirst).map((room) => (
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
                      {info?.badges[item.href] && <span className="rm-badge">{info.badges[item.href]}</span>}
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
          <button type="button" className={editing ? 'is-on' : ''} aria-pressed={editing} onClick={() => { setEditing(!editing); setMode('find'); setQuery(''); }}>{editing ? '✓ Done' : '⭐ Choose shortcuts'}</button>
          <span className="lc-keys" aria-hidden>{editing ? 'Tap a star to keep it in your header and dock' : <><kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd> to move · <kbd>Enter</kbd> to open</>}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
