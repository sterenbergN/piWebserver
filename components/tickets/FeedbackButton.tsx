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
  return (
    <>
      <button type="button" className="tk-footer-btn" onClick={() => setOpen(true)}>💬 Feedback</button>
      {open && <TicketSheet onClose={() => setOpen(false)} />}
    </>
  );
}
