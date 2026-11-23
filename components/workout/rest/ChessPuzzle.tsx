'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkedKing, playerColor, retry, showAnswer, solutionSan, solvedCleanly, startPuzzle, targetsFrom, tryMove, withPromotion,
  type Puzzle, type PuzzleState,
} from '@/lib/chess/puzzle';
import { emptyChessProgress, normalizeChessProgress, recordResult } from '@/lib/chess/rating';
import ChessBoard from './ChessBoard';
import { formatSeconds, readJsonPref, saveJsonPref, setInProgress, type ActivityProps } from './shared';

// A short Lichess puzzle (mate in one or two, or a quick tactic) near your
// puzzle rating. Signed in, the rating and solved list are kept on your
// account; signed out, on this device. A half-done puzzle waits for the next
// rest, even across a reload.

type Result = { clean: boolean; rating: number; change: number; solvedCount?: number };
type Saved = { state: PuzzleState; spent: number; result: Result | null; signedIn: boolean; userRating?: number; solvedCount?: number };

const SAVED_PREF = 'workout:restChess';
const LOCAL_PREF = 'workout:restChessLocal';

let kept: Saved | null = null;
function keep(saved: Saved | null) {
  kept = saved;
  // Only the parts needed to carry on (the reply preview is momentary).
  saveJsonPref(SAVED_PREF, saved ? { ...saved, state: { ...saved.state, beforeReply: undefined } } : null);
}
function restore(): Saved | null {
  if (kept) return kept;
  const saved = readJsonPref<Saved>(SAVED_PREF);
  return saved?.state?.puzzle?.fen && Array.isArray(saved.state.puzzle.moves) ? saved : null;
}

const readLocal = () => normalizeChessProgress(readJsonPref(LOCAL_PREF) ?? emptyChessProgress());

