'use client';

import Link from 'next/link';
import QuickNotesList, { QuickNoteInput } from '@/components/quick-notes/QuickNotesList';
import { useQuickNotes } from '@/components/quick-notes/useQuickNotes';
import { doneNotes, openNotes } from '@/lib/quick-notes/quick-notes';

/** Every quick note on the account: jot, check off, edit, clear. Not the Notes app's notebooks. */
export default function QuickNotesPage() {
  const notes = useQuickNotes();
  const open = openNotes(notes.data).length;
  const done = doneNotes(notes.data).length;

  return (
    <div className="qn-page animate-fade-in">
      <header className="qn-page-head">
        <div>
          <h1><span aria-hidden>🗒️</span> Quick notes</h1>
          <p>
            <span className="qn-on-desktop">Jot things down from any page: press <kbd>/</kbd> and type <kbd>/note</kbd> and the note, or <kbd>Alt</kbd>+<kbd>N</kbd>.</span>
            <span className="qn-on-phone">Jot things down from any page: tap 🔍, then Quick note.</span>
            {' '}They wait here until you check them off.
          </p>
        </div>
        {notes.status === 'ready' && (open > 0 || done > 0) && (
          <span className="qn-chip">{open} open{done ? ` · ${done} checked off` : ''}</span>
        )}
      </header>

      {notes.status === 'signed-out' ? (
        <section className="qn-card">
          <p className="qn-empty">Quick notes are kept on your account. Sign in to jot things down from any page.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button>
        </section>
      ) : (
        <section className="qn-card">
          <QuickNoteInput notes={notes} />
          <QuickNotesList notes={notes} editable empty="Nothing open. Anything you jot down shows up here, newest first." />
        </section>
      )}

      <p className="qn-page-foot">Handwritten notebooks live in <Link href="/notes">Notes</Link>.</p>
    </div>
  );
}
