'use client';

import React, { useMemo } from 'react';
import { KART_TRACKS, TrackId } from '@/lib/party/kart-tracks';

/** Top-down course map with the start line and, during a race, every racer's position. */
export default function TrackMinimap({
  trackId,
  karts,
  hazards,
  highlightId,
  size = 180,
}: {
  trackId: TrackId;
  karts?: { id: string; color: string; x: number; z: number; isBot: boolean; rank: number }[];
  hazards?: { id: string; kind: string; x: number; z: number }[];
  highlightId?: string;
  size?: number;
}) {
  const track = KART_TRACKS[trackId] || KART_TRACKS['sunny-circuit'];

  const map = useMemo(() => {
    const xs = track.samples.map((s) => s.x);
    const zs = track.samples.map((s) => s.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.18;
    const start = track.samples[0];
    const half = track.roadWidth * 0.9;
    return {
      span,
      vx: (minX + maxX) / 2 - span / 2,
      vz: (minZ + maxZ) / 2 - span / 2,
      points: track.samples.filter((_, i) => i % 3 === 0).map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`).join(' '),
      startLine: { x1: start.x - start.nx * half, y1: start.z - start.nz * half, x2: start.x + start.nx * half, y2: start.z + start.nz * half },
    };
  }, [track]);

  const unit = map.span / 100; // one percent of the map, so markers read the same at any size
  const bots = (karts || []).filter((k) => k.isBot);
  const humans = (karts || []).filter((k) => !k.isBot);
  const blueShells = (hazards || []).filter((h) => h.kind === 'spiny_shell');

  return (
    <svg
      viewBox={`${map.vx} ${map.vz} ${map.span} ${map.span}`}
      // Fits whichever way its container is tighter; the viewBox keeps the map square
      style={{ display: 'block', width: size, height: size, maxWidth: '100%', maxHeight: '100%', flexShrink: 1, minWidth: 0, minHeight: 0 }}
      aria-hidden
    >
      <polygon points={map.points} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={unit * 9} strokeLinejoin="round" />
      <polygon points={map.points} fill="none" stroke={track.theme.accentColor} strokeWidth={unit * 6.2} strokeLinejoin="round" />
      <polygon points={map.points} fill="none" stroke="#f8fafc" strokeWidth={unit * 3.2} strokeLinejoin="round" />
      <line {...map.startLine} stroke="#0b0f1a" strokeWidth={unit * 2.6} />
      <line {...map.startLine} stroke="#ffffff" strokeWidth={unit * 2.6} strokeDasharray={`${unit * 1.5} ${unit * 1.5}`} />
      {bots.map((k) => (
        <g key={k.id} transform={`translate(${k.x} ${k.z})`}>
          {k.rank === 1 && <circle r={unit * 4.6} fill="none" stroke="#facc15" strokeWidth={unit * 1.1} opacity={0.92} />}
          <circle r={unit * 2.6} fill={k.color} stroke="#0b0f1a" strokeWidth={unit * 0.8} />
        </g>
      ))}
      {humans.map((k) => (
        <g key={k.id} transform={`translate(${k.x} ${k.z})`}>
          {k.rank === 1 && <circle r={unit * 6.8} fill="none" stroke="#facc15" strokeWidth={unit * 1.2} opacity={0.92} />}
          {k.id === highlightId && <circle r={unit * 8.2} fill="none" stroke="#ffffff" strokeWidth={unit * 1.2} opacity={0.85} />}
          <circle r={unit * 5} fill={k.color} stroke="#ffffff" strokeWidth={unit * 1.1} />
          <text textAnchor="middle" dominantBaseline="central" fill="#04060c" fontSize={unit * 6.4} fontWeight={900} style={{ fontFamily: 'sans-serif' }}>
            {k.rank}
          </text>
        </g>
      ))}
      {blueShells.map((h) => (
        <g key={h.id} transform={`translate(${h.x} ${h.z})`}>
          <circle r={unit * 6.5} fill="none" stroke="#38bdf8" strokeWidth={unit * 1.3} opacity={0.85}>
            <animate attributeName="r" values={`${unit * 4.2};${unit * 9.5}`} dur="0.75s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.95;0.1" dur="0.75s" repeatCount="indefinite" />
          </circle>
          <circle r={unit * 3.6} fill="#0284c7" stroke="#e0f2fe" strokeWidth={unit * 1.1} />
        </g>
      ))}
    </svg>
  );
}
