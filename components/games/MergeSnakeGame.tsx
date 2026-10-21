'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GRID, createGame, queueDirection, step, tickMs, topValue, type Direction, type MergeSnakeState } from '@/lib/games/mergesnake';
import { GameFrame, Overlay, Pad, PadButton, Prompt, fitCanvas, readTheme, useFrame, usePauseWhenHidden, type Theme } from './canvas';

const CELL = 40;
const SIZE = GRID * CELL;
const KEYS: Record<string, Direction> = {
  ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
};
// The 2048 colours, so the numbers read the same as in that game.
const TILE: Record<number, [string, string]> = {
  2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'], 8: ['#f2b179', '#fff'], 16: ['#f59563', '#fff'], 32: ['#f67c5f', '#fff'],
  64: ['#f65e3b', '#fff'], 128: ['#edcf72', '#fff'], 256: ['#edcc61', '#fff'], 512: ['#edc850', '#fff'], 1024: ['#edc53f', '#fff'], 2048: ['#edc22e', '#fff'],
};
const tile = (v: number) => TILE[v] ?? ['#3c3a32', '#fff'];

export default function MergeSnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<MergeSnakeState>(createGame());
  const theme = useRef<Theme | null>(null);
  const acc = useRef(0);
  const clock = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [hud, setHud] = useState({ score: 0, top: 2, length: 2, status: 'ready' as MergeSnakeState['status'] });
  const [paused, setPaused] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, SIZE, SIZE);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(128,128,128,0.06)';
    for (let y = 0; y < GRID; y++) for (let x = (y % 2); x < GRID; x += 2) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

    const box = (x: number, y: number, inset: number, fill: string, r = 8) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x * CELL + inset, y * CELL + inset, CELL - 2 * inset, CELL - 2 * inset, r);
      ctx.fill();
    };
    const label = (x: number, y: number, v: number, color: string) => {
      ctx.fillStyle = color;
      ctx.font = `800 ${v >= 1000 ? 12 : v >= 100 ? 14 : 17}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x * CELL + CELL / 2, y * CELL + CELL / 2 + 1);
    };

    // Food: a gentle pulse, and a ring on the one that merges with your front segment.
    const front = s.values[0];
    const pulse = 1 + Math.sin(clock.current * 5) * 0.06;
    for (const f of s.food) {
      const [bg, fg] = tile(f.value);
      ctx.save();
      ctx.translate(f.x * CELL + CELL / 2, f.y * CELL + CELL / 2);
      ctx.scale(pulse, pulse);
      ctx.translate(-(f.x * CELL + CELL / 2), -(f.y * CELL + CELL / 2));
      if (f.value === front) {
        ctx.strokeStyle = t.accentLight;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(f.x * CELL + 3, f.y * CELL + 3, CELL - 6, CELL - 6, 9);
        ctx.stroke();
      }
      box(f.x, f.y, 7, bg, 7);
      label(f.x, f.y, f.value, fg);
      ctx.restore();
    }

    // The body's spine, under the tiles, so the snake reads as one creature.
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = CELL * 0.42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.cells.forEach((c, i) => { const px = c.x * CELL + CELL / 2, py = c.y * CELL + CELL / 2; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    for (let i = s.cells.length - 1; i >= 1; i--) {
      const c = s.cells[i];
      const v = s.values[i - 1];
      const [bg, fg] = tile(v);
      box(c.x, c.y, 3, bg);
      label(c.x, c.y, v, fg);
    }
    const h = s.cells[0];
    box(h.x, h.y, 2, s.status === 'over' ? t.danger : t.accentLight, 10);
    // Eyes looking where it's going.
    const look = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.direction];
    const cx = h.x * CELL + CELL / 2, cy = h.y * CELL + CELL / 2;
    for (const side of [-1, 1]) {
      const ex = cx + look[0] * 6 + (look[1] !== 0 ? side * 8 : 0);
      const ey = cy + look[1] * 6 + (look[0] !== 0 ? side * 8 : 0);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e3440';
      ctx.beginPath(); ctx.arc(ex + look[0] * 2, ey + look[1] * 2, 2.4, 0, Math.PI * 2); ctx.fill();
    }

    // Flash the latest cascade for a moment.
    if (s.lastMerge && s.ticks - s.lastMerge.at < 6) {
      const age = (s.ticks - s.lastMerge.at) / 6;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = t.fg;
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.lastMerge.chain > 1 ? `${s.lastMerge.value}!  ×${s.lastMerge.chain} chain` : `${s.lastMerge.value}!`, SIZE / 2, 30 - age * 10);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }, []);

  const sync = () => {
    const s = game.current;
    const top = topValue(s);
    setHud((h) => (h.score === s.score && h.top === top && h.length === s.cells.length && h.status === s.status ? h : { score: s.score, top, length: s.cells.length, status: s.status }));
  };

  useFrame((dt) => {
    clock.current += dt;
    if (game.current.status === 'playing') {
      acc.current += dt * 1000;
      const every = tickMs(game.current);
      while (acc.current >= every && game.current.status === 'playing') {
        acc.current -= every;
        game.current = step(game.current);
      }
    }
    draw();
    sync();
  }, !paused && hud.status !== 'over');

  useEffect(() => { draw(); }, [draw]);
  usePauseWhenHidden(() => { if (game.current.status === 'playing') setPaused(true); });

  const turn = useCallback((dir: Direction) => {
    if (game.current.status === 'over') return;
    setPaused(false);
    game.current = queueDirection(game.current, dir);
    sync();
  }, []);
  const restart = useCallback(() => { game.current = createGame(); acc.current = 0; setPaused(false); sync(); draw(); }, [draw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const dir = KEYS[e.key];
      if (dir) { e.preventDefault(); turn(dir); }
      else if ((e.key === ' ' || e.key === 'p' || e.key === 'P') && game.current.status === 'playing') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

  return (
    <GameFrame game="merge" score={hud.score} stats={<>Top tile {hud.top} · length {hud.length}</>} over={hud.status === 'over'} overTitle="Tangled up" onRestart={restart} aspect={1}
      help="Snake meets 2048. Each tile you eat joins your body right behind the head; when the two front numbers match they merge, and merges cascade down the body (2 → 4 → 8 → 16…), shrinking you. Eat the wrong number and you just get longer. The ringed tile matches your front. Arrow keys / W A S D or swipe; Space pauses."
      controls={
        <Pad>
          <PadButton icon="◀" label="Left" onPress={() => turn('left')} />
          <PadButton icon="▲" label="Up" onPress={() => turn('up')} />
          <PadButton icon="▼" label="Down" onPress={() => turn('down')} />
          <PadButton icon="▶" label="Right" onPress={() => turn('right')} />
        </Pad>
      }>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Merge Snake board"
        onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const dx = e.clientX - start.x, dy = e.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
            if (game.current.status === 'ready') turn(game.current.direction); else if (paused) setPaused(false);
            return;
          }
          turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        }} />
      {hud.status !== 'over' && (hud.status === 'ready' || paused) && (
        <Overlay dim={0.3} passThrough>
          <Prompt>{paused ? 'Paused — tap or press a key' : 'Eat the 2 first — swipe or press an arrow to go'}</Prompt>
        </Overlay>
      )}
    </GameFrame>
  );
}
