'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BALL_R, BRICK_H, BRICK_W, H, PADDLE_H, PADDLE_Y, W, brickRect, createGame, step, type BreakoutState } from '@/lib/games/breakout';
import { GameFrame, Overlay, Pad, PadButton, Prompt, canvasPoint, fitCanvas, readTheme, useFrame, usePauseWhenHidden, type Theme } from './canvas';

const ROW_COLORS = ['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#88c0d0', '#81a1c1'];

export default function BreakoutGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<BreakoutState>(createGame());
  const keys = useRef({ left: false, right: false, launch: false, target: null as number | null });
  const theme = useRef<Theme | null>(null);
  const [hud, setHud] = useState({ score: 0, lives: 3, level: 1, status: 'ready' as BreakoutState['status'], stuck: true });
  const [paused, setPaused] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, W, H);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    s.bricks.forEach((alive, i) => {
      if (!alive) return;
      const r = brickRect(i);
      ctx.fillStyle = ROW_COLORS[r.row];
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, BRICK_W, BRICK_H, 4);
      ctx.fill();
    });
    ctx.fillStyle = t.accentLight;
    ctx.beginPath();
    ctx.roundRect(s.paddleX - s.paddleW / 2, PADDLE_Y, s.paddleW, PADDLE_H, 6);
    ctx.fill();
    ctx.fillStyle = t.fg;
    ctx.shadowColor = t.accentLight;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Lives as small balls in the corner.
    ctx.fillStyle = t.muted;
    for (let i = 0; i < s.lives; i++) { ctx.beginPath(); ctx.arc(W - 16 - i * 18, 22, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`Level ${s.level}`, 12, 27);
  }, []);

  const sync = () => {
    const s = game.current;
    setHud((h) => (h.score === s.score && h.lives === s.lives && h.level === s.level && h.status === s.status && h.stuck === s.stuck
      ? h : { score: s.score, lives: s.lives, level: s.level, status: s.status, stuck: s.stuck }));
  };

  useFrame((dt) => {
    const k = keys.current;
    const move = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    game.current = step(game.current, dt, { move: move as -1 | 0 | 1, target: move ? null : k.target, launch: k.launch });
    k.launch = false;
    draw();
    sync();
  }, !paused && hud.status !== 'over');

  useEffect(() => { draw(); }, [draw]);
  usePauseWhenHidden(() => { if (game.current.status === 'playing') setPaused(true); });

  const restart = useCallback(() => {
    game.current = createGame();
    keys.current = { left: false, right: false, launch: false, target: null };
    setPaused(false);
    sync();
    draw();
  }, [draw]);

  const launch = () => { setPaused(false); keys.current.launch = true; };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = keys.current;
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) { k.left = true; k.target = null; e.preventDefault(); }
      else if (['ArrowRight', 'd', 'D'].includes(e.key)) { k.right = true; k.target = null; e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (game.current.stuck) launch(); else if (game.current.status === 'playing') setPaused((p) => !p);
      } else if (e.key === 'p' || e.key === 'P') setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) keys.current.left = false;
      if (['ArrowRight', 'd', 'D'].includes(e.key)) keys.current.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const aim = (e: React.PointerEvent<HTMLCanvasElement>) => {
    keys.current.target = canvasPoint(e.currentTarget, W, H, e.clientX, e.clientY).x;
  };

  return (
    <GameFrame game="breakout" score={hud.score} stats={<>Level {hud.level} · {'●'.repeat(Math.max(0, hud.lives))}</>} over={hud.status === 'over'} onRestart={restart} aspect={W / H}
      help="Move the mouse or drag on the board to steer (or ← → / A D). Tap or press Space to launch. Where the ball hits the paddle sets its angle; top rows are worth more."
      controls={
        <Pad>
          <PadButton icon="◀" label="Move left" onPress={() => { keys.current.left = true; keys.current.target = null; }} onRelease={() => { keys.current.left = false; }} />
          <PadButton icon={hud.stuck ? '🚀' : paused ? '▶' : '❚❚'} label={hud.stuck ? 'Launch' : paused ? 'Resume' : 'Pause'} wide
            onPress={() => (game.current.stuck ? launch() : setPaused((p) => !p))} />
          <PadButton icon="▶" label="Move right" onPress={() => { keys.current.right = true; keys.current.target = null; }} onRelease={() => { keys.current.right = false; }} />
        </Pad>
      }>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'none' }}
        onPointerMove={aim}
        onPointerDown={(e) => { aim(e); if (game.current.stuck) launch(); else if (paused) setPaused(false); }}
        aria-label="Breakout board" role="img" />
      {hud.status !== 'over' && (hud.stuck || paused) && (
        <Overlay dim={0.25} passThrough>
          <Prompt>{paused ? 'Paused — tap to resume' : hud.status === 'ready' ? 'Tap or press Space to launch' : `Level ${hud.level} — tap to launch`}</Prompt>
        </Overlay>
      )}
    </GameFrame>
  );
}
