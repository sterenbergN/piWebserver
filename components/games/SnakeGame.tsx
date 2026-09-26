'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GRID_SIZE, createGame, queueDirection, step, tickMs, type Direction, type SnakeState } from '@/lib/games/snake';
import { LeaderboardPanel, useLeaderboard } from './leaderboard';

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};
const BEST_KEY = 'snakeBest';
const SWIPE_MIN_PX = 24;

export default function SnakeGame() {
  const [game, setGame] = useState<SnakeState>(createGame);
  const [paused, setPaused] = useState(false);
  const [best, setBest] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const { leaderboard, qualifies, submit, submitting: submittingName, error: submitError, setError: setSubmitError } = useLeaderboard('snake');
  const [nameSubmitted, setNameSubmitted] = useState(false);

  useEffect(() => {
    try { setBest(Number(localStorage.getItem(BEST_KEY)) || 0); } catch { /* storage unavailable */ }
  }, []);

  const turn = useCallback((direction: Direction) => {
    setPaused(false);
    setGame((prev) => queueDirection(prev, direction));
  }, []);

  const restart = useCallback(() => {
    setGame(createGame());
    setPaused(false);
    setNameSubmitted(false);
    setSubmitError('');
  }, [setSubmitError]);

  // Game loop
  useEffect(() => {
    if (game.status !== 'playing' || paused) return;
    const handle = setTimeout(() => setGame((prev) => step(prev)), tickMs(game.score));
    return () => clearTimeout(handle);
  }, [game, paused]);

  // Remember the personal best on this device.
  useEffect(() => {
    if (game.status === 'over' && game.score > best) {
      setBest(game.score);
      try { localStorage.setItem(BEST_KEY, String(game.score)); } catch { /* ignore */ }
    }
  }, [game.status, game.score, best]);

  // Pause when the tab is hidden so the snake doesn't die in the background.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const typingName = game.status === 'over' && !nameSubmitted;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // let the name field work
      const direction = KEY_DIRECTIONS[e.key];
      if (direction && game.status !== 'over') {
        e.preventDefault();
        turn(direction);
      } else if (e.key === ' ' && game.status === 'playing') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === 'Enter' && game.status === 'over' && !typingName) {
        restart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [game.status, turn, restart, typingName]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || game.status === 'over') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) {
      // A tap starts or resumes the game.
      if (game.status === 'ready') turn(game.direction);
      else setPaused((p) => !p);
      return;
    }
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const { snake, food, score, status } = game;
  const isEligibleHighScore = status === 'over' && !nameSubmitted && qualifies(score);

  const handleNameSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submittingName) return;
    const name = String(new FormData(e.currentTarget).get('playername') || '');
    if (await submit(name, score)) setNameSubmitted(true);
  };

  const dpadButton = (direction: Direction, label: string, area: string) => (
    <button
      key={direction}
      className="btn btn-secondary"
      aria-label={`Move ${direction}`}
      onClick={() => turn(direction)}
      style={{ gridArea: area, padding: 0, height: 56, fontSize: '1.3rem', borderRadius: 14, touchAction: 'manipulation' }}
    >
      {label}
    </button>
  );

  return (
    <div className="animate-fade-in" style={{ padding: '1rem 0 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
         <h1 style={{ marginBottom: '0.5rem' }}>Terminal Protocol: Snake</h1>
         <p style={{ color: 'var(--accent-light)', fontSize: '1.25rem', margin: 0 }}>
           Score: {score} <span style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>· Best: {Math.max(best, score)}</span>
         </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '450px' }}>
          <div
            className="glass-panel"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onClick={() => { if (status === 'ready') turn(game.direction); }}
            style={{ position: 'relative', width: '100%', aspectRatio: '1/1', padding: 0, border: '2px solid var(--accent)', overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: status === 'ready' ? 'pointer' : 'default' }}
            role="application"
            aria-label="Snake game board. Swipe or use arrow keys to steer."
          >
            <div style={{
                position: 'absolute', inset: 0,
                display: 'grid',
                gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`
            }}>
               <div style={{
                   gridColumn: food.x + 1,
                   gridRow: food.y + 1,
                   background: '#eb4d4b',
                   borderRadius: '50%',
                   margin: '2px',
                   boxShadow: '0 0 10px #eb4d4b'
               }} />
               {snake.map((seg, i) => (
                 <div key={i} style={{
                    gridColumn: seg.x + 1,
                    gridRow: seg.y + 1,
                    background: i === 0 ? 'var(--accent-light)' : 'var(--accent)',
                    borderRadius: i === 0 ? '4px' : '2px',
                    margin: '1px'
                 }} />
               ))}
            </div>

            {status === 'over' && (
               <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(6px)', zIndex: 10, padding: '1rem'
               }}>
                  <h2 style={{ color: '#eb4d4b', fontSize: 'clamp(1.6rem, 7vw, 2.5rem)', marginBottom: '0.5rem', letterSpacing: '2px', textAlign: 'center' }}>SYSTEM FAILURE</h2>
                  <p style={{ fontSize: '1.2rem', marginBottom: '1.25rem', color: 'white' }}>Final Score: <span style={{ color: 'var(--accent-light)' }}>{score}</span></p>

                  {isEligibleHighScore ? (
                    <form onSubmit={handleNameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '85%', maxWidth: '280px', background: 'rgba(0,0,0,0.5)', padding: '1.25rem', borderRadius: '12px' }}>
                      <p style={{ color: 'var(--accent-light)', textAlign: 'center', fontWeight: 'bold', margin: 0 }}>New High Score!</p>
                      <input type="text" name="playername" placeholder="Enter your name" required maxLength={20} disabled={submittingName} autoFocus
                        style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--accent)', background: 'transparent', color: 'white', textAlign: 'center', fontSize: '1.1rem' }} />
                      <button type="submit" className="btn btn-primary" disabled={submittingName}>
                        {submittingName ? 'Saving...' : 'Submit Score'}
                      </button>
                      {submitError && <p style={{ color: '#fc8181', fontSize: '0.8rem', margin: 0, textAlign: 'center' }}>{submitError}</p>}
                      <button type="button" className="btn btn-secondary" onClick={restart}>Skip</button>
                    </form>
                  ) : (
                    <button className="btn btn-primary" onClick={restart}>Reboot Sequence</button>
                  )}
               </div>
            )}

            {(status === 'ready' || (status === 'playing' && paused)) && (
               <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'
               }}>
                  <p style={{ fontWeight: 'bold', letterSpacing: '2px', textTransform: 'uppercase', color: 'white', background: 'rgba(0,0,0,0.6)', padding: '1rem 1.5rem', borderRadius: '20px', textAlign: 'center', margin: '0 1rem' }}>
                    {status === 'ready' ? 'Tap, swipe or press a key to begin' : 'Paused — tap to resume'}
                  </p>
               </div>
            )}
          </div>

          {/* On-screen controls for touch devices */}
          <div
            className="snake-dpad"
            style={{ display: 'grid', gridTemplateAreas: '". up ." "left pause right" ". down ."', gridTemplateColumns: 'repeat(3, 64px)', gap: '8px', marginTop: '1.25rem' }}
          >
            {dpadButton('up', '▲', 'up')}
            {dpadButton('left', '◀', 'left')}
            <button
              className="btn btn-secondary"
              aria-label={paused ? 'Resume' : 'Pause'}
              disabled={status !== 'playing'}
              onClick={() => setPaused((p) => !p)}
              style={{ gridArea: 'pause', padding: 0, height: 56, borderRadius: 14, fontSize: '1rem', touchAction: 'manipulation' }}
            >
              {paused ? '▶' : '❚❚'}
            </button>
            {dpadButton('right', '▶', 'right')}
            {dpadButton('down', '▼', 'down')}
          </div>

          <p style={{ marginTop: '1.25rem', opacity: 0.7, textAlign: 'center', maxWidth: '400px' }}>
            Swipe on the board, use the pad, or W A S D / arrow keys. Space pauses.<br />Consuming nodes accelerates structural loops.
          </p>
        </div>

        <LeaderboardPanel title="Snake Leaderboard" entries={leaderboard} empty={<>No sequences recorded.<br />The terminal awaits.</>} />
      </div>
    </div>
  );
}
