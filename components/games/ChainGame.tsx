'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DOT_R, SIZE, blastRadius, createGame, dotCount, needed, proceed, step, tap, type ChainState } from '@/lib/games/chain';
import { GameFrame, Overlay, Prompt, canvasPoint, fitCanvas, readTheme, useFrame, type Theme } from './canvas';

export default function ChainGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<ChainState>(createGame());
  const theme = useRef<Theme | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [hud, setHud] = useState({ score: 0, pending: 0, level: 1, lives: 3, popped: 0, status: 'aim' as ChainState['status'] });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, SIZE, SIZE);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const d of s.dots) {
      if (d.blast === null) {
        ctx.fillStyle = `hsl(${d.hue} 70% 65%)`;
        ctx.beginPath(); ctx.arc(d.x, d.y, DOT_R, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const r = blastRadius(d.blast);
      if (r <= 0) continue;
      ctx.fillStyle = `hsl(${d.hue} 75% 62% / 0.45)`;
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill();
      if (d.gen > 1 && d.blast < 0.6) {
        ctx.fillStyle = t.fg;
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`×${Math.min(10, d.gen)}`, d.x, d.y + 4);
        ctx.textAlign = 'left';
      }
    }
    if (s.tap && blastRadius(s.tap.age) > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(s.tap.x, s.tap.y, blastRadius(s.tap.age), 0, Math.PI * 2); ctx.fill();
    }
    // Where the tap would go (mouse).
    if (s.status === 'aim' && pointer.current) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(pointer.current.x, pointer.current.y, 40, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = t.fg;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`Level ${s.level}`, 12, 24);
    const need = needed(s.level);
    ctx.fillStyle = s.popped >= need ? t.success : t.muted;
    ctx.fillText(`${s.popped} / ${need} of ${dotCount(s.level)}`, 12, 44);
    ctx.fillStyle = t.danger;
    ctx.textAlign = 'right';
    ctx.fillText('♥'.repeat(Math.max(0, s.lives)), SIZE - 12, 24);
    ctx.textAlign = 'left';
  }, []);

  const sync = () => {
    const s = game.current;
    setHud((h) => (h.score === s.score && h.pending === s.pending && h.level === s.level && h.lives === s.lives && h.popped === s.popped && h.status === s.status
      ? h : { score: s.score, pending: s.pending, level: s.level, lives: s.lives, popped: s.popped, status: s.status }));
  };

  useFrame((dt) => { game.current = step(game.current, dt); draw(); sync(); }, hud.status === 'aim' || hud.status === 'running');
  useEffect(() => { draw(); }, [draw]);

  const restart = useCallback(() => { game.current = createGame(); sync(); draw(); }, [draw]);
  const next = useCallback(() => { game.current = proceed(game.current); sync(); draw(); }, [draw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.key === 'Enter' || e.key === ' ') && (game.current.status === 'cleared' || game.current.status === 'failed')) { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const s = game.current;
    if (s.status === 'cleared' || s.status === 'failed') { next(); return; }
    const p = canvasPoint(e.currentTarget, SIZE, SIZE, e.clientX, e.clientY);
    game.current = tap(s, p.x, p.y);
    pointer.current = null;
    sync();
  };

  const shown = hud.score + hud.pending;
  return (
    <GameFrame game="chain" score={shown} stats={<>Level {hud.level} · {'♥'.repeat(Math.max(0, hud.lives))}</>} over={hud.status === 'over'} overTitle="Out of chances" onRestart={restart} aspect={1}
      help="One tap per level: it sets off a blast, and every dot it touches blows up and catches others. Pop the number shown to pass. Dots further down the chain are worth more (×2, ×3…). Miss three levels and it's over.">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} role="img" aria-label="Chain Reaction field"
        onPointerDown={onDown}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') pointer.current = canvasPoint(e.currentTarget, SIZE, SIZE, e.clientX, e.clientY); }}
        onPointerLeave={() => { pointer.current = null; }} />
      {hud.status === 'aim' && hud.popped === 0 && (
        <Overlay dim={0} passThrough>
          <Prompt>Pop {needed(hud.level)} of {dotCount(hud.level)} — tap once to start the chain</Prompt>
        </Overlay>
      )}
      {(hud.status === 'cleared' || hud.status === 'failed') && (
        <Overlay dim={0.55}>
          <h2 style={{ margin: 0, color: hud.status === 'cleared' ? 'var(--success)' : 'var(--danger)' }}>{hud.status === 'cleared' ? `Level ${hud.level} cleared!` : 'Not quite'}</h2>
          <p style={{ margin: 0 }}>Popped {hud.popped} of {dotCount(hud.level)} (needed {needed(hud.level)}){hud.status === 'failed' ? ` · ${hud.lives} ${hud.lives === 1 ? 'chance' : 'chances'} left` : ''}</p>
          <button className="btn btn-primary" onClick={next} autoFocus>{hud.status === 'cleared' ? `On to level ${hud.level + 1}` : 'Try again'}</button>
        </Overlay>
      )}
    </GameFrame>
  );
}
