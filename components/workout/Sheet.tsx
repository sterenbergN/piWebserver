'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type SheetProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body — usually the primary action. */
  footer?: ReactNode;
};

// Sheets can stack (e.g. a lift form over the equipment form); only the first
// one open should lock page scrolling, the last one closed unlock it, and
// Escape should close just the one on top.
let openSheets = 0;
const sheetStack: object[] = [];

/**
 * Full-height panel for forms on a phone (a centred card on wider screens).
 * Rendered into <body> so it isn't clipped or offset by animated parents.
 */
export default function Sheet({ title, subtitle, onClose, children, footer }: SheetProps) {
  const [mounted, setMounted] = useState(false);
  const [token] = useState(() => ({}));

  useEffect(() => {
    setMounted(true);
    openSheets += 1;
    sheetStack.push(token);
    if (openSheets === 1) document.body.style.overflow = 'hidden';
    return () => {
      openSheets -= 1;
      sheetStack.splice(sheetStack.indexOf(token), 1);
      if (openSheets === 0) document.body.style.overflow = '';
    };
  }, [token]);

  useEffect(() => {
    // Escape closes the top sheet, unless a confirm popup or share viewer on top of it is taking that key.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === token && !document.querySelector('.site-popup-backdrop, .share-viewer')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, token]);

  if (!mounted) return null;

  return createPortal(
    <div className="workout-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="workout-sheet" role="dialog" aria-modal="true">
        <div className="workout-sheet-header">
          <div style={{ minWidth: 0 }}>
            <h3 className="workout-sheet-title">{title}</h3>
            {subtitle && <div className="workout-hint">{subtitle}</div>}
          </div>
          <button type="button" className="workout-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="workout-sheet-body">{children}</div>
        {footer && <div className="workout-sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
