'use client';

import { useCallback, useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import type { CardRating } from '@/lib/skills/types';
import type { AskCard } from '@/components/skills/api';

// A recall card: front, reveal, then four honest ratings. Keyboard: Space/Enter
// reveals, 1–4 rate. Shortcuts stay quiet while you type in the report note.

const RATINGS: { rating: CardRating; label: string; meaning: string }[] = [
  { rating: 'again', label: 'Again', meaning: 'Didn’t know it — see it tomorrow' },
  { rating: 'hard', label: 'Hard', meaning: 'Got it with effort' },
  { rating: 'good', label: 'Good', meaning: 'Knew it' },
  { rating: 'easy', label: 'Easy', meaning: 'Knew it cold — space it out' },
];

export default function RecallCard({ entry, badge, onRate, onReport }: {
  entry: AskCard;
  badge: string;
  onRate: (rating: CardRating) => Promise<void>;
  onReport: (note: string) => Promise<void>;
}) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || busy || reporting) return;
      if (!shown) {
        if (e.key === ' ' || e.key === 'Enter') {
          // A focused button would also click itself; take over so it only reveals once.
          e.preventDefault();
          setShown(true);
        }
        return;
      }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < 4) { e.preventDefault(); void run(() => onRate(RATINGS[i].rating)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, busy, reporting, onRate, run]);

  return (
    <article className="sk-recall">
      <header className="sk-recall-head">
        <span className="sk-badge">{entry.subjectIcon} {entry.subjectName}</span>
        <span className="sk-badge">{entry.topicName}</span>
        <span className="sk-recall-kind">{badge}</span>
      </header>

      <div className="sk-recall-face">
        <p className="sk-recall-label">Question</p>
        <MathText>{entry.front}</MathText>
      </div>

      {!shown ? (
        <button type="button" className="btn btn-primary sk-recall-show" onClick={() => setShown(true)}>Show answer</button>
      ) : (
        <>
          <div className="sk-recall-face is-back">
            <p className="sk-recall-label">Answer</p>
            <MathText>{entry.back}</MathText>
          </div>
          <p className="sk-hint sk-recall-ask">How well did you know it?</p>
          <div className="sk-rate" role="group" aria-label="Rate your recall">
            {RATINGS.map((r, i) => (
              <button key={r.rating} type="button" className={`sk-rate-btn is-${r.rating}`} disabled={busy} onClick={() => run(() => onRate(r.rating))}>
                <strong>{r.label} <kbd>{i + 1}</kbd></strong>
                <span>{r.meaning}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="sk-error" role="alert">{error}</p>}

      <footer className="sk-recall-foot">
        {!reporting ? (
          <button type="button" className="sk-text-btn" onClick={() => setReporting(true)}>⚑ This card is wrong</button>
        ) : (
          <form className="sk-report" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void run(() => onReport(note.trim())); }}>
            <label className="sk-field">
              <span>What’s wrong with it?</span>
              <textarea rows={3} value={note} maxLength={500} autoFocus placeholder="A short note, like “the back should say 5 bar, not 50”" onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="sk-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !note.trim()}>Report and skip</button>
              <button type="button" className="sk-text-btn" onClick={() => { setReporting(false); setNote(''); }}>Cancel</button>
            </div>
            <p className="sk-hint">The card is retired, so it stops being asked and stops counting toward your level.</p>
          </form>
        )}
      </footer>
    </article>
  );
}
