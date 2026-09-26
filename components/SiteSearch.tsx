'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

type Hit = { kind: string; title: string; url: string; subtitle?: string; snippet?: string };

const KIND_ICON: Record<string, string> = { post: '📝', album: '🖼️', photo: '📷', document: '📄', project: '🛠️', page: '🔗' };

/** Search button for the navbar; opens a dialog. Press "/" anywhere to open it. */
export default function SiteSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => { setResults(d.results || []); setActive(0); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 150);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query]);

  const go = (hit: Hit) => {
    setOpen(false);
    setQuery('');
    router.push(hit.url);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search the site (press /)" title="Search (/)"
        style={{ background: 'var(--surface-glass)', border: '1px solid var(--surface-border)', borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer', color: 'var(--foreground)', fontSize: '1rem' }}>
        🔍
      </button>
      {/* Portal: the navbar's backdrop-filter would otherwise trap this fixed overlay inside it. */}
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Search" onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '10vh 1rem 1rem' }}>
          <div onClick={(e) => e.stopPropagation()} className="glass-panel"
            style={{ width: '100%', maxWidth: 560, padding: 0, overflow: 'hidden', background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 16 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Enter' && results[active]) go(results[active]);
              }}
              placeholder="Search posts, photos, documents, projects…"
              aria-label="Search"
              style={{ width: '100%', padding: '1rem 1.2rem', fontSize: '1.05rem', border: 'none', borderBottom: '1px solid var(--surface-border)', background: 'transparent', color: 'var(--foreground)', outline: 'none' }}
            />
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {query.trim() && !loading && results.length === 0 && (
                <p style={{ padding: '1rem 1.2rem', color: 'var(--muted)', margin: 0 }}>No matches for “{query}”.</p>
              )}
              {!query.trim() && (
                <p style={{ padding: '1rem 1.2rem', color: 'var(--muted)', margin: 0, fontSize: '0.85rem' }}>Tip: press <kbd>/</kbd> anywhere to search. ↑ ↓ to move, Enter to open.</p>
              )}
              {results.map((hit, i) => (
                <button key={`${hit.kind}-${hit.url}-${hit.title}`} onClick={() => go(hit)} onMouseEnter={() => setActive(i)}
                  style={{ display: 'flex', gap: '0.75rem', width: '100%', textAlign: 'left', padding: '0.75rem 1.2rem', border: 'none', cursor: 'pointer', color: 'var(--foreground)', background: i === active ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent', font: 'inherit' }}>
                  <span aria-hidden style={{ fontSize: '1.1rem' }}>{KIND_ICON[hit.kind] || '•'}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{hit.title}</strong>
                    {hit.subtitle && <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.subtitle}</span>}
                    {hit.snippet && <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.15rem' }}>{hit.snippet}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
