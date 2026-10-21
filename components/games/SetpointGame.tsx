'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HISTORY, bandAt, createGame, gustWarning, outside, setpointAt, step, type SetpointState } from '@/lib/games/setpoint';
import { GameFrame, Overlay, Pad, PadButton, Prompt, fitCanvas, readTheme, useFrame, usePauseWhenHidden, type Theme } from './canvas';

const W = 480;
const H = 520;
const PAD = 28;
const NOW_X = 300;
const CHART_END = 380;
const AHEAD = 1.5;
const toY = (v: number) => PAD + (1 - v) * (H - 2 * PAD);

export default function SetpointGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useRef<SetpointState>(createGame());
  const thrust = useRef(false);
  const theme = useRef<Theme | null>(null);
  const [hud, setHud] = useState({ score: 0, status: 'ready' as SetpointState['status'], t: 0 });
  const [paused, setPaused] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t = (theme.current ??= readTheme());
    const ctx = fitCanvas(canvas, W, H);
    const s = game.current;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    // Chart grid.
    ctx.strokeStyle = 'rgba(128,128,128,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = toY(i / 4); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CHART_END, y); ctx.stroke(); }
    const dx = NOW_X / HISTORY;
    const hist = s.history;
    const x0 = NOW_X - hist.length * dx;
    // The band over the last few seconds, and the path it will take next (fainter).
    if (hist.length > 1) {
      ctx.fillStyle = 'rgba(163,190,140,0.22)';
      ctx.beginPath();
      hist.forEach((p, i) => { const x = x0 + i * dx; if (i) ctx.lineTo(x, toY(p.sp + p.band)); else ctx.moveTo(x, toY(p.sp + p.band)); });
      for (let i = hist.length - 1; i >= 0; i--) ctx.lineTo(x0 + i * dx, toY(hist[i].sp - hist[i].band));
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(163,190,140,0.10)';
    ctx.beginPath();
    const steps = 30;
    for (let i = 0; i <= steps; i++) { const tt = s.t + (AHEAD * i) / steps; ctx.lineTo(NOW_X + ((CHART_END - NOW_X) * i) / steps, toY(setpointAt(s, tt) + bandAt(tt))); }
    for (let i = steps; i >= 0; i--) { const tt = s.t + (AHEAD * i) / steps; ctx.lineTo(NOW_X + ((CHART_END - NOW_X) * i) / steps, toY(setpointAt(s, tt) - bandAt(tt))); }
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = t.muted;
    ctx.beginPath(); ctx.moveTo(NOW_X, PAD - 10); ctx.lineTo(NOW_X, H - PAD + 10); ctx.stroke();
    ctx.setLineDash([]);
    // The process value trace.
    if (hist.length > 1) {
      ctx.strokeStyle = t.accentLight;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      hist.forEach((p, i) => { const x = x0 + i * dx; if (i) ctx.lineTo(x, toY(p.pv)); else ctx.moveTo(x, toY(p.pv)); });
      ctx.lineTo(NOW_X, toY(s.pv));
      ctx.stroke();
    }
    const sp = setpointAt(s, s.t);
    const band = bandAt(s.t);
    const off = outside(s.pv, sp, band) > 0;
    ctx.fillStyle = off ? t.danger : t.accentLight;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(NOW_X, toY(s.pv), 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Gauge: the band and PV right now.
    const gx = 398;
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.beginPath(); ctx.roundRect(gx, PAD, 30, H - 2 * PAD, 8); ctx.fill();
    ctx.fillStyle = 'rgba(163,190,140,0.55)';
    ctx.fillRect(gx, toY(sp + band), 30, toY(sp - band) - toY(sp + band));
    ctx.fillStyle = off ? t.danger : t.fg;
    ctx.fillRect(gx - 4, toY(s.pv) - 2, 38, 4);
    // Accumulated error meter.
    const ex = 444;
    ctx.fillStyle = 'rgba(128,128,128,0.15)';
    ctx.beginPath(); ctx.roundRect(ex, PAD, 16, H - 2 * PAD, 6); ctx.fill();
    const eh = (H - 2 * PAD) * s.error;
    ctx.fillStyle = s.error > 0.7 ? t.danger : s.error > 0.4 ? '#ebcb8b' : t.success;
    ctx.beginPath(); ctx.roundRect(ex, H - PAD - eh, 16, eh, 6); ctx.fill();
    ctx.fillStyle = t.muted;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('PV', gx + 6, PAD - 10);
    ctx.fillText('ERR', ex - 3, PAD - 10);
    ctx.fillText(`${s.t.toFixed(1)} s`, 8, PAD - 10);
    const warn = gustWarning(s);
    if (warn !== null && Math.floor(s.t * 6) % 2 === 0) {
      ctx.fillStyle = '#ebcb8b';
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.fillText(`⚠ Disturbance ${s.gust.dir > 0 ? '↑' : '↓'}`, 110, PAD - 8);
    }
  }, []);

  const sync = () => {
    const s = game.current;
    setHud((h) => (h.score === s.score && h.status === s.status && Math.floor(h.t) === Math.floor(s.t) ? h : { score: s.score, status: s.status, t: s.t }));
  };

  useFrame((dt) => { game.current = step(game.current, dt, thrust.current); draw(); sync(); }, !paused && hud.status !== 'over');
  useEffect(() => { draw(); }, [draw]);
  usePauseWhenHidden(() => { thrust.current = false; if (game.current.status === 'playing') setPaused(true); });

  const hold = (on: boolean) => { thrust.current = on; if (on) setPaused(false); };
  const restart = useCallback(() => { game.current = createGame(); thrust.current = false; setPaused(false); sync(); draw(); }, [draw]);

  useEffect(() => {
    const isThrust = (e: KeyboardEvent) => e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (isThrust(e)) { e.preventDefault(); hold(true); }
      else if ((e.key === 'p' || e.key === 'P') && game.current.status === 'playing') setPaused((p) => !p);
    };
    const up = (e: KeyboardEvent) => { if (isThrust(e)) thrust.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  return (
    <GameFrame game="setpoint" score={hud.score} stats={<>{Math.floor(hud.t)} s on line</>} over={hud.status === 'over'} overTitle="Process tripped" onRestart={restart} aspect={W / H}
      help="You're the controller. Hold (Space, ↑, or press on the board) to drive the process value up; let go and it falls. Stay in the green band: it wanders, narrows and speeds up, and disturbances kick you off. The faint band ahead shows where the setpoint is going. Time outside fills the error meter; when it's full, the process trips."
      controls={
        <Pad>
          <PadButton icon="⏫ Hold to drive up" label="Drive up (hold)" wide onPress={() => hold(true)} onRelease={() => hold(false)} />
        </Pad>
      }>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Setpoint strip chart"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); hold(true); }}
        onPointerUp={() => hold(false)} onPointerCancel={() => hold(false)} />
      {hud.status !== 'over' && (hud.status === 'ready' || paused) && (
        <Overlay dim={0.3} passThrough>
          <Prompt>{paused ? 'Paused — hold to carry on' : 'Hold to drive the process up — keep it in the band'}</Prompt>
        </Overlay>
      )}
    </GameFrame>
  );
}
