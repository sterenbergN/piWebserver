'use client';

import { useEffect, useState } from 'react';

// Working a question out in Notes: the pages already tied to it, and making one.

export type NotesPage = { href: string; label: string };
export type NotesLinks = { date: string; pages: NotesPage[] };
type TiedPage = { question: string; notebook: string; notebookTitle: string; page: string; pageNumber: number };

const toLink = (t: TiedPage): NotesPage => ({
  href: `/notes?notebook=${encodeURIComponent(t.notebook)}&page=${encodeURIComponent(t.page)}`,
  label: `${t.notebookTitle}, page ${t.pageNumber}`,
});

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

export function notesLinks(q: { id: string }, date: string, tied: TiedPage[]): NotesLinks {
  return { date, pages: tied.filter((t) => t.question === q.id).map(toLink) };
}

/**
 * Makes this question's page in Notes, with the question written at the top, on the account:
 * there to open on any device. Answers with the page, or the one already made.
 */
export async function makeNotesPage(question: string, date: string): Promise<NotesPage> {
  const res = await fetch('/api/notes/work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, date }) });
  const body = await res.json().catch(() => null) as { success?: boolean; page?: TiedPage; message?: string } | null;
  if (!res.ok || !body?.success || !body.page) throw new Error(body?.message || 'The page couldn’t be made. Try again.');
  return toLink(body.page);
}
