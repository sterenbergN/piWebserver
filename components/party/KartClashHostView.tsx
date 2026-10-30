'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { KART_TRACKS, KartTrack, TRACK_LIST, TrackId } from '@/lib/party/kart-tracks';
import { KartItemType, KartTelemetrySnapshot } from '@/lib/party/kart-physics';
import { KartHeat } from '@/lib/party/games/kart-clash';

export const ITEM_META: Record<KartItemType, { emoji: string; name: string; color: string }> = {
  mushroom: { emoji: '🍄', name: 'Turbo Mushroom', color: '#ef4444' },
  green_shell: { emoji: '🟢', name: 'Green Shell', color: '#22c55e' },
  red_shell: { emoji: '🔴', name: 'Homing Shell', color: '#f97316' },
  banana: { emoji: '🍌', name: 'Banana Peel', color: '#facc15' },
  lightning: { emoji: '⚡', name: 'Lightning Bolt', color: '#38bdf8' },
  star: { emoji: '⭐', name: 'Super Star', color: '#a855f7' },
};

const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const RANK_COLORS = ['#facc15', '#e2e8f0', '#fb923c', '#38bdf8', '#a855f7', '#94a3b8', '#94a3b8', '#94a3b8'];

export function computeSplitGrid(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}

/** 2D SVG Track Minimap showing the multi-layer circuit, start line, and live racer badges. */
export function TrackMinimap({
  trackId,
  karts,
  size = 180,
}: {
  trackId: TrackId;
  karts?: { id: string; name: string; color: string; x: number; z: number; isBot: boolean; rank: number }[];
  size?: number;
}) {
  const track = KART_TRACKS[trackId] || KART_TRACKS['sunny-circuit'];
  const xs = track.samples.map((s) => s.x);
  const zs = track.samples.map((s) => s.z);
  const pad = 68;
  const rawMinX = Math.min(...xs) - pad;
  const rawMaxX = Math.max(...xs) + pad;
  const rawMinZ = Math.min(...zs) - pad;
  const rawMaxZ = Math.max(...zs) + pad;
  const rawW = rawMaxX - rawMinX || 1;
  const rawH = rawMaxZ - rawMinZ || 1;
  const span = Math.max(rawW, rawH, 1);
  const minX = (rawMinX + rawMaxX) * 0.5 - span * 0.5;
  const minZ = (rawMinZ + rawMaxZ) * 0.5 - span * 0.5;

  const pointsAttr = track.samples.map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`).join(' ');
  const start = track.samples[0];
  const bots = (karts || []).filter((k) => k.isBot);
  const humans = (karts || []).filter((k) => !k.isBot);

  return (
    <svg
      viewBox={`${minX} ${minZ} ${span} ${span}`}
      width={size}
      height={size}
      style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.75))' }}
    >
      {/* Radar card background */}
      <rect
        x={minX + span * 0.02}
        y={minZ + span * 0.02}
        width={span * 0.96}
        height={span * 0.96}
        rx={span * 0.08}
        fill="rgba(7, 11, 20, 0.86)"
        stroke="rgba(255, 255, 255, 0.18)"
        strokeWidth={span * 0.012}
      />
      {/* Outer curb casing */}
      <polygon
        points={pointsAttr}
        fill="none"
        stroke="rgba(2, 6, 23, 0.96)"
        strokeWidth={38}
        strokeLinejoin="round"
      />
      {/* Main asphalt road */}
      <polygon
        points={pointsAttr}
        fill="none"
        stroke="#334155"
        strokeWidth={28}
        strokeLinejoin="round"
      />
      {/* Theme accent racing groove */}
      <polygon
        points={pointsAttr}
        fill="none"
        stroke={track.theme.accentColor}
        strokeWidth={13}
        strokeOpacity={0.88}
        strokeLinejoin="round"
      />
      {/* Dashed white centerline */}
      <polygon
        points={pointsAttr}
        fill="none"
        stroke="rgba(255, 255, 255, 0.65)"
        strokeWidth={3.2}
        strokeDasharray="14 14"
        strokeLinejoin="round"
      />
      {/* Checkered Start / Finish Line */}
      {start && (
        <g>
          <line
            x1={start.x - start.nx * 20}
            y1={start.z - start.nz * 20}
            x2={start.x + start.nx * 20}
            y2={start.z + start.nz * 20}
            stroke="#ffffff"
            strokeWidth={9}
            strokeLinecap="round"
          />
          <line
            x1={start.x - start.nx * 20}
            y1={start.z - start.nz * 20}
            x2={start.x + start.nx * 20}
            y2={start.z + start.nz * 20}
            stroke="#0f172a"
            strokeWidth={9}
            strokeDasharray="7 7"
            strokeLinecap="round"
          />
        </g>
      )}
      {/* AI Bot Dots (rendered underneath human racers) */}
      {bots.map((k) => (
        <g key={k.id} transform={`translate(${k.x}, ${k.z})`}>
          <circle r={11} fill={k.color} stroke="#020617" strokeWidth={3.5} opacity={0.88} />
        </g>
      ))}
      {/* Human Racer Badges with Live Rank */}
      {humans.map((k) => (
        <g key={k.id} transform={`translate(${k.x}, ${k.z})`}>
          <circle r={20} fill={k.color} stroke="#ffffff" strokeWidth={5.5} />
          <text
            x={0}
            y={7}
            textAnchor="middle"
            fill="#020617"
            fontSize={21}
            fontWeight={900}
            style={{ fontFamily: 'sans-serif' }}
          >
            {k.rank}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Three.js 3D Track & Kart Scene Builder ────────────────────────────────────

function buildContinuousStripMesh(
  samples: KartTrack['samples'],
  innerOffset: number,
  outerOffset: number,
  yBottom: number,
  yTop: number,
  colorA: THREE.Color,
  colorB: THREE.Color,
  stripePeriod: number,
): THREE.Mesh {
  const m = samples.length;
  const positions: number[] = [];
  const colors: number[] = [];

  const pushQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    col: THREE.Color,
  ) => {
    positions.push(
      ax, ay, az, bx, by, bz, cx, cy, cz,
      bx, by, bz, dx, dy, dz, cx, cy, cz,
    );
    for (let k = 0; k < 6; k++) {
      colors.push(col.r, col.g, col.b);
    }
  };

  for (let i = 0; i < m; i++) {
    const s0 = samples[i];
    const s1 = samples[(i + 1) % m];
    const col = Math.floor(i / stripePeriod) % 2 === 0 ? colorA : colorB;

    const i0x = s0.x + s0.nx * innerOffset;
    const i0z = s0.z + s0.nz * innerOffset;
    const o0x = s0.x + s0.nx * outerOffset;
    const o0z = s0.z + s0.nz * outerOffset;

    const i1x = s1.x + s1.nx * innerOffset;
    const i1z = s1.z + s1.nz * innerOffset;
    const o1x = s1.x + s1.nx * outerOffset;
    const o1z = s1.z + s1.nz * outerOffset;

    // Top face
    pushQuad(
      i0x, yTop, i0z,
      o0x, yTop, o0z,
      i1x, yTop, i1z,
      o1x, yTop, o1z,
      col,
    );
    // Inner vertical face (facing road)
    pushQuad(
      i0x, yBottom, i0z,
      i0x, yTop, i0z,
      i1x, yBottom, i1z,
      i1x, yTop, i1z,
      col,
    );
    // Outer vertical face
    pushQuad(
      o0x, yTop, o0z,
      o0x, yBottom, o0z,
      o1x, yTop, o1z,
      o1x, yBottom, o1z,
      col,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
}

function buildTrackMeshGroup(track: KartTrack): {
  group: THREE.Group;
  itemBoxMeshes: Map<string, THREE.Mesh>;
} {
  const group = new THREE.Group();
  const itemBoxMeshes = new Map<string, THREE.Mesh>();

  // Ground plane lowered well below road to prevent any Z-fighting
  const groundGeo = new THREE.PlaneGeometry(1800, 1800);
  const groundMat = new THREE.MeshLambertMaterial({ color: track.theme.groundColor });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.35;
  group.add(ground);

  const samples = track.samples;
  const m = samples.length;
  const halfW = track.roadWidth * 0.5;
  const curbW = 2.4;
  const shoulderW = track.wallWidth + 2.5;

  // 1. Continuous Shoulder / Gravel Apron Ribbon under the track & walls
  const shoulderPositions: number[] = [];
  const shoulderIndices: number[] = [];
  for (let i = 0; i <= m; i++) {
    const s = samples[i % m];
    const lx = s.x - s.nx * shoulderW;
    const lz = s.z - s.nz * shoulderW;
    const rx = s.x + s.nx * shoulderW;
    const rz = s.z + s.nz * shoulderW;
    shoulderPositions.push(lx, 0.01, lz, rx, 0.01, rz);
    if (i < m) {
      const v = i * 2;
      shoulderIndices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const shoulderGeo = new THREE.BufferGeometry();
  shoulderGeo.setAttribute('position', new THREE.Float32BufferAttribute(shoulderPositions, 3));
  shoulderGeo.setIndex(shoulderIndices);
  shoulderGeo.computeVertexNormals();
  const shoulderColor = new THREE.Color(track.theme.groundColor).lerp(new THREE.Color('#0f172a'), 0.38);
  group.add(
    new THREE.Mesh(
      shoulderGeo,
      new THREE.MeshLambertMaterial({ color: shoulderColor, side: THREE.DoubleSide }),
    ),
  );

  // 2. Multi-Lane Sculpted Road Ribbon
  const roadPositions: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];

  const rainbowPalette = [
    new THREE.Color('#ef4444'),
    new THREE.Color('#f97316'),
    new THREE.Color('#facc15'),
    new THREE.Color('#22c55e'),
    new THREE.Color('#06b6d4'),
    new THREE.Color('#a855f7'),
    new THREE.Color('#ec4899'),
  ];
  const baseRoadColor = new THREE.Color(track.theme.roadColor);
  const edgeRoadColor = baseRoadColor.clone().multiplyScalar(0.82);
  const centerGrooveColor = baseRoadColor.clone().lerp(new THREE.Color(track.theme.accentColor), 0.12);

  for (let i = 0; i <= m; i++) {
    const s = samples[i % m];
    const offsets = [-halfW, -halfW * 0.45, halfW * 0.45, halfW];
    for (let j = 0; j < 4; j++) {
      const off = offsets[j];
      roadPositions.push(s.x + s.nx * off, 0.12, s.z + s.nz * off);
      if (track.theme.rainbowRoad) {
        const rc = rainbowPalette[(i + j) % rainbowPalette.length];
        roadColors.push(rc.r, rc.g, rc.b);
      } else {
        const col = j === 0 || j === 3 ? edgeRoadColor : centerGrooveColor;
        roadColors.push(col.r, col.g, col.b);
      }
    }

    if (i < m) {
      const row0 = i * 4;
      const row1 = (i + 1) * 4;
      for (let j = 0; j < 3; j++) {
        const a = row0 + j;
        const b = row0 + j + 1;
        const c = row1 + j;
        const d = row1 + j + 1;
        roadIndices.push(a, b, c, b, d, c);
      }
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(roadColors, 3));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(roadGeo, roadMat));

  // 3. Continuous Extruded 3D Left & Right Rumble Curbs (Zero gaps)
  const curbColorA = new THREE.Color(track.theme.curbColorA);
  const curbColorB = new THREE.Color(track.theme.curbColorB);
  group.add(
    buildContinuousStripMesh(samples, -halfW - curbW, -halfW, 0.08, 0.34, curbColorA, curbColorB, 2),
  );
  group.add(
    buildContinuousStripMesh(samples, halfW, halfW + curbW, 0.08, 0.34, curbColorA, curbColorB, 2),
  );

  // 4. Continuous 3D Outer Track Barrier Walls at +-wallWidth so boundaries are unmistakable
  const wallInner = track.wallWidth;
  const wallOuter = track.wallWidth + 1.35;
  const wallColorA = new THREE.Color(track.theme.curbColorA).lerp(new THREE.Color('#0f172a'), 0.2);
  const wallColorB = new THREE.Color(track.theme.curbColorB).lerp(new THREE.Color('#1e293b'), 0.25);
  group.add(
    buildContinuousStripMesh(samples, -wallOuter, -wallInner, 0.0, 1.65, wallColorA, wallColorB, 3),
  );
  group.add(
    buildContinuousStripMesh(samples, wallInner, wallOuter, 0.0, 1.65, wallColorA, wallColorB, 3),
  );

  // 5. Centerline & Edge Racing Stripes
  const dashGeo = new THREE.PlaneGeometry(0.95, 3.6);
  const dashMat = new THREE.MeshBasicMaterial({ color: track.theme.roadStripeColor, side: THREE.DoubleSide });
  for (let i = 0; i < m; i += 3) {
    const s = samples[i];
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -s.angle;
    dash.position.set(s.x, 0.16, s.z);
    group.add(dash);
  }

  // 6. Automatic 3D Turn Chevron Warning Signs on the outside of sharp turns
  const signBoardGeo = new THREE.BoxGeometry(3.2, 2.2, 0.35);
  const signBoardMat = new THREE.MeshLambertMaterial({ color: '#0f172a' });
  const signArrowGeo = new THREE.ConeGeometry(0.85, 1.6, 3);
  const signArrowMat = new THREE.MeshBasicMaterial({ color: '#facc15' });
  const signPostGeo = new THREE.CylinderGeometry(0.18, 0.22, 2.6, 8);
  const signPostMat = new THREE.MeshLambertMaterial({ color: '#64748b' });

  for (let i = 0; i < m; i += 5) {
    const s = samples[i];
    if (Math.abs(s.curvature) < 0.011) continue;
    // Place sign on the OUTSIDE of the curve
    const outsideSign = s.curvature > 0 ? -1 : 1;
    const dist = halfW + curbW + 2.8;
    const sx = s.x + s.nx * outsideSign * dist;
    const sz = s.z + s.nz * outsideSign * dist;

    const signGroup = new THREE.Group();
    signGroup.position.set(sx, 0, sz);
    // Face approaching karts
    signGroup.rotation.y = s.angle + Math.PI + outsideSign * 0.35;

    const post = new THREE.Mesh(signPostGeo, signPostMat);
    post.position.y = 1.3;
    const board = new THREE.Mesh(signBoardGeo, signBoardMat);
    board.position.y = 2.6;
    const arrow = new THREE.Mesh(signArrowGeo, signArrowMat);
    arrow.position.set(0, 2.6, 0.22);
    // Point arrow into the turn direction
    arrow.rotation.z = s.curvature > 0 ? -Math.PI / 2 : Math.PI / 2;

    signGroup.add(post, board, arrow);
    group.add(signGroup);
  }

  // 7. Start / Finish Checkered Line, Overhead Gantry & Trackside Grandstand
  const startSample = samples[0];
  if (startSample) {
    const finishGroup = new THREE.Group();
    finishGroup.position.set(startSample.x, 0, startSample.z);
    finishGroup.rotation.y = startSample.angle;

    // Checkered road strip
    const tileCount = 14;
    const tileW = track.roadWidth / tileCount;
    const tileGeo = new THREE.PlaneGeometry(tileW, 2.4);
    const whiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const blackMat = new THREE.MeshBasicMaterial({ color: '#0f172a', side: THREE.DoubleSide });
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < tileCount; col++) {
        const tile = new THREE.Mesh(tileGeo, (row + col) % 2 === 0 ? whiteMat : blackMat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(-halfW + tileW * (col + 0.5), 0.17, (row - 0.5) * 2.4);
        finishGroup.add(tile);
      }
    }

    // Gantry pillars & top banner
    const pillarGeo = new THREE.CylinderGeometry(0.95, 1.15, 15, 12);
    const pillarMat = new THREE.MeshLambertMaterial({ color: track.theme.accentColor });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-halfW - 1.8, 7.5, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(halfW + 1.8, 7.5, 0);
    const bannerGeo = new THREE.BoxGeometry(track.roadWidth + 6, 2.8, 1.6);
    const bannerMat = new THREE.MeshLambertMaterial({ color: '#facc15' });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 14.0, 0);
    finishGroup.add(leftPillar, rightPillar, banner);

    // Trackside Grandstands on both sides of start straight
    for (const side of [-1, 1]) {
      const standGroup = new THREE.Group();
      standGroup.position.set(side * (track.wallWidth + 7.5), 0, -6);
      const tierColors = ['#ef4444', '#38bdf8', '#facc15'];
      for (let t = 0; t < 3; t++) {
        const tier = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 1.8 * (t + 1), 26),
          new THREE.MeshLambertMaterial({ color: tierColors[t] }),
        );
        tier.position.set(side * t * 2.8, 0.9 * (t + 1), 0);
        standGroup.add(tier);
      }
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(10, 0.6, 28),
        new THREE.MeshLambertMaterial({ color: '#1e293b' }),
      );
      roof.position.set(side * 2.5, 8.2, 0);
      standGroup.add(roof);
      finishGroup.add(standGroup);
    }

    group.add(finishGroup);
  }

  // 8. Boost Pads
  const padGeo = new THREE.PlaneGeometry(5.4, 7.6);
  const padMat = new THREE.MeshBasicMaterial({ color: '#f97316', side: THREE.DoubleSide });
  const padInnerGeo = new THREE.PlaneGeometry(3.6, 5.0);
  const padInnerMat = new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide });
  for (const pad of track.boostPads) {
    const padGroup = new THREE.Group();
    padGroup.position.set(pad.x, 0.18, pad.z);
    padGroup.rotation.y = pad.angle;

    const outer = new THREE.Mesh(padGeo, padMat);
    outer.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(padInnerGeo, padInnerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.02;
    padGroup.add(outer, inner);
    group.add(padGroup);
  }

  // 9. Item Boxes
  const boxGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const boxMat = new THREE.MeshLambertMaterial({
    color: '#38bdf8',
    emissive: '#a855f7',
    emissiveIntensity: 0.48,
  });
  for (const b of track.itemBoxes) {
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(b.x, 2.2, b.z);
    group.add(mesh);
    itemBoxMeshes.set(b.id, mesh);
  }

  // 10. Scenery Props
  for (const prop of track.scenery) {
    const propGroup = new THREE.Group();
    propGroup.position.set(prop.x, 0, prop.z);
    propGroup.scale.setScalar(prop.scale);

    if (prop.kind === 'palm') {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.8, 9, 8),
        new THREE.MeshLambertMaterial({ color: '#92400e' }),
      );
      trunk.position.y = 4.5;
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(3.8, 8, 6),
        new THREE.MeshLambertMaterial({ color: prop.color }),
      );
      crown.position.y = 9.2;
      crown.scale.y = 0.55;
      propGroup.add(trunk, crown);
    } else if (prop.kind === 'cactus') {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.95, 8, 8),
        new THREE.MeshLambertMaterial({ color: prop.color }),
      );
      stem.position.y = 4;
      propGroup.add(stem);
    } else if (prop.kind === 'pine') {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.7, 3, 8),
        new THREE.MeshLambertMaterial({ color: '#78350f' }),
      );
      trunk.position.y = 1.5;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(3.8, 10.5, 8),
        new THREE.MeshLambertMaterial({ color: prop.color }),
      );
      cone.position.y = 7;
      propGroup.add(trunk, cone);
    } else {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 14, 8),
        new THREE.MeshLambertMaterial({
          color: prop.color,
          emissive: prop.color,
          emissiveIntensity: 0.55,
        }),
      );
      pillar.position.y = 7;
      propGroup.add(pillar);
    }
    group.add(propGroup);
  }

  return { group, itemBoxMeshes };
}

interface KartMeshRefs {
  root: THREE.Group;
  bodyMat: THREE.MeshLambertMaterial;
  baseColor: THREE.Color;
  flame: THREE.Mesh;
  sparkLeft: THREE.Mesh;
  sparkRight: THREE.Mesh;
  sparkMat: THREE.MeshBasicMaterial;
  currX: number;
  currZ: number;
  currAngle: number;
  targetX: number;
  targetZ: number;
  targetAngle: number;
}

function createKartMesh(colorHex: string, x: number, z: number, angle: number): KartMeshRefs {
  const root = new THREE.Group();
  root.position.set(x, 0.12, z);
  root.rotation.y = angle;

  const baseColor = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
  const darkTrimMat = new THREE.MeshLambertMaterial({ color: '#0f172a' });
  const silverMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1' });

  // Main sculpted chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.58, 3.5), bodyMat);
  chassis.position.y = 0.52;
  root.add(chassis);

  // Left & Right aerodynamic sidepods
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.44, 2.1), bodyMat);
    pod.position.set(side * 1.05, 0.46, -0.1);
    root.add(pod);
  }

  // Sloped nose cone + front wing
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 1.35), bodyMat);
  nose.position.set(0, 0.44, 2.05);
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.14, 0.55), darkTrimMat);
  frontWing.position.set(0, 0.3, 2.55);
  root.add(nose, frontWing);

  // Rear engine block + high spoiler wing
  const engine = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.9), silverMat);
  engine.position.set(0, 0.85, -1.25);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.18, 0.65), darkTrimMat);
  spoiler.position.set(0, 1.32, -1.65);
  root.add(engine, spoiler);

  // Driver torso, helmet & visor
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.75, 10), bodyMat);
  torso.position.set(0, 1.02, -0.15);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 14, 12),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  );
  helmet.position.set(0, 1.48, -0.12);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.28, 0.45),
    new THREE.MeshLambertMaterial({ color: '#020617' }),
  );
  visor.position.set(0, 1.5, 0.32);
  root.add(torso, helmet, visor);

  // 4 Wide Racing Tires + Silver Rims
  const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.52, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.55, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#111827' });
  const wheelOffsets: [number, number, number][] = [
    [-1.25, 0.52, 1.25],
    [1.25, 0.52, 1.25],
    [-1.3, 0.52, -1.25],
    [1.3, 0.52, -1.25],
  ];
  for (const [wx, wy, wz] of wheelOffsets) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    const rim = new THREE.Mesh(rimGeo, silverMat);
    rim.position.set(wx, wy, wz);
    root.add(w, rim);
  }

  // Exhaust boost flame
  const flameGeo = new THREE.ConeGeometry(0.62, 2.4, 8);
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: '#f97316' });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, 0.65, -2.8);
  flame.visible = false;
  root.add(flame);

  // Drift sparks behind rear tires (positioned behind rear wheels for clear chase-cam visibility)
  const sparkGeo = new THREE.SphereGeometry(0.55, 10, 10);
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
  const sparkLeft = new THREE.Mesh(sparkGeo, sparkMat);
  sparkLeft.position.set(-1.25, 0.48, -2.05);
  sparkLeft.visible = false;
  const sparkRight = new THREE.Mesh(sparkGeo, sparkMat);
  sparkRight.position.set(1.25, 0.48, -2.05);
  sparkRight.visible = false;
  root.add(sparkLeft, sparkRight);

  return {
    root,
    bodyMat,
    baseColor,
    flame,
    sparkLeft,
    sparkRight,
    sparkMat,
    currX: x,
    currZ: z,
    currAngle: angle,
    targetX: x,
    targetZ: z,
    targetAngle: angle,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// ─── Main Host View Component ──────────────────────────────────────────────────

export default function KartClashHostView({
  state,
  roomCode,
  secondsLeft,
  pct,
  sendAction,
}: {
  state: any;
  roomCode: string;
  secondsLeft: number | null;
  pct: number;
  sendAction: (action: any) => void;
}) {
  const hd = state.hostData || {};
  const [selectedPlayerForSwap, setSelectedPlayerForSwap] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<KartTelemetrySnapshot | null>(hd.initialSnapshot || null);
  const snapshotRef = useRef<KartTelemetrySnapshot | null>(hd.initialSnapshot || null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Subscribe to real-time 30Hz kart telemetry during RACING
  useEffect(() => {
    if (state.phase !== 'RACING') return;
    if (hd.initialSnapshot && !snapshotRef.current) {
      snapshotRef.current = hd.initialSnapshot;
      setSnapshot(hd.initialSnapshot);
    }
    const sse = new EventSource(`/api/party/stream/kart?roomCode=${encodeURIComponent(roomCode)}&role=host`);
    sse.onmessage = (ev) => {
      if (!ev.data || ev.data === ':') return;
      try {
        const data: KartTelemetrySnapshot = JSON.parse(ev.data);
        snapshotRef.current = data;
        setSnapshot(data);
      } catch {
        // ignore malformed tick
      }
    };
    return () => sse.close();
  }, [state.phase, roomCode, hd.initialSnapshot]);

  // Three.js Split-Screen 60fps Renderer during RACING
  useEffect(() => {
    if (state.phase !== 'RACING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const trackId: TrackId = hd.trackId || 'sunny-circuit';
    const track = KART_TRACKS[trackId] || KART_TRACKS['sunny-circuit'];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setScissorTest(true);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(track.theme.skyTop);
    scene.fog = new THREE.FogExp2(track.theme.skyBottom, 0.0022);

    const ambient = new THREE.AmbientLight('#ffffff', 0.85);
    const dirLight = new THREE.DirectionalLight('#fffbeb', 1.15);
    dirLight.position.set(120, 220, 90);
    scene.add(ambient, dirLight);

    const { group: trackGroup, itemBoxMeshes } = buildTrackMeshGroup(track);
    scene.add(trackGroup);

    const kartMeshes = new Map<string, KartMeshRefs>();
    const hazardMeshes = new Map<string, THREE.Mesh>();
    const cameraPool: THREE.PerspectiveCamera[] = [];

    let animId = 0;
    const clock = new THREE.Clock();

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const dt = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const snap = snapshotRef.current;
      if (!snap) return;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width * renderer.getPixelRatio() || canvas.height !== height * renderer.getPixelRatio()) {
        renderer.setSize(width, height, false);
      }

      // Rotate & toggle item boxes
      for (const box of snap.itemBoxes) {
        let mesh = itemBoxMeshes.get(box.id);
        if (!mesh && box.active) {
          mesh = new THREE.Mesh(
            new THREE.BoxGeometry(2.3, 2.3, 2.3),
            new THREE.MeshLambertMaterial({ color: '#facc15', emissive: '#ec4899', emissiveIntensity: 0.5 }),
          );
          mesh.position.set(box.x, 2.1, box.z);
          scene.add(mesh);
          itemBoxMeshes.set(box.id, mesh);
        }
        if (mesh) {
          mesh.visible = box.active;
          mesh.rotation.y = elapsed * 2.2;
          mesh.rotation.x = elapsed * 1.4;
          mesh.position.y = 2.0 + Math.sin(elapsed * 3.5 + box.x) * 0.35;
        }
      }

      // Update / interpolate karts
      for (const k of snap.karts) {
        let ref = kartMeshes.get(k.id);
        if (!ref) {
          ref = createKartMesh(k.color, k.x, k.z, k.angle);
          scene.add(ref.root);
          kartMeshes.set(k.id, ref);
        }
        ref.targetX = k.x;
        ref.targetZ = k.z;
        ref.targetAngle = k.angle;

        const blend = Math.min(1, dt * 18);
        ref.currX += (ref.targetX - ref.currX) * blend;
        ref.currZ += (ref.targetZ - ref.currZ) * blend;
        ref.currAngle = lerpAngle(ref.currAngle, ref.targetAngle, blend);

        const charge = k.driftCharge ?? 0;
        const hopY = k.drifting && charge > 0 && charge < 22
          ? Math.sin((charge / 22) * Math.PI) * 0.55
          : 0;
        ref.root.position.set(ref.currX, 0.12 + hopY, ref.currZ);
        const spinYaw = k.spinOutTimer > 0 ? elapsed * 16 : 0;
        const driftYaw = k.drifting ? -k.driftDir * 0.42 : 0;
        ref.root.rotation.y = ref.currAngle + driftYaw + spinYaw;
        ref.root.rotation.z = k.drifting ? k.driftDir * 0.1 : 0;

        const targetScale = k.shrinkTimer > 0 ? 0.58 : 1.0;
        ref.root.scale.setScalar(targetScale);

        if (k.starTimer > 0) {
          ref.bodyMat.color.setHSL((elapsed * 2.5) % 1, 0.9, 0.55);
        } else {
          ref.bodyMat.color.copy(ref.baseColor);
        }

        ref.flame.visible = k.boostTimer > 0 || k.starTimer > 0;
        if (ref.flame.visible) {
          ref.flame.scale.setScalar(0.95 + Math.sin(elapsed * 40) * 0.3);
        }

        const showSparks = k.drifting;
        ref.sparkLeft.visible = showSparks;
        ref.sparkRight.visible = showSparks;
        if (showSparks) {
          ref.sparkMat.color.set(
            k.driftLevel === 2 ? '#f97316' : k.driftLevel === 1 ? '#38bdf8' : '#fde047',
          );
          const baseScale = k.driftLevel === 2 ? 1.65 : k.driftLevel === 1 ? 1.25 : 0.8;
          const pulse = baseScale + Math.sin(elapsed * 34) * 0.3;
          ref.sparkLeft.scale.setScalar(pulse);
          ref.sparkRight.scale.setScalar(pulse);
        }
      }

      // Sync active hazards (shells & bananas)
      const activeHazardIds = new Set(snap.hazards.map((h) => h.id));
      for (const [id, mesh] of hazardMeshes.entries()) {
        if (!activeHazardIds.has(id)) {
          scene.remove(mesh);
          hazardMeshes.delete(id);
        }
      }
      for (const h of snap.hazards) {
        let mesh = hazardMeshes.get(h.id);
        if (!mesh) {
          const geo = h.kind === 'banana'
            ? new THREE.ConeGeometry(0.95, 1.9, 8)
            : new THREE.SphereGeometry(1.15, 12, 10);
          const color = h.kind === 'banana' ? '#facc15' : h.kind === 'red_shell' ? '#ef4444' : '#22c55e';
          const mat = new THREE.MeshLambertMaterial({ color });
          mesh = new THREE.Mesh(geo, mat);
          scene.add(mesh);
          hazardMeshes.set(h.id, mesh);
        }
        mesh.position.set(h.x, 0.95, h.z);
        mesh.rotation.y = elapsed * 6;
      }

      // Render Split-Screen Viewports for active human racers
      const humanKarts = snap.karts.filter((k) => !k.isBot);
      const viewportKarts = humanKarts.length > 0 ? humanKarts : snap.karts.slice(0, 1);
      const { cols, rows } = computeSplitGrid(viewportKarts.length);
      const tileW = Math.floor(width / cols);
      const tileH = Math.floor(height / rows);

      // Clear full screen first
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.clear();

      viewportKarts.forEach((k, idx) => {
        while (cameraPool.length <= idx) {
          cameraPool.push(new THREE.PerspectiveCamera(65, 16 / 9, 0.5, 950));
        }
        const cam = cameraPool[idx];
        cam.aspect = Math.max(0.5, tileW / Math.max(1, tileH));
        cam.updateProjectionMatrix();

        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const vx = col * tileW;
        // WebGL viewport Y=0 is at the bottom of the canvas
        const vy = height - (row + 1) * tileH;

        const ref = kartMeshes.get(k.id);
        const kx = ref ? ref.currX : k.x;
        const kz = ref ? ref.currZ : k.z;
        const ka = ref ? ref.currAngle : k.angle;

        const chaseDist = k.boostTimer > 0 ? 15.2 : 13.4;
        const chaseHeight = 6.9;
        const camX = kx - Math.sin(ka) * chaseDist;
        const camZ = kz - Math.cos(ka) * chaseDist;
        cam.position.set(camX, chaseHeight, camZ);
        cam.lookAt(
          kx + Math.sin(ka) * 16.5,
          1.6,
          kz + Math.cos(ka) * 16.5,
        );

        renderer.setViewport(vx, Math.max(0, vy), tileW, tileH);
        renderer.setScissor(vx, Math.max(0, vy), tileW, tileH);
        renderer.render(scene, cam);
      });
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, [state.phase, hd.trackId]);

  // ─── Phase 1: HEAT_SETUP (Host-Controlled Tournament Heat Board) ─────────────
  if (state.phase === 'HEAT_SETUP') {
    const heats: KartHeat[] = hd.heats || [];
    const activePlayers = (state.playerOrder || [])
      .map((pid: string) => state.players?.[pid])
      .filter((p: any) => p && !p.left);

    return (
      <div className="phase-enter" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'rgba(255,255,255,0.04)', border: '1.5px solid var(--party-border)', borderRadius: '18px', padding: '1rem 1.35rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-cyan)' }}>
              🔥 Kart Clash Tournament Board
            </div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.8rem', fontWeight: 900 }}>
              Set Up Race Heats &amp; Bracket
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)' }}>
              {selectedPlayerForSwap
                ? `✋ Selected ${state.players?.[selectedPlayerForSwap]?.name} — click another player to swap heats, or click "+ Assign Here" on any pending heat!`
                : 'Tip: Click any player in a pending heat to manually move or swap them, or use Randomize Heats.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(0,0,0,0.35)', padding: '0.35rem 0.65rem', borderRadius: '12px', border: '1px solid var(--party-border)' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)' }}>Racers/Heat:</span>
              {[2, 4, 8].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => sendAction({ type: 'SET_KART_CONFIG', heatSize: sz })}
                  style={{
                    background: hd.heatSize === sz ? 'var(--party-yellow)' : 'transparent',
                    color: hd.heatSize === sz ? '#000' : '#fff',
                    border: '1.5px solid var(--party-yellow)',
                    borderRadius: '8px',
                    padding: '0.2rem 0.55rem',
                    fontWeight: 900,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  {sz}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => sendAction({ type: 'SET_KART_CONFIG', aiBots: !hd.aiBots })}
              style={{
                background: hd.aiBots ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${hd.aiBots ? 'var(--party-green)' : 'var(--party-border)'}`,
                color: hd.aiBots ? 'var(--party-green)' : 'var(--party-text-muted)',
                borderRadius: '10px',
                padding: '0.45rem 0.8rem',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              🤖 AI Bots: {hd.aiBots ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() => { setSelectedPlayerForSwap(null); sendAction({ type: 'RANDOMIZE_HEATS' }); }}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.84rem', borderColor: 'var(--party-cyan)', color: 'var(--party-cyan)' }}
            >
              🎲 Randomize Heats
            </button>

            <button
              type="button"
              onClick={() => sendAction({ type: 'ADD_CUSTOM_HEAT' })}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.84rem' }}
            >
              ➕ Add Heat
            </button>
          </div>
        </div>

        {/* Heats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1rem' }}>
          {heats.map((heat) => {
            const isNext = heat.id === hd.nextHeatId;
            const isFinal = heat.stage === 'final';
            return (
              <div
                key={heat.id}
                className="party-card"
                style={{
                  maxWidth: 'none',
                  padding: '1.1rem',
                  border: `2.5px solid ${
                    heat.status === 'completed'
                      ? 'var(--party-green)'
                      : isFinal
                      ? 'var(--party-yellow)'
                      : isNext
                      ? 'var(--party-cyan)'
                      : 'var(--party-border)'
                  }`,
                  background: isFinal ? 'rgba(250, 204, 21, 0.07)' : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '1.15rem', color: isFinal ? 'var(--party-yellow)' : '#fff' }}>
                      {heat.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)', fontWeight: 700 }}>
                      {heat.status === 'completed'
                        ? `✅ Completed · ${KART_TRACKS[heat.trackId || 'sunny-circuit']?.name}`
                        : `${heat.playerIds.length} Racer${heat.playerIds.length === 1 ? '' : 's'} (${computeSplitGrid(heat.playerIds.length).cols}×${computeSplitGrid(heat.playerIds.length).rows} Split-Screen)`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    {heat.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => sendAction({ type: 'START_HEAT', heatId: heat.id })}
                        className="party-btn party-btn-primary party-btn-inline"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        🏁 Race This Heat
                      </button>
                    )}
                    {heat.status === 'pending' && heats.length > 1 && (
                      <button
                        type="button"
                        onClick={() => sendAction({ type: 'REMOVE_HEAT', heatId: heat.id })}
                        title="Remove Heat"
                        style={{ background: 'transparent', border: 'none', color: 'var(--party-text-muted)', cursor: 'pointer', fontWeight: 900 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Players in this Heat */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {heat.playerIds.map((pid, idx) => {
                    const p = state.players?.[pid];
                    if (!p) return null;
                    const isSelected = selectedPlayerForSwap === pid;
                    const qualified = heat.qualifiers?.includes(pid);
                    const standingRow = heat.standings?.find((s) => s.id === pid);

                    return (
                      <div
                        key={pid}
                        onClick={() => {
                          if (heat.status !== 'pending') return;
                          if (!selectedPlayerForSwap) {
                            setSelectedPlayerForSwap(pid);
                          } else if (selectedPlayerForSwap === pid) {
                            setSelectedPlayerForSwap(null);
                          } else {
                            sendAction({
                              type: 'ASSIGN_HEAT_PLAYER',
                              playerId: selectedPlayerForSwap,
                              targetHeatId: heat.id,
                              swapWithPlayerId: pid,
                            });
                            setSelectedPlayerForSwap(null);
                          }
                        }}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '10px',
                          background: isSelected ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255,255,255,0.05)',
                          border: `2px solid ${isSelected ? 'var(--party-cyan)' : p.avatarColor}`,
                          cursor: heat.status === 'pending' ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{ fontWeight: 800, color: p.avatarColor }}>
                          {heat.status === 'completed' && standingRow
                            ? `${['🥇', '🥈', '🥉'][standingRow.rank - 1] || `#${standingRow.rank}`} `
                            : `${idx + 1}. `}
                          {p.avatar} {p.name}
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 900, color: qualified ? 'var(--party-green)' : 'var(--party-text-muted)' }}>
                          {heat.status === 'completed'
                            ? qualified
                              ? '✅ QUALIFIED'
                              : `+${standingRow?.points || 0} pts`
                            : isSelected
                            ? '✋ Selected'
                            : 'Tap to swap'}
                        </span>
                      </div>
                    );
                  })}

                  {heat.status === 'pending' && selectedPlayerForSwap && !heat.playerIds.includes(selectedPlayerForSwap) && heat.playerIds.length < 8 && (
                    <button
                      type="button"
                      onClick={() => {
                        sendAction({
                          type: 'ASSIGN_HEAT_PLAYER',
                          playerId: selectedPlayerForSwap,
                          targetHeatId: heat.id,
                        });
                        setSelectedPlayerForSwap(null);
                      }}
                      style={{
                        background: 'rgba(6, 182, 212, 0.15)',
                        border: '1.5px dashed var(--party-cyan)',
                        borderRadius: '10px',
                        padding: '0.45rem',
                        color: 'var(--party-cyan)',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      ➕ Move {state.players?.[selectedPlayerForSwap]?.name} to {heat.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Pool of All Players to Assign to Next Pending Heat */}
        {heats.some((h) => h.status === 'pending') && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--party-border)', borderRadius: '14px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)' }}>
              All Room Racers (tap to select &amp; assign):
            </span>
            {activePlayers.map((p: any) => {
              const sel = selectedPlayerForSwap === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlayerForSwap(sel ? null : p.id)}
                  style={{
                    background: sel ? 'var(--party-cyan)' : 'rgba(255,255,255,0.06)',
                    color: sel ? '#000' : p.avatarColor,
                    border: `1.5px solid ${sel ? '#fff' : p.avatarColor}`,
                    borderRadius: '999px',
                    padding: '0.22rem 0.65rem',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {p.avatar} {p.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Bottom Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
          {hd.nextHeatId && (
            <button
              type="button"
              onClick={() => sendAction({ type: 'START_HEAT', heatId: hd.nextHeatId })}
              className="party-btn party-btn-primary party-btn-huge"
            >
              🏁 Start {heats.find((h) => h.id === hd.nextHeatId)?.name || 'Next Heat'}!
            </button>
          )}
          {hd.canBuildFinals && (
            <>
              <button
                type="button"
                onClick={() => sendAction({ type: 'BUILD_FINALS_HEAT', includeConsolation: false })}
                className="party-btn party-btn-yellow party-btn-inline"
                style={{ fontSize: '1.05rem', padding: '0.85rem 1.4rem' }}
              >
                🏆 Seed Championship Final
              </button>
              <button
                type="button"
                onClick={() => sendAction({ type: 'BUILD_FINALS_HEAT', includeConsolation: true })}
                className="party-btn party-btn-outline party-btn-inline"
                style={{ fontSize: '0.95rem', padding: '0.85rem 1.2rem', borderColor: 'var(--party-cyan)', color: 'var(--party-cyan)' }}
              >
                💥 Seed Consolation + Final
              </button>
            </>
          )}
          {heats.some((h) => h.status === 'completed') && (
            <button
              type="button"
              onClick={() => sendAction({ type: 'END_TOURNAMENT' })}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ fontSize: '1rem', padding: '0.85rem 1.35rem', borderColor: 'var(--party-yellow)', color: 'var(--party-yellow)' }}
            >
              🏆 Finish Tournament &amp; Crown Champion
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Phase 2: TRACK_VOTE ────────────────────────────────────────────────────
  if (state.phase === 'TRACK_VOTE') {
    const trackVotes: Record<string, TrackId> = hd.trackVotes || {};
    const activeRacers: string[] = hd.activeRacers || [];

    return (
      <div className="phase-enter center-stack" style={{ width: '100%', maxWidth: '1080px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--party-cyan)' }}>
          {hd.heatName}
        </div>
        <div className="host-phase-title" style={{ marginBottom: '0.25rem' }}>
          🗳️ Vote for the Next Track!
        </div>
        <p className="host-prompting-sub" style={{ marginBottom: '0.75rem' }}>
          Racers: pick a course on your phone &amp; tap <strong>&ldquo;Enable Tilt Steering&rdquo;</strong>!
          {hd.format === 'tournament' && ' Waiting players: lock in your Pit Crew Winner Prediction (+300 pts)!'}
        </p>

        {secondsLeft !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0 auto 1.25rem' }}>
            <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}>
              <div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-yellow)' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem', width: '100%' }}>
          {TRACK_LIST.map((t) => {
            const voters = Object.entries(trackVotes)
              .filter(([, tid]) => tid === t.id)
              .map(([pid]) => pid);
            return (
              <div
                key={t.id}
                className="party-card"
                style={{
                  maxWidth: 'none',
                  padding: '1rem',
                  border: `2.5px solid ${voters.length > 0 ? 'var(--party-yellow)' : 'var(--party-border)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <span style={{ fontWeight: 900, fontSize: '1.1rem' }}>
                    {t.emoji} {t.name}
                  </span>
                  <span className="badge" style={{ fontSize: '0.7rem' }}>{t.difficulty}</span>
                </div>
                <TrackMinimap trackId={t.id} size={115} />
                <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)', lineHeight: 1.3 }}>
                  {t.tagline}
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center', minHeight: '28px', marginTop: 'auto' }}>
                  {voters.map((pid) => (
                    <span
                      key={pid}
                      style={{
                        background: 'rgba(250,204,21,0.2)',
                        border: `1.5px solid ${state.players?.[pid]?.avatarColor || '#fff'}`,
                        borderRadius: '999px',
                        padding: '0.1rem 0.5rem',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                      }}
                    >
                      {state.players?.[pid]?.avatar} {state.players?.[pid]?.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Active Heat Lineup Strip */}
        <div style={{ marginTop: '1.1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--party-text-muted)', textTransform: 'uppercase' }}>
            On the Starting Grid:
          </span>
          {activeRacers.map((pid) => {
            const p = state.players?.[pid];
            if (!p) return null;
            const voted = Boolean(trackVotes[pid]);
            return (
              <span
                key={pid}
                style={{
                  border: `2px solid ${p.avatarColor}`,
                  background: voted ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '999px',
                  padding: '0.25rem 0.75rem',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                }}
              >
                {voted ? '✓ ' : ''}{p.avatar} {p.name}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Phase 3: RACING (Dynamic Split-Screen 3D Chase Cam) ────────────────────
  if (state.phase === 'RACING') {
    const snap = snapshot || hd.initialSnapshot;
    const allKarts: KartTelemetrySnapshot['karts'] = snap?.karts || [];
    const humanKarts = allKarts.filter((k) => !k.isBot);
    const viewportKarts = humanKarts.length > 0 ? humanKarts : allKarts.slice(0, 1);
    const { cols, rows } = computeSplitGrid(viewportKarts.length);
    const totalCells = cols * rows;
    const hasSpareOverviewTile = totalCells > viewportKarts.length;
    const countdownSec = snap && snap.countdownMs > 0 ? Math.ceil(snap.countdownMs / 1000) : 0;

    return (
      <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 115px)', minHeight: '520px', borderRadius: '20px', overflow: 'hidden', border: '2px solid var(--party-border)', background: '#050510' }}>
        {/* Single Three.js WebGL Split-Screen Canvas */}
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />

        {/* Split-Screen HTML HUD Grid Overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            pointerEvents: 'none',
          }}
        >
          {viewportKarts.map((k) => {
            const rankIdx = Math.max(0, Math.min(7, (k.rank || 1) - 1));
            const itemInfo = k.heldItem ? ITEM_META[k.heldItem] : null;
            return (
              <div
                key={k.id}
                style={{
                  position: 'relative',
                  border: `2.5px solid ${k.color}`,
                  boxShadow: 'inset 0 0 24px rgba(0,0,0,0.55)',
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                {/* Top HUD Row: Player Name Badge + Item Box */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div
                    style={{
                      background: 'rgba(11, 11, 18, 0.82)',
                      border: `2px solid ${k.color}`,
                      borderRadius: '999px',
                      padding: '0.22rem 0.75rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontWeight: 900,
                      fontSize: cols >= 3 ? '0.82rem' : '0.95rem',
                      color: '#fff',
                    }}
                  >
                    <span>{k.avatar}</span>
                    <span style={{ color: k.color }}>{k.name}</span>
                  </div>

                  {/* Item Roulette / Held Item Slot */}
                  <div
                    style={{
                      width: cols >= 3 ? '42px' : '52px',
                      height: cols >= 3 ? '42px' : '52px',
                      borderRadius: '14px',
                      background: 'rgba(11, 11, 18, 0.85)',
                      border: `2.5px solid ${k.itemRoulette ? '#facc15' : itemInfo ? itemInfo.color : 'rgba(255,255,255,0.22)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: cols >= 3 ? '1.35rem' : '1.7rem',
                      boxShadow: itemInfo ? `0 0 16px ${itemInfo.color}` : undefined,
                    }}
                  >
                    {k.itemRoulette ? '🎲' : itemInfo ? itemInfo.emoji : ''}
                  </div>
                </div>

                {/* Center Viewport Status Alert (Rocket Start, Mini-Turbo, Hit, Finished) */}
                {k.statusText && (
                  <div
                    style={{
                      alignSelf: 'center',
                      background: 'rgba(0,0,0,0.82)',
                      border: '2px solid var(--party-yellow)',
                      color: 'var(--party-yellow)',
                      borderRadius: '999px',
                      padding: '0.25rem 0.9rem',
                      fontWeight: 900,
                      fontSize: cols >= 3 ? '0.82rem' : '1.05rem',
                      textAlign: 'center',
                      textShadow: '0 2px 8px rgba(0,0,0,0.9)',
                    }}
                  >
                    {k.statusText}
                  </div>
                )}

                {/* Bottom HUD Row: Lap + Drift Meter + Rank Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div
                    style={{
                      background: 'rgba(11, 11, 18, 0.82)',
                      border: '1.5px solid rgba(255,255,255,0.2)',
                      borderRadius: '10px',
                      padding: '0.2rem 0.65rem',
                      fontWeight: 900,
                      fontSize: cols >= 3 ? '0.78rem' : '0.9rem',
                    }}
                  >
                    {k.finished ? '🏁 FINISHED' : `LAP ${k.lap}/${snap?.totalLaps || 3}`}
                    {k.drifting && (
                      <span
                        style={{
                          marginLeft: '0.45rem',
                          color: k.driftLevel === 2 ? '#f97316' : k.driftLevel === 1 ? '#38bdf8' : '#94a3b8',
                        }}
                      >
                        {k.driftLevel === 2 ? '🔥 SUPER TURBO' : k.driftLevel === 1 ? '💨 MINI-TURBO' : '〰️ DRIFT'}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', background: 'rgba(11, 11, 18, 0.82)', borderRadius: '12px', padding: '0.15rem 0.65rem', border: `2px solid ${RANK_COLORS[rankIdx]}` }}>
                    <span
                      style={{
                        fontFamily: 'var(--party-font-display)',
                        fontWeight: 900,
                        fontSize: cols >= 3 ? '1.35rem' : '1.85rem',
                        color: RANK_COLORS[rankIdx],
                        lineHeight: 1,
                      }}
                    >
                      {RANK_LABELS[rankIdx] || `#${k.rank}`}
                    </span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--party-text-muted)', fontWeight: 800 }}>
                      {Math.max(0, Math.round(k.speed * 2.2))} km/h
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* If odd number of viewports (e.g. 3, 5, 7 players), use spare quadrant for Live Track Map & Standings Tower */}
          {hasSpareOverviewTile && (
            <div
              style={{
                background: 'rgba(11, 11, 18, 0.94)',
                border: '2px solid var(--party-border)',
                padding: '0.75rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--party-cyan)', textTransform: 'uppercase' }}>
                  {hd.trackEmoji} {hd.trackName}
                </div>
                <TrackMinimap trackId={hd.trackId || 'sunny-circuit'} karts={allKarts} size={rows === 2 && cols >= 3 ? 120 : 155} />
              </div>
              <div style={{ flex: 1, maxWidth: '240px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', color: 'var(--party-yellow)', marginBottom: '0.15rem' }}>
                  🏆 Live Standings
                </div>
                {[...allKarts]
                  .sort((a, b) => a.rank - b.rank)
                  .slice(0, 6)
                  .map((k) => (
                    <div
                      key={k.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        padding: '0.15rem 0.4rem',
                        borderRadius: '6px',
                        background: k.isBot ? 'transparent' : 'rgba(255,255,255,0.06)',
                        color: k.color,
                      }}
                    >
                      <span>{k.rank}. {k.avatar} {k.name}</span>
                      <span style={{ color: 'var(--party-text-muted)' }}>L{k.lap}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Floating Center Minimap when all split-screen tiles are occupied */}
        {!hasSpareOverviewTile && (
          <div
            style={{
              position: 'absolute',
              top: rows === 2 ? '50%' : '12px',
              left: '50%',
              transform: rows === 2 ? 'translate(-50%, -50%)' : 'translateX(-50%)',
              background: 'rgba(7, 11, 20, 0.72)',
              border: '1.5px solid rgba(255,255,255,0.22)',
              borderRadius: '18px',
              padding: '0.25rem',
              pointerEvents: 'none',
              zIndex: 10,
              backdropFilter: 'blur(6px)',
            }}
          >
            <TrackMinimap trackId={hd.trackId || 'sunny-circuit'} karts={allKarts} size={rows === 2 ? 126 : 134} />
          </div>
        )}

        {/* 3-2-1-GO Center Countdown Overlay */}
        {snap && (snap.countdownMs > 0 || (snap.elapsedMs < 4300 && snap.countdownMs === 0)) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: snap.countdownMs > 0 ? 'rgba(0,0,0,0.35)' : 'transparent',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--party-font-display)',
                fontSize: '6.5rem',
                fontWeight: 900,
                color: countdownSec === 0 ? 'var(--party-green)' : 'var(--party-yellow)',
                textShadow: '0 0 40px rgba(0,0,0,0.95)',
              }}
            >
              {countdownSec > 0 ? countdownSec : '🏁 GO!'}
            </div>
            {countdownSec > 0 && (
              <div style={{ background: 'rgba(0,0,0,0.75)', padding: '0.4rem 1.1rem', borderRadius: '999px', fontWeight: 800, color: '#fff', fontSize: '1rem' }}>
                Hold 💨 DRIFT on &ldquo;1&rdquo; for a 🚀 Rocket Start!
              </div>
            )}
          </div>
        )}

        {/* Live Announcement / Finish Countdown Banner */}
        {(snap?.announcement || (snap?.finishCountdownMs !== null && snap?.finishCountdownMs !== undefined)) && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(11, 11, 18, 0.9)',
              border: '2px solid var(--party-yellow)',
              borderRadius: '999px',
              padding: '0.35rem 1.2rem',
              color: 'var(--party-yellow)',
              fontWeight: 900,
              fontSize: '0.95rem',
              zIndex: 25,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {snap?.announcement || `🏁 Race Finishes in ${Math.ceil((snap?.finishCountdownMs || 0) / 1000)}s!`}
          </div>
        )}
      </div>
    );
  }

  // ─── Phase 4: RACE_RESULTS ──────────────────────────────────────────────────
  if (state.phase === 'RACE_RESULTS') {
    const standings: any[] = hd.standings || [];
    const qualifiers: string[] = hd.qualifiers || [];
    const predictors: string[] = hd.correctPredictors || [];

    return (
      <div className="phase-enter center-stack" style={{ width: '100%', maxWidth: '860px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--party-cyan)' }}>
          {hd.heatName}
        </div>
        <div className="host-phase-title" style={{ marginBottom: '0.35rem' }}>
          🏁 Checkered Flag Results!
        </div>

        {secondsLeft !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '340px', width: '100%', margin: '0 auto 1rem' }}>
            <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}>
              <div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-green)' }} />
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', width: '100%' }}>
          {standings.map((row) => {
            const isQual = qualifiers.includes(row.id);
            return (
              <div
                key={row.id}
                className="party-card"
                style={{
                  maxWidth: 'none',
                  padding: '0.75rem 1.25rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: `2.5px solid ${row.rank === 1 ? 'var(--party-yellow)' : isQual ? 'var(--party-green)' : 'var(--party-border)'}`,
                  opacity: row.isBot ? 0.72 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.4rem', fontWeight: 900, width: '42px', color: RANK_COLORS[row.rank - 1] || '#fff' }}>
                    {['🥇', '🥈', '🥉'][row.rank - 1] || `#${row.rank}`}
                  </span>
                  <span style={{ fontSize: '1.35rem' }}>{row.avatar}</span>
                  <span style={{ fontWeight: 900, fontSize: '1.15rem', color: row.color }}>
                    {row.name} {row.isBot ? '(Bot)' : ''}
                  </span>
                  {hd.format === 'tournament' && isQual && !hd.isFinalHeat && (
                    <span className="badge" style={{ borderColor: 'var(--party-green)', color: 'var(--party-green)', fontWeight: 900 }}>
                      ✅ Advances to Finals!
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {row.timeMs && (
                    <span style={{ fontFamily: 'monospace', color: 'var(--party-text-muted)', fontSize: '0.9rem' }}>
                      {(row.timeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span style={{ fontWeight: 900, fontSize: '1.2rem', color: row.points > 0 ? 'var(--party-green)' : 'var(--party-text-muted)' }}>
                    {row.points > 0 ? `+${row.points.toLocaleString()} pts` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {predictors.length > 0 && (
          <div style={{ marginTop: '1rem', background: 'rgba(250, 204, 21, 0.12)', border: '1.5px solid var(--party-yellow)', borderRadius: '14px', padding: '0.65rem 1.2rem', color: 'var(--party-yellow)', fontWeight: 900 }}>
            🔮 Pit Crew Bonus (+300 pts): {predictors.map((pid) => state.players?.[pid]?.name).filter(Boolean).join(', ')} called the winner!
          </div>
        )}
      </div>
    );
  }

  return null;
}
