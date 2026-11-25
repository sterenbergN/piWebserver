'use client';

import { useEffect, useId, useRef, useState } from 'react';

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/**
 * A button that opens a small menu under it (the list picker, "+ New list", "More").
 * Closes on a click outside, Escape or picking something; arrow keys move between items.
 * Starts closed, so the server and the first render agree.
 */
export default function Menu({ button, buttonClass, buttonLabel, heading, label, align = 'left', panelClass, children }: {
  /** What the button shows. */
  button: React.ReactNode;
  buttonClass: string;
  /** The button's name for screen readers, when what it shows isn't enough. */
  buttonLabel?: string;
  /** Wrap the button (not the menu) in an <h2>, for a picker that doubles as the heading. */
  heading?: boolean;
  /** The menu's name for screen readers. */
  label: string;
  align?: 'left' | 'right';
  panelClass?: string;
  /** The items (role="menuitem" or "menuitemradio"); clicking one closes the menu. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // Start on the checked item (the list you're on), else the first.
    const start = panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>(ITEMS);
    start?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Picking an item closes the menu and puts focus back on its button. This runs after the
  // item's own click, so a sheet the item opens still takes focus when it renders.
  const onPanelClick = (e: React.MouseEvent) => {
    const item = (e.target as Element).closest('[role="menuitem"], [role="menuitemradio"]');
    if (!item || (item as HTMLButtonElement).disabled) return;
    setOpen(false);
    btn.current?.focus();
  };

  const trigger = (
    <button ref={btn} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={buttonLabel} onClick={() => setOpen((o) => !o)}>
      {button}
    </button>
  );

  return (
    <div className="wl-menu" ref={wrap}>
      {heading ? <h2 className="wl-menu-heading">{trigger}</h2> : trigger}
      {open && (
        <div id={id} ref={panel} role="menu" aria-label={label} className={`wl-menu-panel${align === 'right' ? ' is-right' : ''}${panelClass ? ` ${panelClass}` : ''}`}
          onClick={onPanelClick}
          onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}
