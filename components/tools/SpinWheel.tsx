'use client';

import { useRef, useState } from 'react';

export type WheelItem = { id: string; label: string };

/** A fair random index (crypto when available, so picks don't follow Math.random's pattern). */
export function randomIndex(n: number) {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  } catch {
    return Math.floor(Math.random() * n);
  }
}

const SIZE = 200;
const R = 96;
const C = SIZE / 2;

function slicePath(i: number, n: number) {
  if (n === 1) return `M${C} ${C - R} A${R} ${R} 0 1 1 ${C - 0.01} ${C - R} Z`;
  const a0 = ((i / n) * 360 - 90) * (Math.PI / 180);
  const a1 = (((i + 1) / n) * 360 - 90) * (Math.PI / 180);
  const large = 360 / n > 180 ? 1 : 0;
  return `M${C} ${C} L${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A${R} ${R} 0 ${large} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`;
}

const short = (label: string, max: number) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);

/**
 * A prize wheel: the winner is drawn first (fairly), then the wheel spins
 * several turns and eases out with that slice under the pointer.
 */
export default function SpinWheel({ items, onResult }: { items: WheelItem[]; onResult: (item: WheelItem) => void }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const pending = useRef<WheelItem | null>(null);
  const n = items.length;
  const slice = 360 / Math.max(1, n);

  const spin = () => {
    if (spinning || n < 2) return;
    const win = randomIndex(n);
    pending.current = items[win];
    // Land somewhere inside the slice, not dead centre, so it doesn't look staged.
    const jitter = (randomIndex(1000) / 1000 - 0.5) * slice * 0.7;
    const target = -((win + 0.5) * slice + jitter);
    const current = ((rotation % 360) + 360) % 360;
    const delta = ((target - current) % 360 + 360) % 360;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setRotation(rotation + delta + (reduced ? 0 : 360 * (5 + randomIndex(3))));
    if (reduced) { onResult(items[win]); return; }
    setSpinning(true);
  };

  const done = () => {
    setSpinning(false);
    if (pending.current) onResult(pending.current);
    pending.current = null;
  };

  const fontSize = n > 10 ? 6.5 : n > 6 ? 8 : 9.5;
  const maxChars = n > 10 ? 15 : 18;

  return (
    <div className="tl-spin">
      <div className="tl-spin-wheel">
        <span className="tl-spin-pointer" aria-hidden />
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Wheel with ${n} places`}
          style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 4.4s cubic-bezier(0.12, 0.75, 0.15, 1)' : 'none' }}
          onTransitionEnd={done}>
          {items.map((item, i) => {
            const mid = (i + 0.5) * slice;
            return (
              <g key={item.id}>
                <path d={slicePath(i, n)} style={{ fill: `var(--habit-${(i % 8) + 1})` }} stroke="var(--background)" strokeWidth="1.5" />
                <text x={C + 14} y={C} transform={`rotate(${mid - 90} ${C} ${C})`} dominantBaseline="middle" className="tl-spin-label" style={{ fontSize }}>
                  {short(item.label, maxChars)}
                </text>
              </g>
            );
          })}
          <circle cx={C} cy={C} r="11" fill="var(--background)" stroke="var(--surface-border)" strokeWidth="2" />
        </svg>
      </div>
      <button type="button" className="btn btn-primary tl-btn tl-btn-block" onClick={spin} disabled={spinning || n < 2}>
        {spinning ? 'Spinning…' : n < 2 ? 'Add at least two to spin' : '🎡 Spin the wheel'}
      </button>
    </div>
  );
}
