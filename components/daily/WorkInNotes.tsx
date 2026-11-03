'use client';

import { useState } from 'react';
import { makeNotesPage, type NotesPage } from './notes-links';

/**
 * A question's working in Notes. The button makes the page and stays here, so the question can
 * be open on a computer while the working is done on an iPad; the page then shows as a link,
 * which opens Notes in a tab of its own.
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
  const shown = made && !pages.some((page) => page.href === made.href) ? [...pages, made] : pages;

  const make = async () => {
    setBusy(true);
    setProblem('');
    try {
      setMade(await makeNotesPage(question, date));
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
          {shown.map((page) => <a key={page.href} href={page.href} target="_blank" rel="noopener">✏️ {page.label} ↗</a>)}
        </div>
      ) : (
        <button type="button" className="dq-notes-start" disabled={busy} onClick={make}>{busy ? 'Making the page…' : '✏️ Work it out in Notes'}</button>
      )}
      {problem && <span className="dq-notes-problem" role="alert">{problem}</span>}
    </div>
  );
}
