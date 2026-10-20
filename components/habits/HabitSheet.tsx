'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Bottom sheet on phones, a centred card on wider screens. */
export default function HabitSheet({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // Once per opening: lock page scroll and let Escape close the sheet.
  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div className="hb-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hb-sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="hb-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="hb-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="hb-sheet-body">{children}</div>
        {footer && <div className="hb-sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