async function fetchPuzzle(skip: string | undefined) {
  const local = readLocal();
  const params = new URLSearchParams({ rating: String(local.rating), solved: local.solved.slice(-150).join(',') });
  params.set('skip', [...local.recent, ...(skip ? [skip] : [])].slice(-40).join(','));
  const res = await fetch(`/api/workout/chess?${params}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Couldn’t get a puzzle. Try again.');
  return {
    puzzle: body.puzzle as Puzzle,
    signedIn: Boolean(body.signedIn),
    rating: typeof body.rating === 'number' ? body.rating : local.rating,
    solvedCount: typeof body.solvedCount === 'number' ? body.solvedCount : local.solved.length,
  };
}

async function saveResult(saved: Saved, clean: boolean): Promise<Result> {
  const { puzzle } = saved.state;
  if (saved.signedIn) {
    const res = await fetch('/api/workout/chess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzleId: puzzle.id, clean }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) {
      return {
        clean,
        rating: body.rating,
        change: body.change,
        solvedCount: typeof body.solvedCount === 'number' ? body.solvedCount : undefined,
      };
    }
    // Signed out since (or offline): keep it on this device instead.
  }
  const before = readLocal();
  const after = recordResult(before, puzzle, clean);
  saveJsonPref(LOCAL_PREF, after);
  return { clean, rating: after.rating, change: after.rating - before.rating, solvedCount: after.solved.length };
}

export default function ChessPuzzle({ canStartNew }: ActivityProps) {
  const [saved, setSaved] = useState<Saved | null>(restore);
  const [selected, setSelected] = useState<string | null>(null);
  /** The player's move on show for a moment before the reply. */
  const [preview, setPreview] = useState<PuzzleState['beforeReply'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const savedRef = useRef(saved);

  const update = useCallback((next: Saved | null) => {
    savedRef.current = next;
    keep(next);
    setSaved(next);
  }, []);

  useEffect(() => {
    setInProgress('chess', !!saved && saved.state.status !== 'solved');
  }, [saved]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const { puzzle, signedIn, rating, solvedCount } = await fetchPuzzle(savedRef.current?.state.puzzle.id);
      update({ state: startPuzzle(puzzle), spent: 0, result: null, signedIn, userRating: rating, solvedCount });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t get a puzzle. Try again.');
    } finally {
      setLoading(false);
    }
  }, [update]);

  // First time here with time to spare: get one straight away (it never takes focus).
  useEffect(() => {
    if (!savedRef.current && canStartNew) void load();
  }, []);

  // The solving clock runs only while this is on screen.
  const solving = !!saved && saved.state.status !== 'solved';
  useEffect(() => {
    if (!solving) return;
    const handle = setInterval(() => {
      const current = savedRef.current;
      if (current && current.state.status !== 'solved') update({ ...current, spent: current.spent + 1 });
    }, 1000);
    return () => clearInterval(handle);
  }, [solving, update]);

  useEffect(() => {
    if (!preview) return;
    const handle = setTimeout(() => setPreview(null), 450);
    return () => clearTimeout(handle);
  }, [preview]);

  const finish = useCallback(async (state: PuzzleState) => {
    const current = savedRef.current;
    if (!current) return;
    const done = { ...current, state };
    update(done);
    const result = await saveResult(done, solvedCleanly(state));
    if (savedRef.current?.state.puzzle.id === state.puzzle.id) {
      update({
        ...savedRef.current,
        result,
        userRating: result.rating,
        solvedCount: result.solvedCount ?? savedRef.current.solvedCount,
      });
    }
  }, [update]);

  const play = (next: PuzzleState) => {
    if (next.beforeReply) setPreview(next.beforeReply);
    if (next.status === 'solved') void finish(next);
    else update({ ...savedRef.current!, state: next });
  };

  const onSquare = (square: string) => {
    if (!saved || preview) return;
    const { state } = saved;
    if (state.status !== 'playing') return;
    if (selected && selected !== square && targetsFrom(state, selected).includes(square)) {
      setSelected(null);
      play(tryMove(state, withPromotion(state, selected, square)));
      return;
    }
    // Pick up a piece of yours (tapping it again puts it down).
    setSelected(square !== selected && targetsFrom(state, square).length ? square : null);
  };

  if (!saved) {
    return (
      <div className="rest-chess">
        {loading ? <p className="rest-note">Finding a puzzle…</p>
          : error ? <p className="rest-note">{error} <button type="button" className="rest-link" onClick={load}>Try again</button></p>
          : canStartNew ? <button type="button" className="rest-btn is-primary" onClick={load}>Show me a puzzle</button>
          : <p className="rest-note">Not long enough for a puzzle, just breathe.</p>}
        <Credit />
      </div>
    );
  }

  const { state, result, spent } = saved;
  const color = playerColor(state.puzzle);
  const shownFen = preview?.fen ?? state.fen;
  const mate = state.puzzle.themes.includes('mateIn1') ? 'Mate in 1' : state.puzzle.themes.includes('mateIn2') ? 'Mate in 2' : 'Find the best move';

  return (
    <div className="rest-chess">
      <p className="rest-chess-head">
        <span><span className={`rest-turn is-${color}`} aria-hidden /> {color === 'w' ? 'White' : 'Black'} to play · {mate}</span>
        <span className="rest-muted">Elo {saved.userRating ?? readLocal().rating} · Puzzle {state.puzzle.rating}</span>
      </p>
      <ChessBoard
        fen={shownFen}
        orientation={color}
        lastMove={preview?.lastMove ?? state.lastMove}
        selected={selected}
        targets={selected && !preview ? targetsFrom(state, selected) : []}
        check={checkedKing(shownFen)}
        disabled={state.status !== 'playing' || !!preview}
        onSquare={onSquare}
      />
      <div className="rest-chess-status" aria-live="polite">
        {state.status === 'playing' && (
          <p className="rest-note">
            {selected ? 'Tap where it goes.' : 'Your move: tap a piece.'}{' '}
            <button type="button" className="rest-link" onClick={() => void finish(showAnswer(state))}>Show answer</button>
          </p>
        )}
        {state.status === 'wrong' && (
          <p className="rest-note is-wrong">
            Not quite.{' '}
            <button type="button" className="rest-btn" onClick={() => update({ ...saved, state: retry(state) })}>Try again</button>{' '}
            <button type="button" className="rest-link" onClick={() => void finish(showAnswer(retry(state)))}>Show answer</button>
          </p>
        )}
        {state.status === 'solved' && (
          <>
            <p className="rest-result">
              {state.revealed ? <>The answer: <strong>{solutionSan(state.puzzle)}</strong></>
                : <><strong className="rest-right">✓ Solved</strong> in {formatSeconds(spent)}{state.mistakes ? ' (after a miss)' : ''}</>}
              {result && <span className="rest-muted"> · Rating {result.rating} ({result.change >= 0 ? '+' : '−'}{Math.abs(result.change)})</span>}
            </p>
            {canStartNew
              ? <button type="button" className="rest-btn" disabled={loading} onClick={load}>{loading ? 'Finding one…' : 'Next puzzle'}</button>
              : <p className="rest-note">That’s the rest. Go!</p>}
            {error && <p className="rest-note">{error}</p>}
          </>
        )}
      </div>
      <Credit />
    </div>
  );
}

function Credit() {
  return <p className="rest-credit">Puzzles from <a href="https://lichess.org" target="_blank" rel="noopener noreferrer">lichess.org</a></p>;
}
