'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { COLS, ROWS, cells, createGame, ghostY, hardDrop, holdPiece, previewCells, rotate, shift, softDrop, tick, type BlocksState, type PieceType } from '@/lib/games/blocks';
import { GameFrame, Overlay, Pad, PadButton, Prompt, fitCanvas, readTheme, useFrame, usePauseWhenHidden, type Theme } from './canvas';

const CELL = 28;
const BOARD_W = COLS * CELL;
const SIDE = 110;
const W = BOARD_W + SIDE;
const H = ROWS * CELL;
const COLORS: Record<PieceType, string> = { I: '#88c0d0', O: '#ebcb8b', T: '#b48ead', S: '#a3be8c', Z: '#bf616a', J: '#5e81ac', L: '#d08770' };

export default function BlocksGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<BlocksState>(createGame());
  const theme = useRef<Theme | null>(null);
  const repeat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<{ x: number; y: number; moved: number; t: number } | null>(null);
  const [hud, setHud] = useState({ score: 0, lines: 0, level: 1, status: 'ready' as BlocksState['status'] });
  const [paused, setPaused] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, W, H);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    // Faint grid.
    ctx.strokeStyle = 'rgba(128,128,128,0.12)';
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, H); ctx.stroke(); }
    for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(BOARD_W, y * CELL + 0.5); ctx.stroke(); }
    const block = (x: number, y: number, color: string, size = CELL, ox = 0, oy = 0) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(ox + x * size + 1, oy + y * size + 1, size - 2, size - 2, 4);
      ctx.fill();
    };
    s.board.forEach((row, y) => row.forEach((c, x) => { if (c) block(x, y, COLORS[c]); }));
    if (s.status !== 'over') {
      // Ghost: where it will land.
      const gy = ghostY(s);
      ctx.globalAlpha = 0.25;
      for (const [x, y] of cells({ ...s.piece, y: gy })) if (y >= 0) block(x, y, COLORS[s.piece.type]);
      ctx.globalAlpha = 1;
      for (const [x, y] of cells(s.piece)) if (y >= 0) block(x, y, COLORS[s.piece.type]);
    }
    // Side panel: next pieces and the held one.
    ctx.fillStyle = 'rgba(128,128,128,0.08)';
    ctx.fillRect(BOARD_W, 0, SIDE, H);
    ctx.fillStyle = t.muted;
    ctx.font = '600 13px system-ui, sans-serif';
    const preview = (type: PieceType, top: number, alpha = 1) => {
      const pc = previewCells(type);
      const minX = Math.min(...pc.map((c) => c[0])), maxX = Math.max(...pc.map((c) => c[0]));
      const minY = Math.min(...pc.map((c) => c[1])), maxY = Math.max(...pc.map((c) => c[1]));
      const size = 18;
      const ox = BOARD_W + (SIDE - (maxX - minX + 1) * size) / 2 - minX * size;
      const oy = top + (2 * size - (maxY - minY + 1) * size) / 2 - minY * size;
      ctx.globalAlpha = alpha;
      for (const [x, y] of pc) block(x, y, COLORS[type], size, ox, oy);
      ctx.globalAlpha = 1;
    };
    ctx.fillText('NEXT', BOARD_W + 14, 24);
    s.queue.slice(0, 3).forEach((type, i) => preview(type, 36 + i * 50));
    ctx.fillStyle = t.muted;
    ctx.fillText('HOLD', BOARD_W + 14, 214);
    if (s.hold) preview(s.hold, 226, s.canHold ? 1 : 0.4);
    ctx.fillStyle = t.muted;
    ctx.fillText('LEVEL', BOARD_W + 14, 330);
    ctx.fillText('LINES', BOARD_W + 14, 390);
    ctx.fillStyle = t.fg;
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(String(s.level), BOARD_W + 14, 356);
    ctx.fillText(String(s.lines), BOARD_W + 14, 416);
  }, []);

  const sync = useCallback(() => {
    const s = game.current;
    setHud((h) => (h.score === s.score && h.lines === s.lines && h.level === s.level && h.status === s.status ? h : { score: s.score, lines: s.lines, level: s.level, status: s.status }));
  }, []);

  /** Apply a move, start the game if it was waiting, and redraw. */
  const act = useCallback((fn: (s: BlocksState) => BlocksState) => {
    if (game.current.status === 'over') return;
    setPaused(false);
    game.current = fn(game.current.status === 'ready' ? { ...game.current, status: 'playing' } : game.current);
    draw();
    sync();
  }, [draw, sync]);

  useFrame((dt) => { game.current = tick(game.current, dt); draw(); sync(); }, !paused && hud.status === 'playing');
  useEffect(() => { draw(); }, [draw]);
  usePauseWhenHidden(() => { if (game.current.status === 'playing') setPaused(true); });

  const restart = useCallback(() => { game.current = createGame(); setPaused(false); draw(); sync(); }, [draw, sync]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const map: Record<string, (s: BlocksState) => BlocksState> = {
        ArrowLeft: (s) => shift(s, -1), a: (s) => shift(s, -1), A: (s) => shift(s, -1),
        ArrowRight: (s) => shift(s, 1), d: (s) => shift(s, 1), D: (s) => shift(s, 1),
        ArrowDown: (s) => softDrop(s), s: (s) => softDrop(s), S: (s) => softDrop(s),
        ArrowUp: (s) => rotate(s, 1), x: (s) => rotate(s, 1), X: (s) => rotate(s, 1), w: (s) => rotate(s, 1), W: (s) => rotate(s, 1),
        z: (s) => rotate(s, -1), Z: (s) => rotate(s, -1),
        ' ': (s) => hardDrop(s), c: (s) => holdPiece(s), C: (s) => holdPiece(s), Shift: (s) => holdPiece(s),
      };
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (game.current.status === 'playing') setPaused((p) => !p); return; }
      const fn = map[e.key];
      if (fn) { e.preventDefault(); act(fn); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  // Held buttons repeat, like holding a key.
  const stopRepeat = () => { if (repeat.current) clearTimeout(repeat.current); repeat.current = null; };
  const startRepeat = (fn: (s: BlocksState) => BlocksState) => {
    stopRepeat();
    act(fn);
    const again = (delay: number) => { repeat.current = setTimeout(() => { act(fn); again(70); }, delay); };
    again(200);
  };
  useEffect(() => stopRepeat, []);

  // Board gestures: tap turns, drag sideways moves a column per cell, a quick flick down drops.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    touch.current = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = touch.current;
    if (!t) return;
    const cellPx = e.currentTarget.getBoundingClientRect().width / W * CELL;
    const cols = Math.trunc((e.clientX - t.x) / cellPx);
    if (cols !== t.moved) {
      const dir = cols > t.moved ? 1 : -1;
      for (let i = t.moved; i !== cols; i += dir) act((s) => shift(s, dir));
      t.moved = cols;
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dy = e.clientY - t.y;
    const dt = performance.now() - t.t;
    if (dy > 60 && dy / dt > 0.5) act((s) => hardDrop(s));
    else if (t.moved === 0 && Math.abs(dy) < 12 && Math.abs(e.clientX - t.x) < 12) act((s) => rotate(s, 1));
  };

  return (
    <GameFrame game="blocks" score={hud.score} stats={<>Level {hud.level} · {hud.lines} lines</>} over={hud.status === 'over'} onRestart={restart} aspect={W / H}
      help="← → move, ↑ or X turn (Z the other way), ↓ soft drop, Space hard drop, C hold, P pause. On a phone: tap to turn, drag to move, flick down to drop."
      controls={
        <Pad>
          <PadButton icon="◀" label="Move left" onPress={() => startRepeat((s) => shift(s, -1))} onRelease={stopRepeat} />
          <PadButton icon="▶" label="Move right" onPress={() => startRepeat((s) => shift(s, 1))} onRelease={stopRepeat} />
          <PadButton icon="⟳" label="Turn" onPress={() => act((s) => rotate(s, 1))} />
          <PadButton icon="▼" label="Soft drop" onPress={() => startRepeat((s) => softDrop(s))} onRelease={stopRepeat} />
          <PadButton icon="⤓" label="Hard drop" onPress={() => act((s) => hardDrop(s))} />
          <PadButton icon="⇄" label="Hold" onPress={() => act((s) => holdPiece(s))} />
        </Pad>
      }>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Blocks well"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { touch.current = null; }} />
      {hud.status !== 'over' && (hud.status === 'ready' || paused) && (
        <Overlay dim={0.3} passThrough>
          <Prompt>{paused ? 'Paused — press a key or tap to resume' : 'Press any move key or tap to start'}</Prompt>
        </Overlay>
      )}
    </GameFrame>
  );
}
