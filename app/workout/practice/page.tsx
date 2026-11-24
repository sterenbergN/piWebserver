'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PageHeader from '@/components/workout/PageHeader';
import ChessPuzzle from '@/components/workout/rest/ChessPuzzle';
import QuickMath, { MathStatsPanel } from '@/components/workout/rest/QuickMath';
import { readJsonPref } from '@/components/workout/rest/shared';
import { emptyChessProgress, normalizeChessProgress } from '@/lib/chess/rating';
import { readPref } from '@/lib/workout/device-prefs';
import { emptyMathStats, normalizeMathStats, type MathStats } from '@/lib/workout/rest-math-stats';
import '@/components/workout/rest/rest.css';

type PracticeTab = 'chess' | 'math';

type ChessSummary = {
  rating: number;
  games: number;
  solvedCount: number;
  poolSize: number;
  bundledCount: number;
  extraCount: number;
  minRating: number;
  maxRating: number;
  refilling: boolean;
  isAdmin: boolean;
  /** How far below the Elo puzzles are aimed (tuned to the person), and the last move. */
  aimOffset?: number;
  aimChange?: { at: string; from: number; to: number; cleanRate: number } | null;
};

const CHESS_LOCAL_PREF = 'workout:restChessLocal';
const MATH_STATS_PREF = 'workout:restMathStats';
const MATH_BEST_PREF = 'workout:restMathBest';

function readLocalChessSummary(): ChessSummary {
  const local = normalizeChessProgress(readJsonPref(CHESS_LOCAL_PREF) ?? emptyChessProgress());
  return {
    rating: local.rating,
    games: local.games,
    solvedCount: local.solved.length,
    poolSize: 2000,
    bundledCount: 2000,
    extraCount: 0,
    minRating: 600,
    maxRating: 2400,
    refilling: false,
    isAdmin: false,
  };
}

function readLocalMathStats(): MathStats {
  const raw = readJsonPref<unknown>(MATH_STATS_PREF);
  if (raw !== null) return normalizeMathStats(raw);
  const legacyBest = Math.max(0, Number(readPref(MATH_BEST_PREF)) || 0);
  const empty = emptyMathStats();
  return legacyBest > 0 ? { ...empty, best: legacyBest } : empty;
}

export default function WorkoutPracticePage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Loading rest games…</div>}>
      <WorkoutPracticeContent />
    </Suspense>
  );
}

