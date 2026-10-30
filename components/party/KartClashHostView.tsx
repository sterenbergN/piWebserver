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

/** 2D SVG Track Minimap showing the spline loop, start line, and live kart dots. */
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
  const minX = Math.min(...xs) - 35;
  const maxX = Math.max(...xs) + 35;
  const minZ = Math.min(...zs) - 35;
  const maxZ = Math.max(...zs) + 35;
  const width = maxX - minX || 1;
  const height = maxZ - minZ || 1;

  const pointsAttr = track.samples.map((s) => `${s.x},${s.z}`).join(' ');
  const start = track.samples[0];

  return (
    <svg
      viewBox={`${minX} ${minZ} ${width} ${height}`}
      width={size}
      height={size}
      style={{ overflow: 'visible', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.65))' }}
    >
      <polygon
        points={pointsAttr}
        fill="none"
        stroke="rgba(0,0,0,0.75)"
        strokeWidth={28}
        strokeLinejoin="round"
      />
      <polygon
        points={pointsAttr}
        fill="none"
        stroke={track.theme.accentColor}
        strokeWidth={14}
        strokeLinejoin="round"
      />
      {start && (
        <circle cx={start.x} cy={start.z} r={14} fill="#ffffff" stroke="#000" strokeWidth={4} />
      )}
      {karts?.map((k) => (
        <g key={k.id} transform={`translate(${k.x}, ${k.z})`}>
          <circle
            r={k.isBot ? 11 : 17}
            fill={k.color}
            stroke={k.isBot ? '#000' : '#fff'}
            strokeWidth={k.isBot ? 3 : 5}
          />
        </g>
      ))}
    </svg>
  );
}

// ─── Three.js 3D Track & Kart Scene Builder ────────────────────────────────────

