'use client';

import { useEffect, useRef, useState } from 'react';
import { LeaderboardPanel, ScoreForm, useLeaderboard } from './leaderboard';
import { gameInfo, type GameId } from '@/lib/games/registry';

// Shared pieces for the canvas games: a sharp canvas at a fixed logical size,
// an animation loop, the site's colours, and the page frame with the
// game-over screen and leaderboard.

export type Theme = { bg: string; fg: string; muted: string; accent: string; accentLight: string; danger: string; success: string; border: string };

/** The site's colours (they follow light/dark mode), read when the game starts. */
export function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--background', '#2b303b'), fg: v('--foreground', '#eceff4'), muted: v('--muted', '#a0a8b8'),
    accent: v('--accent', '#5e81ac'), accentLight: v('--accent-light', '#88c0d0'), danger: v('--danger', '#e0707a'),
    success: v('--success', '#a3be8c'), border: v('--surface-border', 'rgba(255,255,255,0.12)'),
  };
}

/** Size a canvas for its logical width × height at the screen's pixel density; returns its 2D context. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A pointer position in the canvas's logical coordinates. */
export function canvasPoint(canvas: HTMLCanvasElement, width: number, height: number, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((clientX - rect.left) / rect.width) * width, y: ((clientY - rect.top) / rect.height) * height };
}

/** Call `frame(dt)` (seconds, capped so a stall doesn't teleport things) every animation frame while `running`. */
export function useFrame(frame: (dt: number) => void, running: boolean) {
  const ref = useRef(frame);
  useEffect(() => { ref.current = frame; });
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ref.current(dt);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [running]);
}

/** Calls `onHide` when the tab is hidden, so games pause instead of playing on without you. */
export function usePauseWhenHidden(onHide: () => void) {
  const ref = useRef(onHide);
  useEffect(() => { ref.current = onHide; });
  useEffect(() => {
    const handler = () => { if (document.hidden) ref.current(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
}

/** The device best for a game, saved when beaten. */
export function useBest(game: GameId, score: number) {
  const key = `arcadeBest:${game}`;
  const [best, setBest] = useState(0);
  useEffect(() => { try { setBest(Number(localStorage.getItem(key)) || 0); } catch { /* storage blocked */ } }, [key]);
  useEffect(() => {
    if (score <= best) return;
    setBest(score);
    try { localStorage.setItem(key, String(score)); } catch { /* storage blocked */ }
  }, [score, best, key]);
  return Math.max(best, score);
}

/** A see-through layer over the board for start, pause and game-over screens. */
export function Overlay({ children, dim = 0.8, passThrough = false }: { children: React.ReactNode; dim?: number; passThrough?: boolean }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: `rgba(0,0,0,${dim})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '0.75rem', padding: '1rem', textAlign: 'center', color: '#fff', zIndex: 5, pointerEvents: passThrough ? 'none' : 'auto', backdropFilter: dim > 0.5 ? 'blur(4px)' : undefined,
    }}>
      {children}
    </div>
  );
}

/** "Tap to start" style message. */
export function Prompt({ children }: { children: React.ReactNode }) {
  return <p style={{ fontWeight: 700, letterSpacing: '1px', background: 'rgba(0,0,0,0.6)', padding: '0.9rem 1.3rem', borderRadius: 18, margin: 0 }}>{children}</p>;
}

/**
 * The page around a canvas game: title, score line, the board (children),
 * extra controls, help text and the leaderboard. When `over`, the game-over
 * screen goes on top of the board, with the high-score form if it qualifies.
 */
export function GameFrame({ game, score, stats, over, overTitle, onRestart, aspect, children, controls, help }: {
  game: GameId;
  score: number;
  /** Extra numbers after the score, e.g. "Level 3". */
  stats?: React.ReactNode;
  over: boolean;
  overTitle?: string;
  onRestart: () => void;
  /** Board width / height. */
  aspect: number;
  children: React.ReactNode;
  controls?: React.ReactNode;
  help: React.ReactNode;
}) {
  const info = gameInfo(game);
  const best = useBest(game, over ? score : 0);
  const { leaderboard, qualifies, submit, submitting, error, setError } = useLeaderboard(game);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { if (!over) { setSubmitted(false); setError(''); } }, [over, setError]);
  const eligible = over && !submitted && qualifies(score);

  // Enter starts a new game from the game-over screen (unless you're typing a name).
  useEffect(() => {
    if (!over || eligible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onRestart(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [over, eligible, onRestart]);

  return (
    <div className="animate-fade-in" style={{ padding: '1rem 0 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ marginBottom: '0.4rem' }}>{info.emoji} {info.label}</h1>
        <p style={{ color: 'var(--accent-light)', fontSize: '1.2rem', margin: 0 }}>
          Score: {score.toLocaleString()} <span style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>· Best: {Math.max(best, score).toLocaleString()}{stats ? <> · {stats}</> : null}</span>
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: aspect >= 1 ? 480 : `min(100%, calc((100svh - 14rem) * ${aspect}), 440px)` }}>
          <div className="glass-panel" style={{ position: 'relative', width: '100%', aspectRatio: String(aspect), padding: 0, border: '2px solid var(--accent)', overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}>
            {children}
            {over && (
              <Overlay>
                <h2 style={{ color: 'var(--danger)', fontSize: 'clamp(1.5rem, 7vw, 2.2rem)', margin: 0 }}>{overTitle ?? 'Game over'}</h2>
                <p style={{ margin: 0, fontSize: '1.15rem' }}>Score <span style={{ color: 'var(--accent-light)' }}>{score.toLocaleString()}</span></p>
                {eligible ? (
                  <ScoreForm score={score} submitting={submitting} error={error} onSkip={onRestart}
                    onSubmit={async (name) => { if (await submit(name, score)) setSubmitted(true); }} />
                ) : (
                  <button className="btn btn-primary" onClick={onRestart} autoFocus>{submitted ? 'Saved! Play again' : 'Play again'}</button>
                )}
              </Overlay>
            )}
          </div>
          {controls}
          <p style={{ marginTop: '1rem', opacity: 0.7, textAlign: 'center', maxWidth: 420 }}>{help}</p>
        </div>
        <LeaderboardPanel title={`${info.label} Leaderboard`} entries={leaderboard} empty={<>No scores yet.<br />Be the first on the board.</>} />
      </div>
    </div>
  );
}

/** A big on-screen button for touch controls; fires on press (not release) so it feels instant. */
export function PadButton({ icon, label, onPress, onRelease, wide }: { icon: string; label: string; onPress: () => void; onRelease?: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      aria-label={label}
      title={label}
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={(e) => e.preventDefault()}
      style={{ padding: 0, height: 56, minWidth: wide ? 120 : 56, flex: wide ? '1 1 120px' : '0 0 56px', fontSize: '1.2rem', borderRadius: 14, touchAction: 'none', userSelect: 'none' }}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

/** A row of PadButtons under the board (touch screens only; keyboards have keys). */
export function Pad({ children }: { children: React.ReactNode }) {
  return <div className="arcade-pad" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: '1rem', width: '100%' }}>{children}</div>;
}
