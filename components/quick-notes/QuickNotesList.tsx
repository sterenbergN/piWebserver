'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { doneNotes, MAX_NOTE_LENGTH, noteAge, openNotes, type QuickNote } from '@/lib/quick-notes/quick-notes';
import { herePage, type useQuickNotes } from './useQuickNotes';
import './quick-notes.css';

type Notes = ReturnType<typeof useQuickNotes>;

/**
 * Open notes newest first, each a tap to check off or clear; the checked-off
 * ones folded underneath with one button to clear them all. Clearing can be undone.
 */
export default function QuickNotesList({ notes, limit, editable = false, showDone = true, onNavigate, empty }: {
  notes: Notes;
  /** Show at most this many open notes (the rest are counted). */
  limit?: number;
  /** Tap a note's text to change it. */
  editable?: boolean;
  showDone?: boolean;
  /** Following a "written on" link (the launcher closes itself). */
  onNavigate?: () => void;
  empty?: React.ReactNode;
}) {
  const [undo, setUndo] = useState<{ text: string; notes: QuickNote[] } | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const open = openNotes(notes.data);
  const done = doneNotes(notes.data);
  const shown = limit ? open.slice(0, limit) : open;
  const now = new Date();

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  const clear = (list: QuickNote[], text: string) => {
    if (!list.length) return;
    setUndo({ text, notes: list.map((n) => ({ ...n })) });
    void notes.dispatch({ type: 'remove', ids: list.map((n) => n.id) });
  };
  const restore = () => {
    if (!undo) return;
    void notes.dispatch({ type: 'restore', notes: undo.notes });
    setUndo(null);
  };

  const row = (note: QuickNote) => (
    <li key={note.id} className={`qn-row${note.doneAt ? ' is-done' : ''}`}>
      <input type="checkbox" className="qn-check" checked={!!note.doneAt} aria-label={note.doneAt ? `Uncheck “${note.text}”` : `Check off “${note.text}”`}
        onChange={(e) => void notes.dispatch({ type: 'done', ids: [note.id], done: e.target.checked })} />
      <div className="qn-body">
        {editing === note.id ? (
          <EditBox note={note} onDone={(text) => {
            setEditing(null);
            if (text !== null && text.trim() && text.trim() !== note.text) void notes.dispatch({ type: 'edit', id: note.id, text });
          }} />
        ) : editable && !note.doneAt ? (
          <button type="button" className="qn-text is-editable" aria-label={`Edit: ${note.text}`} onClick={() => setEditing(note.id)}>{note.text}</button>
        ) : (
          <p className="qn-text">{note.text}</p>
        )}
        <small className="qn-meta">
          <time dateTime={note.createdAt} title={new Date(note.createdAt).toLocaleString()}>{noteAge(note.createdAt, now)}</time>
          {note.from && (
            <> · <Link href={note.from.path} onClick={onNavigate}>{note.from.title || note.from.path}</Link></>
          )}
        </small>
      </div>
      <button type="button" className="qn-clear" aria-label={`Clear “${note.text}”`} title="Clear" onClick={() => clear([note], 'Cleared a note')}>×</button>
    </li>
  );

  return (
    <div className="qn-list">
      {notes.error && (
        <p className="qn-alert" role="alert">{notes.error} <button type="button" className="qn-link" onClick={notes.clearError}>OK</button></p>
      )}
      {undo && (
        <p className="qn-undo" role="status">{undo.text} <button type="button" className="qn-link" onClick={restore}>Undo</button></p>
      )}
      {notes.status === 'loading' && !open.length && !done.length ? <p className="qn-empty">Loading…</p>
        : notes.status === 'error' && !open.length && !done.length ? (
          <p className="qn-empty">Couldn’t load your notes. <button type="button" className="qn-link" onClick={() => void notes.reload()}>Try again</button></p>
        ) : open.length === 0 ? (
          <div className="qn-empty">{empty ?? (done.length ? 'All checked off.' : 'No notes yet.')}</div>
        ) : (
          <ul className="qn-items" aria-label="Open notes">{shown.map(row)}</ul>
        )}
      {limit && open.length > limit && <p className="qn-more">{open.length - limit} more</p>}
      {showDone && done.length > 0 && (
        <div className="qn-done">
          <div className="qn-done-head">
            <button type="button" className="qn-link" aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)}>
              {doneOpen ? '▾' : '▸'} {done.length} checked off
            </button>
            <button type="button" className="qn-pill" onClick={() => clear(done, `Cleared ${done.length} checked-off note${done.length === 1 ? '' : 's'}`)}>Clear checked off</button>
          </div>
          {doneOpen && <ul className="qn-items" aria-label="Checked off">{done.map(row)}</ul>}
        </div>
      )}
    </div>
  );
}

function EditBox({ note, onDone }: { note: QuickNote; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(note.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  return (
    <textarea ref={ref} className="qn-edit" value={text} rows={Math.min(6, Math.max(1, Math.ceil(text.length / 48)))} maxLength={MAX_NOTE_LENGTH}
      aria-label="Edit note" onChange={(e) => setText(e.target.value)} onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onDone(text); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(null); }
      }} />
  );
}

/** A box to jot a note into: Enter saves (Shift+Enter for a new line). */
export function QuickNoteInput({ notes, placeholder = 'Jot something down…', autoFocus }: { notes: Notes; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const save = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    const ok = await notes.dispatch({ type: 'add', text: value, from: herePage() });
    if (!ok) setText((now) => now || value);
  };
  return (
    <form className="qn-add" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <textarea value={text} rows={1} maxLength={MAX_NOTE_LENGTH} placeholder={placeholder} aria-label="New quick note" autoFocus={autoFocus}
        enterKeyHint="done" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); } }} />
      <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Add</button>
    </form>
  );
}