function buildTrackMeshGroup(track: KartTrack): {
  group: THREE.Group;
  itemBoxMeshes: Map<string, THREE.Mesh>;
} {
  const group = new THREE.Group();
  const itemBoxMeshes = new Map<string, THREE.Mesh>();

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(1400, 1400);
  const groundMat = new THREE.MeshLambertMaterial({ color: track.theme.groundColor });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  group.add(ground);

  // Build Road Ribbon & Curbs
  const samples = track.samples;
  const m = samples.length;
  const halfW = track.roadWidth * 0.5;
  const curbW = 2.2;

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

  for (let i = 0; i <= m; i++) {
    const s = samples[i % m];
    const lx = s.x - s.nx * halfW;
    const lz = s.z - s.nz * halfW;
    const rx = s.x + s.nx * halfW;
    const rz = s.z + s.nz * halfW;

    roadPositions.push(lx, 0.02, lz, rx, 0.02, rz);

    const c = track.theme.rainbowRoad
      ? rainbowPalette[i % rainbowPalette.length]
      : baseRoadColor;
    roadColors.push(c.r, c.g, c.b, c.r, c.g, c.b);

    if (i < m) {
      const v = i * 2;
      roadIndices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(roadColors, 3));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(roadGeo, roadMat));

  // Alternating colored curbs along both edges
  const curbColorA = new THREE.Color(track.theme.curbColorA);
  const curbColorB = new THREE.Color(track.theme.curbColorB);
  const curbGeo = new THREE.BoxGeometry(curbW, 0.45, 5.2);
  for (let i = 0; i < m; i += 2) {
    const s = samples[i];
    const mat = new THREE.MeshLambertMaterial({ color: (i / 2) % 2 === 0 ? curbColorA : curbColorB });
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(curbGeo, mat);
      curb.position.set(
        s.x + s.nx * side * (halfW + curbW * 0.45),
        0.22,
        s.z + s.nz * side * (halfW + curbW * 0.45),
      );
      curb.rotation.y = s.angle;
      group.add(curb);
    }
  }

  // Centerline dashed markers
  const dashGeo = new THREE.PlaneGeometry(0.9, 3.8);
  const dashMat = new THREE.MeshBasicMaterial({ color: track.theme.roadStripeColor, side: THREE.DoubleSide });
  for (let i = 0; i < m; i += 4) {
    const s = samples[i];
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -s.angle;
    dash.position.set(s.x, 0.06, s.z);
    group.add(dash);
  }

  // Start / Finish Checkered Line & Overhead Arch Gantry
  const startSample = samples[0];
  if (startSample) {
    const finishGroup = new THREE.Group();
    finishGroup.position.set(startSample.x, 0, startSample.z);
    finishGroup.rotation.y = startSample.angle;

    // Checkered road strip
    const tileCount = 12;
    const tileW = track.roadWidth / tileCount;
    const tileGeo = new THREE.PlaneGeometry(tileW, 2.2);
    const whiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const blackMat = new THREE.MeshBasicMaterial({ color: '#0f172a', side: THREE.DoubleSide });
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < tileCount; col++) {
        const tile = new THREE.Mesh(tileGeo, (row + col) % 2 === 0 ? whiteMat : blackMat);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(-halfW + tileW * (col + 0.5), 0.08, (row - 0.5) * 2.2);
        finishGroup.add(tile);
      }
    }

    // Gantry pillars & top banner
    const pillarGeo = new THREE.CylinderGeometry(0.9, 1.1, 14, 12);
    const pillarMat = new THREE.MeshLambertMaterial({ color: track.theme.accentColor });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-halfW - 1.5, 7, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(halfW + 1.5, 7, 0);
    const bannerGeo = new THREE.BoxGeometry(track.roadWidth + 5, 2.6, 1.4);
    const bannerMat = new THREE.MeshLambertMaterial({ color: '#facc15' });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, 13.2, 0);
    finishGroup.add(leftPillar, rightPillar, banner);
    group.add(finishGroup);
  }

  // Boost Pads
  const padGeo = new THREE.PlaneGeometry(4.8, 6.8);
  const padMat = new THREE.MeshBasicMaterial({ color: '#f97316', side: THREE.DoubleSide });
  const padInnerGeo = new THREE.PlaneGeometry(3.2, 4.4);
  const padInnerMat = new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide });
  for (const pad of track.boostPads) {
    const padGroup = new THREE.Group();
    padGroup.position.set(pad.x, 0.09, pad.z);
    padGroup.rotation.y = pad.angle;

    const outer = new THREE.Mesh(padGeo, padMat);
    outer.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(padInnerGeo, padInnerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.02;
    padGroup.add(outer, inner);
    group.add(padGroup);
  }

  // Item Boxes
  const boxGeo = new THREE.BoxGeometry(2.3, 2.3, 2.3);
  const boxMat = new THREE.MeshLambertMaterial({
    color: '#38bdf8',
    emissive: '#a855f7',
    emissiveIntensity: 0.45,
  });
  for (const b of track.itemBoxes) {
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(b.x, 2.1, b.z);
    group.add(mesh);
    itemBoxMeshes.set(b.id, mesh);
  }

  // Scenery Props
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
        new THREE.SphereGeometry(3.6, 8, 6),
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
        new THREE.ConeGeometry(3.6, 10, 8),
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
  root.position.set(x, 0, z);
  root.rotation.y = angle;

  const baseColor = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });

  // Main chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 3.4), bodyMat);
  chassis.position.y = 0.55;
  root.add(chassis);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.2), bodyMat);
  nose.position.set(0, 0.45, 2.0);
  root.add(nose);

  // Rear spoiler
  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.2, 0.6),
    new THREE.MeshLambertMaterial({ color: '#0f172a' }),
  );
  spoiler.position.set(0, 1.25, -1.55);
  root.add(spoiler);

  // Driver helmet / head
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 12, 10),
    new THREE.MeshLambertMaterial({ color: '#ffffff' }),
  );
  helmet.position.set(0, 1.35, -0.1);
  root.add(helmet);

  // 4 Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.45, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#111827' });
  const wheelOffsets: [number, number, number][] = [
    [-1.15, 0.48, 1.2],
    [1.15, 0.48, 1.2],
    [-1.2, 0.48, -1.2],
    [1.2, 0.48, -1.2],
  ];
  for (const [wx, wy, wz] of wheelOffsets) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    root.add(w);
  }

  // Exhaust boost flame
  const flameGeo = new THREE.ConeGeometry(0.55, 2.2, 8);
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: '#f97316' });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, 0.6, -2.7);
  flame.visible = false;
  root.add(flame);

  // Drift sparks behind rear tires
  const sparkGeo = new THREE.SphereGeometry(0.38, 8, 8);
  const sparkMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
  const sparkLeft = new THREE.Mesh(sparkGeo, sparkMat);
  sparkLeft.position.set(-1.1, 0.35, -1.65);
  sparkLeft.visible = false;
  const sparkRight = new THREE.Mesh(sparkGeo, sparkMat);
  sparkRight.position.set(1.1, 0.35, -1.65);
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

        ref.root.position.set(ref.currX, 0, ref.currZ);
        const spinYaw = k.spinOutTimer > 0 ? elapsed * 16 : 0;
        const driftYaw = k.drifting ? -k.driftDir * 0.24 : 0;
        ref.root.rotation.y = ref.currAngle + driftYaw + spinYaw;

        const targetScale = k.shrinkTimer > 0 ? 0.58 : 1.0;
        ref.root.scale.setScalar(targetScale);

        if (k.starTimer > 0) {
          ref.bodyMat.color.setHSL((elapsed * 2.5) % 1, 0.9, 0.55);
        } else {
          ref.bodyMat.color.copy(ref.baseColor);
        }

        ref.flame.visible = k.boostTimer > 0 || k.starTimer > 0;
        if (ref.flame.visible) {
          ref.flame.scale.setScalar(0.85 + Math.sin(elapsed * 40) * 0.25);
        }

        const showSparks = k.drifting && k.driftLevel > 0;
        ref.sparkLeft.visible = showSparks;
        ref.sparkRight.visible = showSparks;
        if (showSparks) {
          ref.sparkMat.color.set(k.driftLevel === 2 ? '#f97316' : '#38bdf8');
          const pulse = 0.8 + Math.sin(elapsed * 30) * 0.35;
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
          cameraPool.push(new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 900));
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

        const chaseDist = k.boostTimer > 0 ? 15.5 : 13.5;
        const chaseHeight = 6.4;
        const camX = kx - Math.sin(ka) * chaseDist;
        const camZ = kz - Math.cos(ka) * chaseDist;
        cam.position.set(camX, chaseHeight, camZ);
        cam.lookAt(
          kx + Math.sin(ka) * 14,
          1.4,
          kz + Math.cos(ka) * 14,
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
              top: rows === 2 ? '50%' : '14px',
              left: '50%',
              transform: rows === 2 ? 'translate(-50%, -50%)' : 'translateX(-50%)',
              background: 'rgba(11, 11, 18, 0.78)',
              border: '2px solid rgba(255,255,255,0.25)',
              borderRadius: '999px',
              padding: '0.45rem',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <TrackMinimap trackId={hd.trackId || 'sunny-circuit'} karts={allKarts} size={105} />
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
