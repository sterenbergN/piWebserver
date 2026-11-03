'use client';

import { useEffect, useState, type ReactNode } from 'react';

/** The golf app is one page (so it opens offline); the part of it showing lives after the #. */
export function useHashRoute(): [string[], (path: string, replace?: boolean) => void] {
  const read = () => (typeof window === 'undefined' ? [] : decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean));
  const [route, setRoute] = useState<string[]>([]);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    on();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (path: string, replace = false) => {
    const url = path ? `#${path}` : window.location.pathname;
    if (replace) { history.replaceState(null, '', url); setRoute(read()); }
    else if (path) window.location.hash = path;
    else { history.pushState(null, '', url); setRoute([]); }
  };
  return [route, go];
}

export function Stepper({ value, onChange, min = 1, max = 20, label, big = false, placeholder }: {
  value: number | null | undefined; onChange: (v: number) => void; min?: number; max?: number; label: string; big?: boolean; placeholder?: number;
}) {
  const shown = value ?? placeholder ?? min;
  return (
    <div className={`golf-stepper${big ? ' is-big' : ''}`} role="group" aria-label={label}>
      <button type="button" aria-label={`${label}: one less`} disabled={value !== null && value !== undefined && value <= min} onClick={() => onChange(Math.max(min, (value ?? shown) - 1))}>−</button>
      <button type="button" className={`golf-stepper-value${value === null || value === undefined ? ' is-empty' : ''}`} aria-label={`${label}: ${value ?? 'not set'}. Tap to set ${shown}`} onClick={() => onChange(shown)}>
        {value ?? '–'}
      </button>
      <button type="button" aria-label={`${label}: one more`} disabled={value !== null && value !== undefined && value >= max} onClick={() => onChange(Math.min(max, value === null || value === undefined ? shown + 1 : value + 1))}>+</button>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="golf-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** A panel that slides up from the bottom; closes on the backdrop or Escape. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="golf-sheet-backdrop" onClick={onClose}>
      <div className="golf-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="golf-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="golf-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

export const sportIcon = (sport: 'golf' | 'disc') => (sport === 'golf' ? '⛳' : '🥏');
export const sportName = (sport: 'golf' | 'disc') => (sport === 'golf' ? 'Golf' : 'Disc golf');

export const toParClass = (n: number) => (n < 0 ? 'is-under' : n > 0 ? 'is-over' : 'is-even');
