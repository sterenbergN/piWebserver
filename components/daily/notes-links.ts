'use client';

import { useEffect, useState } from 'react';

// Working a question out in Notes: where to start a page for it, and the pages already tied to it.

export type NotesLinks = { start: string; pages: { href: string; label: string }[] };
type TiedPage = { question: string; notebook: string; notebookTitle: string; page: string; pageNumber: number };

/** The Notes pages tied to these questions, for an account. Nothing for a device without one. */
export function useTiedPages(ids: string[], signedIn: boolean) {
  const [tied, setTied] = useState<TiedPage[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    if (!signedIn || !key) { setTied([]); return; }
    let live = true;
    void fetch(`/api/notes/tied?questions=${encodeURIComponent(key)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (live && body?.success) setTied(body.pages); })
      .catch(() => {});
    return () => { live = false; };
  }, [signedIn, key]);
  return tied;
}

/** Opens Notes on this question's page, making one if there isn't one yet. */
export const startInNotes = (q: { id: string; title: string }, date: string) =>
  `/notes?work=${encodeURIComponent(q.id)}&date=${date}&title=${encodeURIComponent(q.title)}`;

export function notesLinks(q: { id: string; title: string }, date: string, tied: TiedPage[]): NotesLinks {
  return {
    start: startInNotes(q, date),
    pages: tied.filter((t) => t.question === q.id).map((t) => ({
      href: `/notes?notebook=${encodeURIComponent(t.notebook)}&page=${encodeURIComponent(t.page)}`,
      label: `${t.notebookTitle}, page ${t.pageNumber}`,
    })),
  };
}
