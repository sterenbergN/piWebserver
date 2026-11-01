'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { markedPages, notesByChapter, roundStroke, type Anchor, type ReaderItem, type Stroke } from '@/lib/reader/items';
import { drawPixels, inkColor, sizeCanvas, strokePath } from './ink';
import type { ReaderTheme } from './source';

// Every typed and handwritten note in a book, in reading order, each one a tap away
// from its page. The top of the list is for writing a new one on the page you're on.

const CARD_ASPECT = 0.62;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function SketchView({ item }: { item: ReaderItem }) {
  const aspect = item.aspect ?? CARD_ASPECT;
  return (
    <svg className="rd-sketch" viewBox={`0 0 1 ${aspect}`} role="img" aria-label="Handwritten note">
      {(item.strokes ?? []).map((stroke, i) => (
        <path key={i} d={strokePath(stroke)} fill="none" stroke={stroke.color === 'ink' ? 'currentColor' : `var(--rd-ink-${stroke.color})`} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** A blank card to write on, with a finger or a pencil. */
function SketchPad({ theme, onSave, onCancel }: { theme: ReaderTheme; onSave: (strokes: Stroke[], aspect: number) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const [count, setCount] = useState(0);

  const repaint = (live?: number[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = canvas.clientWidth;
    ctx.clearRect(0, 0, width, canvas.clientHeight);
    const color = inkColor('ink', theme);
    for (const stroke of strokes.current) {
      const pixels = stroke.pts.map((value, i) => (i % 3 === 2 ? value : value * width));
      drawPixels(ctx, 'pen', color, stroke.width * width, pixels);
    }
    if (live) drawPixels(ctx, 'pen', color, 2.2, live);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const width = canvas.parentElement?.clientWidth ?? 300;
      sizeCanvas(canvas, width, Math.round(width * CARD_ASPECT));
      repaint();
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    // iPhones scroll the sheet under a writing finger unless they're told not to.
    const stop = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchmove', stop, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener('touchmove', stop);
    };
  }, []);

  const live = useRef<number[] | null>(null);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top, e.pointerType === 'pen' ? e.pressure : 0.5];
  };

  return (
    <div className="rd-pad">
      <div className="rd-pad-card">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); live.current = point(e); repaint(live.current); }}
          onPointerMove={(e) => { if (live.current) { live.current.push(...point(e)); repaint(live.current); } }}
          onPointerUp={(e) => {
            if (!live.current) return;
            const width = e.currentTarget.clientWidth;
            const pts = roundStroke(live.current.map((value, i) => (i % 3 === 2 ? value : value / width)));
            strokes.current.push({ tool: 'pen', color: 'ink', width: 2.2 / width, pts });
            live.current = null;
            setCount(strokes.current.length);
            repaint();
          }}
          onPointerCancel={() => { live.current = null; repaint(); }}
        />
      </div>
      <div className="rd-row">
        <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="rd-btn" disabled={!count} onClick={() => { strokes.current.pop(); setCount(strokes.current.length); repaint(); }}><Icon name="undo" /> Undo</button>
        <span className="rd-grow" />
        <button type="button" className="rd-btn is-primary" disabled={!count} onClick={() => onSave(strokes.current, CARD_ASPECT)}>Save</button>
      </div>
    </div>
  );
}

function NoteCard({ item, onJump, onEdit, onDelete }: {
  item: ReaderItem;
  onJump: (anchor: Anchor) => void;
  onEdit: (item: ReaderItem, text: string) => void;
  onDelete: (item: ReaderItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text ?? '');
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="rd-note">
      <div className="rd-note-head">
        <button type="button" className="rd-note-page" onClick={() => onJump(item.anchor)}>p. {item.anchor.page}</button>
        <span className="rd-note-date">{fmtDate(item.createdAt)}</span>
        <span className="rd-grow" />
        {item.kind === 'note' && !editing && <button type="button" className="rd-icon-btn" aria-label="Edit note" onClick={() => { setText(item.text ?? ''); setEditing(true); }}><Icon name="pencil" /></button>}
        {confirming
          ? <button type="button" className="rd-btn is-danger is-small" onClick={() => onDelete(item)}>Delete</button>
          : <button type="button" className="rd-icon-btn" aria-label="Delete note" onClick={() => setConfirming(true)}><Icon name="trash" /></button>}
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onEdit(item, text.trim()); setEditing(false); } }}>
          <textarea className="rd-input" rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
          <div className="rd-row">
            <button type="button" className="rd-btn" onClick={() => setEditing(false)}>Cancel</button>
            <span className="rd-grow" />
            <button type="submit" className="rd-btn is-primary" disabled={!text.trim()}>Save</button>
          </div>
        </form>
      ) : item.kind === 'sketch' ? (
        <button type="button" className="rd-note-jump" onClick={() => onJump(item.anchor)} aria-label={`Go to page ${item.anchor.page}`}><SketchView item={item} /></button>
      ) : (
        <p className="rd-note-text">{item.text}</p>
      )}
    </li>
  );
}

