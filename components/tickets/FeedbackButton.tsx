'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { installErrorBuffer } from './error-buffer';
import './tickets.css';

// The footer's "Feedback" button. The layout only renders this for accounts that can
// file tickets; the sheet itself loads the first time it's opened.
const TicketSheet = dynamic(() => import('./TicketSheet'), { ssr: false });

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => installErrorBuffer(), []);
  // Menus on any page (account menu, Reader, Notes) open this sheet with the
  // `site:feedback` event; the marker tells them this account can send feedback.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('site:feedback', show);
    document.documentElement.dataset.feedback = '1';
    return () => { window.removeEventListener('site:feedback', show); delete document.documentElement.dataset.feedback; };
  }, []);
  return (
    <>
      <button type="button" className="tk-footer-btn" onClick={() => setOpen(true)}>💬 Feedback</button>
      {open && <TicketSheet onClose={() => setOpen(false)} />}
    </>
  );
}
