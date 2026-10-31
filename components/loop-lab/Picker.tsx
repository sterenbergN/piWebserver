'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type PickerItem = { id: string; title: string; hint?: string; mark?: string };
export type PickerGroup = { label: string; items: PickerItem[] };

/**
 * A menu of options that each need a line of explanation, which a native select
 * can't show. Rendered in a portal, because the bench's setup panel scrolls and
 * would clip it. A bottom sheet on a phone (see .ll-pop in loop-lab.css).
 */
export default function Picker({ label, value, groups, onChange }: {
  label: string; value: string; groups: PickerGroup[]; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const items = groups.flatMap((g) => g.items);
  const current = items.find((i) => i.id === value);
  const optionId = (id: string) => `${baseId}-${id}`;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 380), window.innerWidth - 24);
    const below = window.innerHeight - r.bottom - 16;
    setPlace({
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
      top: r.bottom + 6,
      width,
      maxHeight: Math.max(220, below),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const away = () => close(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', away);
    pop.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', away);
    };
  }, [open, close]);

  const choose = (id: string) => {
    close();
    if (id !== value) onChange(id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(value); setOpen(true); }
      return;
    }
    const i = items.findIndex((x) => x.id === active);
    const move = (to: number) => {
      e.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, to))];
      setActive(next.id);
      document.getElementById(optionId(next.id))?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
  };

  return (
    <>
      <button ref={button} type="button" role="combobox" className="ll-picker" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${baseId}-list`} aria-label={`${label}: ${current?.title ?? ''}`}
        aria-activedescendant={open ? optionId(active) : undefined} onKeyDown={onKey}
        onClick={() => { setActive(value); setOpen((o) => !o); }}>
        {current?.mark && <span className="ll-picker-mark" aria-hidden>{current.mark}</span>}
        <span className="ll-picker-title">{current?.title}</span>
        <svg className="ll-picker-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && place && createPortal(
        <>
          <div className="ll-pop-scrim" aria-hidden />
          <div ref={pop} id={`${baseId}-list`} className="ll-pop" role="listbox" aria-label={label}
            style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}>
            {groups.filter((g) => g.items.length).map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <div className="ll-pop-group">{g.label}</div>
                {g.items.map((item) => (
                  <div key={item.id} id={optionId(item.id)} role="option" aria-selected={item.id === value}
                    className={`ll-pop-item${item.id === active ? ' is-active' : ''}`}
                    onPointerEnter={() => setActive(item.id)} onClick={() => choose(item.id)}>
                    {item.mark && <span className="ll-picker-mark" aria-hidden>{item.mark}</span>}
                    <span className="ll-pop-text">
                      <strong>{item.title}</strong>
                      {item.hint && <span>{item.hint}</span>}
                    </span>
                    {item.id === value && <svg className="ll-pop-check" width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 7.5 2.7 2.7L11 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
