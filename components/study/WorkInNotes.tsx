'use client';

import { useEffect, useState } from 'react';
import { localToday } from '@/lib/habits/dates';

type TiedPage = { question: string; notebook: string; notebookTitle: string; page: string; pageNumber: number };

/**
 * Study's "Work it out in Notes" link. Checks if Notes already has a page tied to
 * this question, and otherwise opens `/notes?work=...&date=...&title=...&from=...`
 * so Notes creates/opens a scratch page and offers a ← Back link.
 */
export default function WorkInNotes({
  questionId,
  title,
  from,
  signedIn = true,
  onBeforeOpen,
  className = 'sd-notes-link',
}: {
  questionId: string;
  title: string;
  from: string;
  signedIn?: boolean;
  onBeforeOpen?: () => void;
  className?: string;
}) {
  const [tied, setTied] = useState<TiedPage | null>(null);

  useEffect(() => {
    if (!signedIn || !questionId) { setTied(null); return; }
    let cancelled = false;
    fetch(`/api/notes/tied?questions=${encodeURIComponent(questionId)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { success?: boolean; pages?: TiedPage[] } | null) => {
        if (!cancelled && body?.success) setTied(body.pages?.[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [signedIn, questionId]);

  if (!signedIn) return null;

  const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Study question';
  const href = tied
    ? `/notes?notebook=${encodeURIComponent(tied.notebook)}&page=${encodeURIComponent(tied.page)}&from=${encodeURIComponent(from)}`
    : `/notes?work=${encodeURIComponent(questionId)}&date=${encodeURIComponent(localToday())}&title=${encodeURIComponent(cleanTitle)}&from=${encodeURIComponent(from)}`;

  return (
    <a className={`hb-text-btn sd-with-icon sd-self-start ${className}`} href={href} onClick={onBeforeOpen}>
      ✏️ {tied ? `Open in Notes (${tied.notebookTitle}, p.${tied.pageNumber})` : 'Work it out in Notes'}
    </a>
  );
}