function WorkoutPracticeContent() {
  const searchParams = useSearchParams();
  const initialTab: PracticeTab = searchParams.get('tab') === 'math' ? 'math' : 'chess';
  const [tab, setTab] = useState<PracticeTab>(initialTab);
  const [chess, setChess] = useState<ChessSummary | null>(null);
  const [math, setMath] = useState<MathStats | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const loadStats = useCallback(async () => {
    const localChess = readLocalChessSummary();
    const localMath = readLocalMathStats();
    try {
      const [chessRes, mathRes] = await Promise.all([
        fetch('/api/workout/chess?stats=1', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/workout/math', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      const isSignedIn = Boolean(chessRes?.signedIn || mathRes?.signedIn);
      setSignedIn(isSignedIn);

      if (chessRes?.success) {
        const poolPatch = {
          poolSize: typeof chessRes.poolSize === 'number' ? chessRes.poolSize : localChess.poolSize,
          bundledCount: typeof chessRes.bundledCount === 'number' ? chessRes.bundledCount : localChess.bundledCount,
          extraCount: typeof chessRes.extraCount === 'number' ? chessRes.extraCount : 0,
          minRating: typeof chessRes.minRating === 'number' ? chessRes.minRating : localChess.minRating,
          maxRating: typeof chessRes.maxRating === 'number' ? chessRes.maxRating : localChess.maxRating,
          refilling: Boolean(chessRes.refilling),
          isAdmin: Boolean(chessRes.isAdmin),
          aimOffset: typeof chessRes.aimOffset === 'number' ? chessRes.aimOffset : undefined,
          aimChange: chessRes.aimChange ?? null,
        };
        setChess(
          isSignedIn
            ? {
                rating: typeof chessRes.rating === 'number' ? chessRes.rating : localChess.rating,
                games: typeof chessRes.games === 'number' ? chessRes.games : 0,
                solvedCount: typeof chessRes.solvedCount === 'number' ? chessRes.solvedCount : 0,
                ...poolPatch,
              }
            : { ...localChess, ...poolPatch },
        );
      } else {
        setChess(localChess);
      }

      if (mathRes?.success && isSignedIn) {
        setMath(normalizeMathStats(mathRes.stats));
      } else {
        setMath(localMath);
      }
    } catch {
      setChess(localChess);
      setMath(localMath);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const chessWinPct = chess && chess.games > 0 ? Math.round((chess.solvedCount / chess.games) * 100) : null;

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <PageHeader
        title="Rest games"
        subtitle="Practice chess puzzles & mental math outside a workout"
        backHref="/workout"
      />

      <div className="workout-tile">
        <div className="workout-segmented" role="group" aria-label="Practice mode">
          <button type="button" aria-pressed={tab === 'chess'} onClick={() => setTab('chess')}>
            ♟️ Chess puzzle
          </button>
          <button type="button" aria-pressed={tab === 'math'} onClick={() => setTab('math')}>
            🔢 Quick math
          </button>
        </div>
        <div className="rest-practice-stage">
          {tab === 'chess' ? (
            <ChessPuzzle canStartNew onSwitch={(to) => { if (to === 'math') setTab('math'); }} onResult={() => void loadStats()} />
          ) : (
            <QuickMath canStartNew onSwitch={(to) => { if (to === 'chess') setTab('chess'); }} onResult={() => void loadStats()} />
          )}
        </div>
      </div>

      <div className="workout-tile">
        <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>♟️ Chess puzzle stats</h2>
          {signedIn === false && <span className="workout-hint">Saved on this device</span>}
        </div>
        {chess ? (
          <>
            <div className="rest-math-pills">
              <div className="rest-math-pill">
                <span>Elo</span>
                <strong>{chess.rating}</strong>
              </div>
              <div className="rest-math-pill">
                <span>Solved</span>
                <strong>{chess.solvedCount}</strong>
              </div>
              <div className="rest-math-pill">
                <span>Attempted</span>
                <strong>{chess.games}</strong>
              </div>
              <div className="rest-math-pill">
                <span>Clean rate</span>
                <strong>{chessWinPct !== null ? `${chessWinPct}%` : '—'}</strong>
              </div>
            </div>
            {chess.aimOffset !== undefined && (
              <p className="workout-hint" style={{ margin: '0.55rem 0 0' }}>
                Puzzles are aimed {chess.aimOffset > 0 ? `${chess.aimOffset} below` : chess.aimOffset < 0 ? `${-chess.aimOffset} above` : 'right at'} your Elo, since it’s between sets
                {chess.aimChange
                  ? `, tuned to you: you solved ${Math.round(chess.aimChange.cleanRate * 100)}% cleanly, so on ${new Date(chess.aimChange.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} they got ${chess.aimChange.to < chess.aimChange.from ? 'harder' : 'easier'}.`
                  : '. It adjusts to keep about two in three solved cleanly.'}
              </p>
            )}
            <p className="workout-hint" style={{ margin: '0.55rem 0 0' }}>
              Puzzles are picked near your Elo from {chess.poolSize.toLocaleString()} Lichess puzzles ({chess.minRating}–{chess.maxRating})
              {chess.extraCount > 0 ? ` · ${chess.extraCount.toLocaleString()} added beyond the bundle` : ''}.
              {chess.refilling ? ' Refilling more in the background…' : ''}
            </p>
            {chess.isAdmin && (
              <a href="/admin#chess" className="workout-text-btn" style={{ display: 'inline-block', marginTop: '0.5rem' }}>
                Puzzle pool and loading more: Admin › Puzzles →
              </a>
            )}
          </>
        ) : (
          <p className="workout-hint" style={{ margin: 0 }}>Loading chess stats…</p>
        )}
      </div>

      <div className="workout-tile">
        <div className="workout-flex-between" style={{ marginBottom: '0.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>🔢 Mental math stats</h2>
          {signedIn === false && <span className="workout-hint">Saved on this device</span>}
        </div>
        {math ? <MathStatsPanel stats={math} onResetLevelRule={signedIn ? () => void fetch('/api/workout/math', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resetLevelRule' }) }).then(() => loadStats()) : undefined} /> : <p className="workout-hint" style={{ margin: 0 }}>Loading math stats…</p>}
      </div>
    </div>
  );
}