export type NotesPanelProps = {
  items: ReaderItem[];
  theme: ReaderTheme;
  /** The page you're on. Without one (from the shelf) this is only for reading the notes. */
  here?: Anchor;
  isOnPage?: (anchor: Anchor) => boolean;
  startOnPage?: boolean;
  onJump: (anchor: Anchor) => void;
  onAddNote?: (text: string) => void;
  onAddSketch?: (strokes: Stroke[], aspect: number) => void;
  onEdit: (item: ReaderItem, text: string) => void;
  onDelete: (item: ReaderItem) => void;
};

export default function NotesPanel({ items, theme, here, isOnPage, startOnPage, onJump, onAddNote, onAddSketch, onEdit, onDelete }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const [onlyHere, setOnlyHere] = useState(!!startOnPage);

  const shown = useMemo(() => (onlyHere && isOnPage ? items.filter((item) => isOnPage(item.anchor)) : items), [items, onlyHere, isOnPage]);
  const groups = useMemo(() => notesByChapter(shown), [shown]);
  const marks = useMemo(() => markedPages(items), [items]);
  const total = useMemo(() => notesByChapter(items).reduce((n, g) => n + g.notes.length, 0), [items]);

  return (
    <div className="rd-notes">
      {here && (
        writing ? (
          <SketchPad theme={theme} onCancel={() => setWriting(false)} onSave={(strokes, aspect) => { onAddSketch?.(strokes, aspect); setWriting(false); }} />
        ) : (
          <form className="rd-compose" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onAddNote?.(draft.trim()); setDraft(''); } }}>
            <label htmlFor="rd-new-note" className="rd-label">A note on page {here.page}</label>
            <textarea id="rd-new-note" className="rd-input" rows={3} placeholder="Type a note" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="rd-row">
              <button type="button" className="rd-btn" onClick={() => setWriting(true)}><Icon name="pencil" /> Write by hand</button>
              <span className="rd-grow" />
              <button type="submit" className="rd-btn is-primary" disabled={!draft.trim()}>Save note</button>
            </div>
          </form>
        )
      )}

      {isOnPage && total > 0 && (
        <div className="rd-tabs" role="group" aria-label="Which notes">
          <button type="button" className={!onlyHere ? 'is-on' : ''} aria-pressed={!onlyHere} onClick={() => setOnlyHere(false)}>All {total}</button>
          <button type="button" className={onlyHere ? 'is-on' : ''} aria-pressed={onlyHere} onClick={() => setOnlyHere(true)}>This page</button>
        </div>
      )}

      {!groups.length && <p className="rd-empty">{onlyHere ? 'No notes on this page yet.' : 'No notes yet. They’ll collect here, in the order of the book.'}</p>}

      {groups.map((group, i) => (
        <section key={`${group.chapter}-${i}`} className="rd-note-group">
          {group.chapter && <h3>{group.chapter}</h3>}
          <ul>
            {group.notes.map((item) => <NoteCard key={item.id} item={item} onJump={onJump} onEdit={onEdit} onDelete={onDelete} />)}
          </ul>
        </section>
      ))}

      {!onlyHere && marks.length > 0 && (
        <section className="rd-note-group">
          <h3>Pages you’ve marked</h3>
          <div className="rd-chips">
            {marks.map((anchor) => <button type="button" key={anchor.page} className="rd-chip" onClick={() => onJump(anchor)}>p. {anchor.page}</button>)}
          </div>
        </section>
      )}
    </div>
  );
}
