'use client';

import { useEffect, useState } from 'react';
import { makeNotesPage, type NotesPage } from './notes-links';

function withFrom(href: string, from: string) {
  if (!from || href.includes('from=')) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}from=${encodeURIComponent(from)}`;
}

/**
 * A question's working in Notes. The button makes the page and stays here, so the question can
 * be open on a computer while the working is done on an iPad; the page then shows as a link.
 * In standalone PWA mode links stay in the same window with ?from= so "← Back" returns cleanly.
 */
export default function WorkInNotes({ question, date, pages, signedIn, className = 'dq-notes' }: {
  question: string;
  date: string;
  pages: NotesPage[];
  signedIn: boolean;
  className?: string;
}) {
  const [made, setMade] = useState<NotesPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [from, setFrom] = useState('');
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setFrom(`${window.location.pathname}${window.location.search}`);
    const nav = navigator as { standalone?: boolean };
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || Boolean(nav.standalone));
  }, []);

  const shown = made && !pages.some((page) => page.href === made.href) ? [...pages, made] : pages;

  const make = async () => {
    setBusy(true);
    setProblem('');
    try {
      setMade(await makeNotesPage(question, date, from || undefined));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The page couldn’t be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      {!signedIn ? (
        <button type="button" className="dq-notes-start" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>✏️ Sign in to work it out in Notes</button>
      ) : shown.length > 0 ? (
        <div className="dq-notes-pages">
          <span>{made ? 'Ready in Notes' : 'Your working'}</span>
          {shown.map((page) => {
            const href = withFrom(page.href, from);
            return (
              <a key={page.href} href={href} target={standalone ? undefined : '_blank'} rel={standalone ? undefined : 'noopener'}>
                ✏️ {page.label} {standalone ? '→' : '↗'}
              </a>
            );
          })}
        </div>
      ) : (
        <button type="button" className="dq-notes-start" disabled={busy} onClick={make}>{busy ? 'Making the page…' : '✏️ Work it out in Notes'}</button>
      )}
      {problem && <span className="dq-notes-problem" role="alert">{problem}</span>}
    </div>
  );
}
