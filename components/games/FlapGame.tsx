'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BIRD_R, BIRD_X, GROUND, H, PIPE_W, W, createGame, flap, step, type FlapState } from '@/lib/games/flap';
import { GameFrame, Overlay, Prompt, fitCanvas, readTheme, useFrame, usePauseWhenHidden, type Theme } from './canvas';

export default function FlapGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<FlapState>(createGame());
  const theme = useRef<Theme | null>(null);
  const scroll = useRef(0);
  const [hud, setHud] = useState({ score: 0, status: 'ready' as FlapState['status'] });
  const [paused, setPaused] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, W, H);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    // Far-off hills, scrolling slowly for depth.
    ctx.fillStyle = 'rgba(136,192,208,0.10)';
    for (let i = -1; i < 4; i++) {
      const x = i * 160 - (scroll.current * 0.3) % 160;
      ctx.beginPath(); ctx.arc(x + 80, GROUND + 10, 90, Math.PI, 0); ctx.fill();
    }
    for (const p of s.pipes) {
      const top = p.gapY - p.gap / 2;
      const bottom = p.gapY + p.gap / 2;
      ctx.fillStyle = t.success;
      ctx.fillRect(p.x, 0, PIPE_W, top);
      ctx.fillRect(p.x, bottom, PIPE_W, GROUND - bottom);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(p.x - 4, top - 18, PIPE_W + 8, 18);
      ctx.fillRect(p.x - 4, bottom, PIPE_W + 8, 18);
      ctx.fillStyle = t.success;
      ctx.fillRect(p.x - 3, top - 17, PIPE_W + 6, 16);
      ctx.fillRect(p.x - 3, bottom + 1, PIPE_W + 6, 16);
    }
    ctx.fillStyle = t.border;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = 'rgba(128,128,128,0.35)';
    for (let x = -((scroll.current) % 24); x < W; x += 24) ctx.fillRect(x, GROUND, 12, 6);
    // The bird, tilted by how fast it's moving.
    ctx.save();
    ctx.translate(BIRD_X, s.y);
    ctx.rotate(Math.max(-0.5, Math.min(1.2, s.vy / 600)));
    ctx.fillStyle = '#ebcb8b';
    ctx.beginPath(); ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d08770';
    ctx.beginPath(); ctx.ellipse(-4, 3, 8, 5, -0.3 + Math.sin(s.t * 20) * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(BIRD_R - 2, -2); ctx.lineTo(BIRD_R + 8, 2); ctx.lineTo(BIRD_R - 2, 6); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(5, -5, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2e3440';
    ctx.beginPath(); ctx.arc(6.5, -5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (s.status !== 'ready') {
      ctx.fillStyle = t.fg;
      ctx.font = '800 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(s.score), W / 2, 70);
      ctx.textAlign = 'left';
    }
  }, []);

  const sync = () => {
    const s = game.current;
    setHud((h) => (h.score === s.score && h.status === s.status ? h : { score: s.score, status: s.status }));
  };

  useFrame((dt) => {
    const before = game.current.status;
    game.current = step(game.current, dt);
    if (before === 'playing') scroll.current += 165 * dt;
    draw();
    sync();
  }, !paused);

  useEffect(() => { draw(); }, [draw]);
  usePauseWhenHidden(() => { if (game.current.status === 'playing') setPaused(true); });

  const press = useCallback(() => {
    if (game.current.status === 'over') return;
    setPaused(false);
    game.current = flap(game.current);
    sync();
  }, []);
  const restart = useCallback(() => { game.current = createGame(); scroll.current = 0; setPaused(false); sync(); draw(); }, [draw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.repeat) return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); press(); }
      else if ((e.key === 'p' || e.key === 'P') && game.current.status === 'playing') setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <GameFrame game="flap" score={hud.score} over={hud.status === 'over'} overTitle="Bonk!" onRestart={restart} aspect={W / H}
      help="Tap the board, or press Space / ↑, to flap. Pipes speed up and gaps narrow as you go. P pauses.">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Flap: tap to fly through the pipes"
        onPointerDown={(e) => { e.preventDefault(); press(); }} />
      {hud.status !== 'over' && (hud.status === 'ready' || paused) && (
        <Overlay dim={0.2} passThrough>
          <Prompt>{paused ? 'Paused — tap to flap on' : 'Tap or press Space to flap'}</Prompt>
        </Overlay>
      )}
    </GameFrame>
  );
}
