'use client';

import { useEffect, useState } from 'react';

// "Send feedback" for pages where the footer's button is out of reach (Reader,
// Notes) and for the account menu. It opens the same sheet as the footer button
// (FeedbackButton listens for `site:feedback`), and shows only for accounts that
// can file tickets: the layout renders FeedbackButton only for them, and it marks
// the page with data-feedback when it mounts.

export const openFeedback = () => window.dispatchEvent(new Event('site:feedback'));

export function useCanFeedback(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    // Read after mount: the server can't see the page's marker (see AGENTS.md, hydration).
    setCan(document.documentElement.dataset.feedback === '1');
  }, []);
  return can;
}

export default function FeedbackLink({ className, onOpen, children }: { className?: string; onOpen?: () => void; children?: React.ReactNode }) {
  const can = useCanFeedback();
  if (!can) return null;
  return (
    <button type="button" className={className} onClick={() => { onOpen?.(); openFeedback(); }}>
      {children ?? <><span aria-hidden>💬</span> Send feedback about this page</>}
    </button>
  );
}
