'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type GalleryPopoverProps = {
  label: string;
  icon: string;
  /** "menu" for a list of actions, "dialog" for a panel of settings. */
  kind: 'menu' | 'dialog';
  /** Rendered with a `close` callback so a menu item can shut the popover. */
  children: (close: () => void) => ReactNode;
};

/** A toolbar button that opens a small panel under it; closes on Escape or a click outside. */
export default function GalleryPopover({ label, icon, kind, children }: GalleryPopoverProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="gal-pop" ref={root}>
      <button
        ref={button}
        type="button"
        className="gal-tool-btn"
        aria-label={label}
        title={label}
        aria-haspopup={kind}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{icon}</span>
        <span className="gal-tool-label">{label}</span>
        <span aria-hidden className="gal-caret">▾</span>
      </button>
      {open && (
        <div className="gal-pop-panel animate-fade-in" role={kind} aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
