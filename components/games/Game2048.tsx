'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SIZE, createGame, maxTile, move, type Direction, type G2048State } from '@/lib/games/g2048';
import { LeaderboardPanel, useLeaderboard } from './leaderboard';

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};
const BEST_KEY = 'best2048';
const SAVE_KEY = 'game2048';
const SWIPE_MIN_PX = 24;

// Tile colours: warm ramp from pale to deep as values grow.
const TILE_STYLE: Record<number, { bg: string; fg: string }> = {
  2: { bg: '#eee4da', fg: '#776e65' }, 4: { bg: '#ede0c8', fg: '#776e65' },
  8: { bg: '#f2b179', fg: '#fff' }, 16: { bg: '#f59563', fg: '#fff' },
  32: { bg: '#f67c5f', fg: '#fff' }, 64: { bg: '#f65e3b', fg: '#fff' },
  128: { bg: '#edcf72', fg: '#fff' }, 256: { bg: '#edcc61', fg: '#fff' },
  512: { bg: '#edc850', fg: '#fff' }, 1024: { bg: '#edc53f', fg: '#fff' },
  2048: { bg: '#edc22e', fg: '#fff' },
};
const tileStyle = (v: number) => TILE_STYLE[v] || { bg: '#3c3a32', fg: '#fff' };

export default function Game2048() {
  const [game, setGame] = useState<G2048State>(() => createGame());
  const [history, setHistory] = useState<G2048State[]>([]);
  const [best, setBest] = useState(0);
  const [keepGoing, setKeepGoing] = useState(false);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const { leaderboard, qualifies, submit, submitting, error, setError } = useLeaderboard('2048');

  // Resume an unfinished game and the personal best from this device.
  useEffect(() => {
    try {
      setBest(Number(localStorage.getItem(BEST_KEY)) || 0);
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (saved?.board?.length === SIZE && !saved.over) setGame(saved);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(game));
      if (game.score > best) { setBest(game.score); localStorage.setItem(BEST_KEY, String(game.score)); }
    } catch { /* ignore */ }
  }, [game, best]);

  const play = useCallback((dir: Direction) => {
    setGame((prev) => {
      const next = move(prev, dir);
      if (next !== prev) setHistory((h) => [...h.slice(-19), prev]);
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    setGame(createGame());
    setHistory([]);
    setKeepGoing(false);
    setNameSubmitted(false);
    setError('');
  }, [setError]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setGame(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }, [history]);

  const showWin = game.won && !keepGoing && !game.over;
  const typingName = game.over && !nameSubmitted;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const dir = KEYS[e.key];
      if (dir && !showWin) { e.preventDefault(); play(dir); }
      else if (e.key === 'u' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) undo();
      else if (e.key === 'Enter' && game.over && !typingName) restart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, restart, undo, showWin, game.over, typingName]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || showWin) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const eligible = game.over && !nameSubmitted && qualifies(game.score);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const name = String(new FormData(e.currentTarget).get('playername') || '');
    if (await submit(name, game.score)) setNameSubmitted(true);
  };

  return (
    <div className="animate-fade-in" style={{ padding: '1rem 0 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>2048</h1>
        <p style={{ color: 'var(--accent-light)', fontSize: '1.25rem', margin: 0 }}>
          Score: {game.score} <span style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>· Best: {Math.max(best, game.score)} · Top tile: {maxTile(game.board)}</span>
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '450px' }}>
          <div
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            role="application"
            aria-label={`2048 board. Swipe or use arrow keys. Score ${game.score}.`}
            style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#bbada0', borderRadius: 14, padding: '3%', display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gridTemplateRows: `repeat(${SIZE}, 1fr)`, gap: '3%', touchAction: 'none', userSelect: 'none' }}
          >
            {game.board.flat().map((v, i) => {
              const style = tileStyle(v);
              return (
                <div key={i} style={{
                  borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: v ? style.bg : 'rgba(238, 228, 218, 0.35)', color: style.fg, fontWeight: 800,
                  fontSize: v >= 1024 ? 'clamp(1rem, 5vw, 1.7rem)' : v >= 128 ? 'clamp(1.2rem, 6vw, 2rem)' : 'clamp(1.4rem, 7vw, 2.4rem)',
                  transition: 'background 0.1s',
                }}>
                  {v || ''}
                </div>
              );
            })}

            {(showWin || game.over) && (
              <div style={{ position: 'absolute', inset: 0, borderRadius: 14, background: showWin ? 'rgba(237, 194, 46, 0.55)' : 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1rem', backdropFilter: 'blur(3px)' }}>
                <h2 style={{ color: '#fff', margin: 0, fontSize: 'clamp(1.6rem, 7vw, 2.4rem)', textAlign: 'center' }}>{showWin ? 'You made 2048! 🎉' : 'No moves left'}</h2>
                <p style={{ color: '#fff', margin: 0 }}>Score {game.score}</p>
                {showWin ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-primary" onClick={() => setKeepGoing(true)}>Keep going</button>
                    <button className="btn btn-secondary" onClick={restart}>New game</button>
                  </div>
                ) : eligible ? (
                  <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '85%', maxWidth: 280 }}>
                    <p style={{ color: '#fff', textAlign: 'center', fontWeight: 700, margin: 0 }}>New high score!</p>
                    <input name="playername" placeholder="Your name" required maxLength={20} autoFocus disabled={submitting}
                      style={{ padding: '0.7rem', borderRadius: 8, border: '1px solid #fff', background: 'transparent', color: '#fff', textAlign: 'center', fontSize: '1.05rem' }} />
                    <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Submit score'}</button>
                    {error && <p style={{ color: '#fc8181', fontSize: '0.8rem', margin: 0, textAlign: 'center' }}>{error}</p>}
                    <button type="button" className="btn btn-secondary" onClick={restart}>Skip</button>
                  </form>
                ) : (
                  <button className="btn btn-primary" onClick={restart}>Try again</button>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn btn-secondary" onClick={undo} disabled={history.length === 0 || game.over}>↶ Undo</button>
            <button className="btn btn-secondary" onClick={restart}>New game</button>
          </div>
          <p style={{ marginTop: '1rem', opacity: 0.7, textAlign: 'center', maxWidth: 400 }}>
            Swipe or use arrow keys / W A S D. Equal tiles merge — reach 2048!
          </p>
        </div>

        <LeaderboardPanel title="2048 Leaderboard" entries={leaderboard} empty={<>No scores yet.<br />Be the first on the board.</>} />
      </div>
    </div>
  );
}
