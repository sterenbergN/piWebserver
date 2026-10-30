import { partyEmitter } from './emitter';
import { KART_TRACKS, KartTrack, TrackId, projectOntoTrack, sampleTrackAtProgress } from './kart-tracks';

export type KartItemType =
  | 'mushroom'
  | 'green_shell'
  | 'red_shell'
  | 'banana'
  | 'lightning'
  | 'star'
  | 'spiny_shell'
  | 'golden_mushroom'
  | 'super_horn'
  | 'fake_box';

export type KartSpeedClass = '50cc' | '100cc' | '150cc' | '200cc';
export type KartItemsMode = 'normal' | 'frantic' | 'shells-only' | 'pure';

export const SPEED_CLASSES: Record<KartSpeedClass, { maxSpeed: number }> = {
  '50cc': { maxSpeed: 24 },
  '100cc': { maxSpeed: 29 },
  '150cc': { maxSpeed: 33 },
  '200cc': { maxSpeed: 38 },
};

export interface KartInputState {
  steer: number; // -1 (left) to +1 (right)
  drift: boolean;
  brake: boolean;
  useItem: boolean;
  rocketTap?: boolean;
  honk?: boolean;
  updatedAt: number;
}

export interface KartRacerInit {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  kartStyle?: 'classic' | 'rocket' | 'bruiser' | 'cyber';
  sparksColor?: string;
}

export interface KartState {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  kartStyle: 'classic' | 'rocket' | 'bruiser' | 'cyber';
  sparksColor: string;
  x: number;
  z: number;
  angle: number; // radians, 0 = +Z, PI/2 = +X
  speed: number;
  lap: number; // 1..totalLaps (or totalLaps+1 when finished)
  progress: number; // 0..1 around current lap
  totalProgress: number; // continuous progress for ranking
  passedHalfway: boolean;
  sampleIdx: number;
  lateralOffset: number;
  rank: number; // 1..N
  finished: boolean;
  finishTimeMs: number | null;
  finishRank: number | null;
  lapStartTimeMs: number;
  bestLapTimeMs: number | null;
  // Drifting & boosts
  drifting: boolean;
  driftDir: number; // -1 or +1
  driftTime: number;
  driftLevel: 0 | 1 | 2 | 3; // 0=none, 1=blue, 2=orange, 3=ultra purple
  boostTimer: number;
  slipstreamTimer: number;
  goldenShroomTimer: number;
  // Status effects
  spinOutTimer: number;
  shrinkTimer: number;
  starTimer: number;
  offRoad: boolean;
  hornUntil: number;
  // Items
  heldItem: KartItemType | null;
  itemRouletteTimer: number;
  pendingItem: KartItemType | null;
  // Start-line rocket boost tracking
  earlyHoldTimer: number;
  rocketPrimed: boolean;
  rocketStalled: boolean;
  // AI target lateral offset
  aiTargetLateral: number;
  aiUseItemDelay: number;
  // Telemetry event text for HUD
  statusText: string | null;
  statusUntil: number;
}

export interface KartHazard {
  id: string;
  kind: 'green_shell' | 'red_shell' | 'banana' | 'spiny_shell' | 'fake_box' | 'shockwave';
  ownerId: string;
  targetId: string | null;
  targetKartId?: string | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  progress: number;
  bouncesLeft: number;
  ttl: number;
}

export interface ActiveItemBox {
  id: string;
  x: number;
  z: number;
  respawnTimer: number; // 0 = active & pickable
  isBonus?: boolean;
}

export interface KartRaceStats {
  drifts: Record<string, number>;
  hits: Record<string, number>;
  spunOut: Record<string, number>;
  fastestLap?: { racerId: string; racerName: string; timeMs: number } | null;
}

export interface KartRaceSim {
  roomCode: string;
  raceId: string;
  trackId: TrackId;
  track: KartTrack;
  totalLaps: number;
  speedClass: KartSpeedClass;
  itemsMode: KartItemsMode;
  startedAt: number;
  elapsedMs: number;
  countdownMs: number; // >0 during 3-2-1 countdown
  finishCountdownMs: number | null; // starts at 18000ms once first human finishes
  completed: boolean;
  karts: Record<string, KartState>;
  kartOrder: string[];
  inputs: Record<string, KartInputState>;
  itemBoxes: ActiveItemBox[];
  hazards: KartHazard[];
  nextHazardId: number;
  nextFinishRank: number;
  halfwayChaosTriggered: boolean;
  announcement: string | null;
  announcementUntil: number;
  stats: KartRaceStats;
  timer?: ReturnType<typeof setInterval>;
  onFinish?: (sim: KartRaceSim) => void;
}

export interface KartTelemetrySnapshot {
  roomCode: string;
  raceId: string;
  trackId: TrackId;
  totalLaps: number;
  speedClass: KartSpeedClass;
  elapsedMs: number;
  countdownMs: number;
  finishCountdownMs: number | null;
  announcement: string | null;
  fastestLap?: { racerId: string; racerName: string; timeMs: number } | null;
  karts: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    isBot: boolean;
    kartStyle: 'classic' | 'rocket' | 'bruiser' | 'cyber';
    sparksColor: string;
    x: number;
    z: number;
    angle: number;
    speed: number;
    lap: number;
    progress: number;
    lateralOffset: number;
    sampleIdx: number;
    rank: number;
    finished: boolean;
    finishRank: number | null;
    finishTimeMs: number | null;
    bestLapTimeMs: number | null;
    drifting: boolean;
    driftDir: number;
    driftLevel: 0 | 1 | 2 | 3;
    driftCharge: number; // 0..100% progress
    boostTimer: number;
    slipstreamTimer: number;
    goldenShroomTimer: number;
    spinOutTimer: number;
    shrinkTimer: number;
    starTimer: number;
    offRoad: boolean;
    horn: boolean;
    hasIncomingShell: boolean;
    heldItem: KartItemType | null;
    itemRoulette: boolean;
    statusText: string | null;
  }[];
  itemBoxes: { id: string; x: number; z: number; active: boolean }[];
  hazards: { id: string; kind: KartHazard['kind']; x: number; z: number; angle: number }[];
  timestamp: number;
}

const globalForKart = globalThis as unknown as {
  kartSims?: Map<string, KartRaceSim>;
};

const activeSims: Map<string, KartRaceSim> = globalForKart.kartSims || new Map();
globalForKart.kartSims = activeSims;

const BOT_POOL: { name: string; avatar: string; color: string }[] = [
  { name: 'Mario-Bot', avatar: '🍄', color: '#ef4444' },
  { name: 'Luigi-Bot', avatar: '🦖', color: '#22c55e' },
  { name: 'Peach-Bot', avatar: '👑', color: '#f472b6' },
  { name: 'Yoshi-Bot', avatar: '🐸', color: '#4ade80' },
  { name: 'Toad-Bot', avatar: '🚀', color: '#38bdf8' },
  { name: 'Bowser-Bot', avatar: '🔥', color: '#f97316' },
  { name: 'Wario-Bot', avatar: '⚡', color: '#facc15' },
  { name: 'DK-Bot', avatar: '🐵', color: '#a855f7' },
];

const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ; // 0.0333s
const TICK_MS = Math.round(1000 / TICK_HZ);
const MAX_RACE_DURATION_MS = 135_000;
const POST_FIRST_FINISH_MS = 18_000;

function normalizeAngle(a: number): number {
  let res = a % (Math.PI * 2);
  if (res > Math.PI) res -= Math.PI * 2;
  if (res < -Math.PI) res += Math.PI * 2;
  return res;
}

function setKartStatus(k: KartState, text: string, elapsedMs: number, durationMs = 2000) {
  k.statusText = text;
  k.statusUntil = elapsedMs + durationMs;
}

function rollWeightedItem(rank: number, totalKarts: number, itemsMode: KartItemsMode = 'normal'): KartItemType {
  if (itemsMode === 'pure') {
    return Math.random() < 0.28 ? 'golden_mushroom' : 'mushroom';
  }
  if (itemsMode === 'shells-only') {
    const r = Math.random();
    if (rank === 1) return r < 0.62 ? 'banana' : 'green_shell';
    if (rank >= totalKarts - 1 && r < 0.35) return 'spiny_shell';
    return r < 0.45 ? 'red_shell' : r < 0.72 ? 'green_shell' : 'banana';
  }
  const normPos = totalKarts > 1 ? (rank - 1) / (totalKarts - 1) : 0.5; // 0 = 1st place, 1 = last place
  const r = Math.random();

  if (normPos <= 0.2) {
    // Leader / 2nd place: defensive items + rare super horn to counter blue shells
    if (r < 0.36) return 'banana';
    if (r < 0.60) return 'fake_box';
    if (r < 0.86) return 'green_shell';
    if (r < 0.94) return 'super_horn';
    return 'mushroom';
  }
  if (normPos <= 0.6) {
    // Mid-pack: offensive & boost items
    if (r < 0.22) return 'mushroom';
    if (r < 0.44) return 'red_shell';
    if (r < 0.62) return 'green_shell';
    if (r < 0.76) return 'super_horn';
    if (r < 0.88) return 'golden_mushroom';
    if (r < 0.95) return 'star';
    return 'banana';
  }
  // Back of the pack: powerful comeback items!
  if (r < 0.24) return 'red_shell';
  if (r < 0.48) return 'golden_mushroom';
  if (r < 0.70) return 'star';
  if (r < 0.88) return 'spiny_shell';
  if (r < 0.96) return 'mushroom';
  return 'lightning';
}

export function buildKartRacers(
  humanRacers: { id: string; name: string; avatar?: string; avatarColor: string; kartStyle?: any; sparksColor?: string }[],
  fillWithBots: boolean,
  targetGridSize = 8,
): KartRacerInit[] {
  const racers: KartRacerInit[] = humanRacers.map((p, idx) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || '🏎️',
    color: p.avatarColor || '#38bdf8',
    isBot: false,
    kartStyle: p.kartStyle || (idx % 4 === 1 ? 'rocket' : idx % 4 === 2 ? 'cyber' : idx % 4 === 3 ? 'bruiser' : 'classic'),
    sparksColor: p.sparksColor || p.avatarColor || '#38bdf8',
  }));

  if (fillWithBots) {
    const usedNames = new Set(racers.map((r) => r.name.toLowerCase()));
    let botIdx = 0;
    while (racers.length < targetGridSize && botIdx < BOT_POOL.length) {
      const candidate = BOT_POOL[botIdx++];
      if (usedNames.has(candidate.name.toLowerCase())) continue;
      racers.push({
        id: `BOT_${botIdx}`,
        name: candidate.name,
        avatar: candidate.avatar,
        color: candidate.color,
        isBot: true,
        kartStyle: botIdx % 4 === 1 ? 'rocket' : botIdx % 4 === 2 ? 'cyber' : botIdx % 4 === 3 ? 'bruiser' : 'classic',
        sparksColor: candidate.color,
      });
    }
  }
  return racers;
}

export function createKartSimulation(opts: {
  roomCode: string;
  raceId: string;
  trackId: TrackId;
  racers: KartRacerInit[];
  totalLaps?: number;
  speedClass?: KartSpeedClass;
  itemsMode?: KartItemsMode;
  onFinish?: (sim: KartRaceSim) => void;
}): KartRaceSim {
  stopKartSimulation(opts.roomCode);

  const track = KART_TRACKS[opts.trackId] || KART_TRACKS['sunny-circuit'];
  const totalLaps = opts.totalLaps || 3;
  const speedClass: KartSpeedClass = opts.speedClass || '150cc';
  const itemsMode: KartItemsMode = opts.itemsMode || 'normal';
  const karts: Record<string, KartState> = {};
  const kartOrder: string[] = [];
  const inputs: Record<string, KartInputState> = {};

  // Place karts in 2-column staggered starting grid behind start line (progress 0.965..0.992)
  opts.racers.forEach((r, idx) => {
    const row = Math.floor(idx / 2);
    const col = idx % 2 === 0 ? -1 : 1;
    const startProgress = (1 - 0.012 - row * 0.014) % 1;
    const sample = sampleTrackAtProgress(track, startProgress);
    const lateral = col * (track.roadWidth * 0.24);
    const x = sample.x + sample.nx * lateral;
    const z = sample.z + sample.nz * lateral;

    kartOrder.push(r.id);
    inputs[r.id] = {
      steer: 0,
      drift: false,
      brake: false,
      useItem: false,
      honk: false,
      updatedAt: Date.now(),
    };

    karts[r.id] = {
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      color: r.color,
      isBot: r.isBot,
      kartStyle: r.kartStyle || 'classic',
      sparksColor: r.sparksColor || r.color,
      x,
      z,
      angle: sample.angle,
      speed: 0,
      lap: 1,
      progress: 0,
      totalProgress: -0.01 * idx,
      passedHalfway: false,
      sampleIdx: Math.floor(startProgress * track.samples.length),
      lateralOffset: lateral,
      rank: idx + 1,
      finished: false,
      finishTimeMs: null,
      finishRank: null,
      lapStartTimeMs: 0,
      bestLapTimeMs: null,
      drifting: false,
      driftDir: 0,
      driftTime: 0,
      driftLevel: 0,
      boostTimer: 0,
      slipstreamTimer: 0,
      goldenShroomTimer: 0,
      spinOutTimer: 0,
      shrinkTimer: 0,
      starTimer: 0,
      offRoad: false,
      hornUntil: 0,
      heldItem: null,
      itemRouletteTimer: 0,
      pendingItem: null,
      earlyHoldTimer: 0,
      rocketPrimed: false,
      rocketStalled: false,
      aiTargetLateral: ((idx % 3) - 1) * (track.roadWidth * 0.22),
      aiUseItemDelay: 1.5,
      statusText: null,
      statusUntil: 0,
    };
  });

  const itemBoxes: ActiveItemBox[] = track.itemBoxes.map((b) => ({
    id: b.id,
    x: b.x,
    z: b.z,
    respawnTimer: 0,
  }));

  const sim: KartRaceSim = {
    roomCode: opts.roomCode,
    raceId: opts.raceId,
    trackId: track.id,
    track,
    totalLaps,
    speedClass,
    itemsMode,
    startedAt: Date.now(),
    elapsedMs: 0,
    countdownMs: 3400, // 3.4s 3-2-1-GO countdown
    finishCountdownMs: null,
    completed: false,
    karts,
    kartOrder,
    inputs,
    itemBoxes,
    hazards: [],
    nextHazardId: 1,
    nextFinishRank: 1,
    halfwayChaosTriggered: false,
    announcement: 'Get Ready! Hold DRIFT on "1" for Rocket Start!',
    announcementUntil: 3200,
    stats: { drifts: {}, hits: {}, spunOut: {}, fastestLap: null },
    onFinish: opts.onFinish,
  };

  activeSims.set(opts.roomCode, sim);
  return sim;
}

export function startKartSimulationLoop(sim: KartRaceSim) {
  if (sim.timer) clearInterval(sim.timer);
  let tickCount = 0;
  sim.timer = setInterval(() => {
    stepKartSimulation(sim, TICK_DT);
    tickCount++;
    const snapshot = getKartSnapshot(sim);
    partyEmitter.emit(`kart-tick-${sim.roomCode}`, snapshot, tickCount);
    if (sim.completed) {
      if (sim.timer) clearInterval(sim.timer);
      sim.timer = undefined;
      sim.onFinish?.(sim);
    }
  }, TICK_MS);
  (sim.timer as { unref?: () => void }).unref?.();
}

export function stopKartSimulation(roomCode: string) {
  const existing = activeSims.get(roomCode);
  if (existing?.timer) clearInterval(existing.timer);
  activeSims.delete(roomCode);
}

export function getKartSimulation(roomCode: string): KartRaceSim | undefined {
  return activeSims.get(roomCode);
}

export function updateKartInput(roomCode: string, playerId: string, raw: Partial<KartInputState>): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || !sim.karts[playerId]) return false;
  const prev = sim.inputs[playerId] || { steer: 0, drift: false, brake: false, useItem: false, honk: false, updatedAt: 0 };
  const steer = typeof raw.steer === 'number' && Number.isFinite(raw.steer)
    ? Math.max(-1, Math.min(1, raw.steer))
    : prev.steer;
  const drift = typeof raw.drift === 'boolean' ? raw.drift : prev.drift;
  const brake = typeof raw.brake === 'boolean' ? raw.brake : prev.brake;
  // Latch useItem=true until the next physics tick consumes it so a quick tap is never missed
  const useItem = raw.useItem === true ? true : prev.useItem;
  const rocketTap = raw.rocketTap === true ? true : prev.rocketTap;
  const honk = raw.honk === true ? true : prev.honk;
  if (honk) {
    const k = sim.karts[playerId];
    if (k) k.hornUntil = sim.elapsedMs + 800;
  }

  sim.inputs[playerId] = {
    steer,
    drift,
    brake,
    useItem,
    rocketTap,
    honk,
    updatedAt: Date.now(),
  };
  return true;
}

export function triggerChaosDrop(roomCode: string, effect: 'bananas' | 'item-boxes' | 'boost-pack'): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || sim.completed) return false;

  const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
  const leader = ranked[0];
  if (!leader) return false;

  if (effect === 'bananas') {
    // Drop a cluster of bananas slightly ahead of the leader
    for (let i = 1; i <= 5; i++) {
      const p = (leader.progress + 0.03 + i * 0.015) % 1;
      const s = sampleTrackAtProgress(sim.track, p);
      const lat = ((i % 3) - 1) * (sim.track.roadWidth * 0.28);
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'banana',
        ownerId: 'AUDIENCE',
        targetId: null,
        x: s.x + s.nx * lat,
        z: s.z + s.nz * lat,
        vx: 0,
        vz: 0,
        angle: 0,
        progress: p,
        bouncesLeft: 0,
        ttl: 35,
      });
    }
    sim.announcement = '🍌 CROWD CHAOS: Banana Shower ahead of the leader!';
    sim.announcementUntil = sim.elapsedMs + 4000;
  } else if (effect === 'item-boxes') {
    // Spawn bonus item boxes in front of all racers
    for (const k of ranked) {
      const p = (k.progress + 0.04) % 1;
      const s = sampleTrackAtProgress(sim.track, p);
      sim.itemBoxes.push({
        id: `bonus_box_${sim.nextHazardId++}`,
        x: s.x,
        z: s.z,
        respawnTimer: 0,
        isBonus: true,
      });
    }
    sim.announcement = '📦 CROWD CHAOS: Bonus Item Boxes dropped on the track!';
    sim.announcementUntil = sim.elapsedMs + 4000;
  } else if (effect === 'boost-pack') {
    // Boost everyone except 1st place
    for (const k of ranked.slice(1)) {
      k.boostTimer = Math.max(k.boostTimer, 2.2);
      setKartStatus(k, '⚡ CROWD TURBO!', sim.elapsedMs, 2200);
    }
    sim.announcement = '⚡ CROWD CHAOS: Pack Catch-Up Boost activated!';
    sim.announcementUntil = sim.elapsedMs + 4000;
  }
  return true;
}

export function fireKartItem(sim: KartRaceSim, target: string | KartState) {
  const k = typeof target === 'string' ? sim.karts[target] : target;
  if (!k) return;
  const item = k.heldItem;
  if (!item) return;
  if (item !== 'golden_mushroom') {
    k.heldItem = null;
  }

  switch (item) {
    case 'mushroom': {
      k.boostTimer = Math.max(k.boostTimer, 2.1);
      setKartStatus(k, '🍄 TURBO BOOST!', sim.elapsedMs, 2000);
      break;
    }
    case 'star': {
      k.starTimer = Math.max(k.starTimer, 6.0);
      k.boostTimer = Math.max(k.boostTimer, 6.0);
      k.shrinkTimer = 0;
      setKartStatus(k, '⭐ STAR INVINCIBILITY!', sim.elapsedMs, 3000);
      break;
    }
    case 'lightning': {
      let struckCount = 0;
      for (const other of Object.values(sim.karts)) {
        if (other.id === k.id || other.finished || other.starTimer > 0) continue;
        if (other.rank < k.rank || other.id !== k.id) {
          other.shrinkTimer = 5.0;
          other.spinOutTimer = 0.75;
          other.speed *= 0.45;
          other.drifting = false;
          other.driftLevel = 0;
          setKartStatus(other, '⚡ ZAPPED & SHRUNK!', sim.elapsedMs, 2500);
          sim.stats.hits[k.id] = (sim.stats.hits[k.id] || 0) + 1;
          sim.stats.spunOut[other.id] = (sim.stats.spunOut[other.id] || 0) + 1;
          struckCount++;
        }
      }
      if (struckCount > 0) {
        sim.announcement = `⚡ ${k.name} unleashed Lightning on the pack!`;
        sim.announcementUntil = sim.elapsedMs + 3000;
      }
      setKartStatus(k, '⚡ LIGHTNING UNLEASHED!', sim.elapsedMs, 2200);
      break;
    }
    case 'banana': {
      const backDist = 4.2;
      const bx = k.x - Math.sin(k.angle) * backDist;
      const bz = k.z - Math.cos(k.angle) * backDist;
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'banana',
        ownerId: k.id,
        targetId: null,
        x: bx,
        z: bz,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 0,
        ttl: 45,
      });
      setKartStatus(k, '🍌 BANANA DROPPED!', sim.elapsedMs, 1400);
      break;
    }
    case 'green_shell': {
      const fwdDist = 4.5;
      const shellSpeed = 98;
      const sx = k.x + Math.sin(k.angle) * fwdDist;
      const sz = k.z + Math.cos(k.angle) * fwdDist;
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'green_shell',
        ownerId: k.id,
        targetId: null,
        x: sx,
        z: sz,
        vx: Math.sin(k.angle) * shellSpeed,
        vz: Math.cos(k.angle) * shellSpeed,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 4,
        ttl: 9,
      });
      setKartStatus(k, '🟢 GREEN SHELL FIRED!', sim.elapsedMs, 1400);
      break;
    }
    case 'red_shell': {
      const fwdDist = 4.5;
      const shellSpeed = 92;
      const sx = k.x + Math.sin(k.angle) * fwdDist;
      const sz = k.z + Math.cos(k.angle) * fwdDist;
      // Target the kart immediately ahead in rank (or 1st/2nd if shooter is 1st)
      const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
      const myIdx = ranked.findIndex((r) => r.id === k.id);
      const target = myIdx > 0 ? ranked[myIdx - 1] : ranked[1] || null;
      if (target && !target.finished) {
        setKartStatus(target, '⚠️ INCOMING RED SHELL!', sim.elapsedMs, 2400);
      }
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'red_shell',
        ownerId: k.id,
        targetId: target ? target.id : null,
        targetKartId: target ? target.id : null,
        x: sx,
        z: sz,
        vx: Math.sin(k.angle) * shellSpeed,
        vz: Math.cos(k.angle) * shellSpeed,
        angle: k.angle,
        progress: (k.progress + 0.01) % 1,
        bouncesLeft: 2,
        ttl: 10,
      });
      setKartStatus(k, '🔴 HOMING SHELL FIRED!', sim.elapsedMs, 1500);
      break;
    }
    case 'spiny_shell': {
      const fwdDist = 4.5;
      const shellSpeed = 118;
      const sx = k.x + Math.sin(k.angle) * fwdDist;
      const sz = k.z + Math.cos(k.angle) * fwdDist;
      const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
      const leader = ranked[0] || null;
      if (leader && !leader.finished) {
        setKartStatus(leader, '🚨 BLUE SHELL INCOMING!', sim.elapsedMs, 3500);
      }
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'spiny_shell',
        ownerId: k.id,
        targetId: leader ? leader.id : null,
        targetKartId: leader ? leader.id : null,
        x: sx,
        z: sz,
        vx: Math.sin(k.angle) * shellSpeed,
        vz: Math.cos(k.angle) * shellSpeed,
        angle: k.angle,
        progress: (k.progress + 0.01) % 1,
        bouncesLeft: 0,
        ttl: 14,
      });
      sim.announcement = `🚨 ${k.name} launched a Blue Spiny Shell at the leader!`;
      sim.announcementUntil = sim.elapsedMs + 3200;
      setKartStatus(k, '🚨 BLUE SPINY SHELL LAUNCHED!', sim.elapsedMs, 2200);
      break;
    }
    case 'golden_mushroom': {
      k.goldenShroomTimer = Math.max(k.goldenShroomTimer, 5.5);
      k.boostTimer = Math.max(k.boostTimer, 1.8);
      setKartStatus(k, '👑 GOLDEN TURBO ACTIVE (TAP TO BURST)!', sim.elapsedMs, 2500);
      break;
    }
    case 'super_horn': {
      const blastRadius = 14;
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'shockwave',
        ownerId: k.id,
        targetId: null,
        x: k.x,
        z: k.z,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 0,
        ttl: 0.85,
      });
      sim.hazards = sim.hazards.filter((h) => {
        if (h.kind === 'shockwave') return true;
        const d = Math.hypot(h.x - k.x, h.z - k.z);
        return d > blastRadius;
      });
      for (const other of Object.values(sim.karts)) {
        if (other.id === k.id || other.finished || other.starTimer > 0) continue;
        const d = Math.hypot(other.x - k.x, other.z - k.z);
        if (d <= blastRadius) {
          other.spinOutTimer = 1.0;
          other.speed *= 0.3;
          other.drifting = false;
          other.driftLevel = 0;
          sim.stats.hits[k.id] = (sim.stats.hits[k.id] || 0) + 1;
          sim.stats.spunOut[other.id] = (sim.stats.spunOut[other.id] || 0) + 1;
          setKartStatus(other, `📢 BLASTED BY ${k.name}'s HORN!`, sim.elapsedMs, 1800);
        }
      }
      setKartStatus(k, '📢 SUPER HORN BLAST!', sim.elapsedMs, 1600);
      break;
    }
    case 'fake_box': {
      const backDist = 4.2;
      const bx = k.x - Math.sin(k.angle) * backDist;
      const bz = k.z - Math.cos(k.angle) * backDist;
      sim.hazards.push({
        id: `haz_${sim.nextHazardId++}`,
        kind: 'fake_box',
        ownerId: k.id,
        targetId: null,
        x: bx,
        z: bz,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 0,
        ttl: 50,
      });
      setKartStatus(k, '📦 FAKE ITEM BOX DROPPED!', sim.elapsedMs, 1400);
      break;
    }
  }
}

/** Max heading offset (radians) from the road direction at full steering lock. */
const MAX_STEER_HEADING = 0.6; // ~34°
const MAX_DRIFT_HEADING = 0.74; // ~42° while drifting
/** Seconds for the kart heading to ease toward the steering target. */
const STEER_RESPONSE_S = 0.2;

/**
 * AI driver: picks a lane (with an apex bias into upcoming corners) and produces a steering
 * value for the SAME arcade steering model the humans use, so bots never need to be
 * teleported back onto the road.
 */
function computeBotInput(sim: KartRaceSim, k: KartState, dt: number): KartInputState {
  const track = sim.track;
  const halfRoad = track.roadWidth * 0.5;
  const ds = track.totalLength / track.samples.length;

  // Average curvature over the next ~45 world units to anticipate the corner
  const lookSamples = Math.max(3, Math.round(45 / ds));
  let curvAhead = 0;
  for (let i = 2; i <= lookSamples; i++) {
    curvAhead += track.samples[(k.sampleIdx + i) % track.samples.length].curvature;
  }
  curvAhead /= lookSamples - 1;

  // Positive curvature = left turn; the inside of a left turn is negative lateral offset
  const apex = -Math.max(-1, Math.min(1, curvAhead * 32)) * halfRoad * 0.45;
  const laneTarget = Math.max(-halfRoad * 0.6, Math.min(halfRoad * 0.6, k.aiTargetLateral * 0.55 + apex));

  // Desired lateral velocity toward the lane, converted into a heading offset.
  // Lateral offset changes at -speed * sin(headingRel) (positive headingRel steers left).
  const speed = Math.max(12, Math.abs(k.speed));
  const desiredLatVel = (laneTarget - k.lateralOffset) * 1.6;
  const desiredRel = -Math.asin(Math.max(-0.95, Math.min(0.95, desiredLatVel / speed)));
  const steer = Math.max(-1, Math.min(1, -desiredRel / MAX_STEER_HEADING));

  let useItem = false;
  if (k.heldItem) {
    k.aiUseItemDelay -= dt;
    if (k.aiUseItemDelay <= 0) {
      useItem = true;
      k.aiUseItemDelay = 1.4 + Math.random() * 1.5;
    }
  }

  const sharpCorner = Math.abs(curvAhead) > 0.012;
  return {
    steer,
    // Bots hold a drift through sharp corners (in the turn direction) for mini-turbos
    drift: !k.finished && sharpCorner && k.speed > 40 && (k.drifting || steer * Math.sign(-curvAhead) > 0.05),
    brake: false,
    useItem: useItem && !k.finished,
    updatedAt: sim.elapsedMs,
  };
}

export function stepKartSimulation(sim: KartRaceSim, dt: number) {
  if (sim.completed) return;

  const dtMs = dt * 1000;
  sim.elapsedMs += dtMs;

  // Handle 3-2-1 Countdown
  if (sim.countdownMs > 0) {
    const prevCountdown = sim.countdownMs;
    sim.countdownMs = Math.max(0, sim.countdownMs - dtMs);

    for (const k of Object.values(sim.karts)) {
      if (k.isBot) continue;
      const inp = sim.inputs[k.id];
      const holdingBoost = Boolean(inp?.drift || inp?.rocketTap);
      if (sim.countdownMs > 1500 && holdingBoost) {
        k.earlyHoldTimer += dt;
        if (k.earlyHoldTimer > 0.35) k.rocketStalled = true;
      } else if (sim.countdownMs <= 1350 && sim.countdownMs > 100 && holdingBoost && !k.rocketStalled) {
        k.rocketPrimed = true;
      }
      if (inp) inp.rocketTap = false;
    }

    if (prevCountdown > 0 && sim.countdownMs === 0) {
      sim.announcement = '🏁 GO! GO! GO!';
      sim.announcementUntil = sim.elapsedMs + 1800;
      for (const k of Object.values(sim.karts)) {
        if (k.isBot) {
          if (Math.random() < 0.35) k.boostTimer = 0.9;
        } else if (k.rocketStalled) {
          k.spinOutTimer = 0.65;
          setKartStatus(k, '💥 ENGINE STALL!', sim.elapsedMs, 1500);
        } else if (k.rocketPrimed) {
          k.boostTimer = 1.65;
          sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
          setKartStatus(k, '🚀 ROCKET START!', sim.elapsedMs, 1800);
        }
      }
    }
    return;
  }

  // Clear expired announcements
  if (sim.announcement && sim.elapsedMs > sim.announcementUntil) {
    sim.announcement = null;
  }

  // Update item box respawn timers
  for (const box of sim.itemBoxes) {
    if (box.respawnTimer > 0) {
      box.respawnTimer = Math.max(0, box.respawnTimer - dt);
    }
  }

  const allKarts = Object.values(sim.karts);
  const leaderProgress = Math.max(...allKarts.map((k) => k.totalProgress));

  // Step each kart
  for (const k of allKarts) {
    if (k.statusText && sim.elapsedMs > k.statusUntil) {
      k.statusText = null;
    }

    // Item roulette completion
    if (k.itemRouletteTimer > 0) {
      k.itemRouletteTimer = Math.max(0, k.itemRouletteTimer - dt);
      if (k.itemRouletteTimer === 0 && k.pendingItem) {
        k.heldItem = k.pendingItem;
        k.pendingItem = null;
      }
    }

    // Decrement active timers
    if (k.boostTimer > 0) k.boostTimer = Math.max(0, k.boostTimer - dt);
    if (k.goldenShroomTimer > 0) {
      k.goldenShroomTimer = Math.max(0, k.goldenShroomTimer - dt);
      if (k.goldenShroomTimer === 0 && k.heldItem === 'golden_mushroom') {
        k.heldItem = null;
      }
    }
    if (k.spinOutTimer > 0) k.spinOutTimer = Math.max(0, k.spinOutTimer - dt);
    if (k.shrinkTimer > 0) k.shrinkTimer = Math.max(0, k.shrinkTimer - dt);
    if (k.starTimer > 0) k.starTimer = Math.max(0, k.starTimer - dt);

    // Finished karts cruise on gentle autopilot
    const inp = k.isBot || k.finished
      ? computeBotInput(sim, k, dt)
      : sim.inputs[k.id] || { steer: 0, drift: false, brake: false, useItem: false, honk: false, updatedAt: 0 };

    // Consume item use or golden mushroom tap
    if (inp.useItem && !k.finished && k.spinOutTimer <= 0) {
      if (k.goldenShroomTimer > 0) {
        k.boostTimer = Math.max(k.boostTimer, 1.45);
        setKartStatus(k, '👑 GOLDEN BURST!', sim.elapsedMs, 800);
      } else if (k.itemRouletteTimer > 0 && k.pendingItem) {
        // Fast-stop the roulette on tap
        k.itemRouletteTimer = 0;
        k.heldItem = k.pendingItem;
        k.pendingItem = null;
      } else if (k.heldItem) {
        fireKartItem(sim, k);
      }
    }
    if (!k.isBot && sim.inputs[k.id]) {
      sim.inputs[k.id].useItem = false;
      sim.inputs[k.id].rocketTap = false;
      sim.inputs[k.id].honk = false;
    }

    const trackSample = sim.track.samples[k.sampleIdx] || sim.track.samples[0];
    const halfRoad = sim.track.roadWidth * 0.5;

    // Handle spin-out state (keep a 18 u/s speed floor so hits don't bring karts to a dead stop)
    if (k.spinOutTimer > 0) {
      k.speed = Math.max(18, k.speed - 52 * dt);
      k.drifting = false;
      k.driftDir = 0;
      k.driftTime = 0;
      k.driftLevel = 0;
    } else {
      // Drifting & 3-Tier Mini-Turbo logic
      const wantsDrift = inp.drift && !inp.brake && k.speed > 18;
      if (wantsDrift) {
        if (!k.drifting) {
          k.drifting = true;
          // Choose initial drift direction from steer input, or upcoming road curvature, or road center
          if (Math.abs(inp.steer) > 0.06) {
            k.driftDir = Math.sign(inp.steer);
          } else if (Math.abs(trackSample.curvature) > 0.002) {
            k.driftDir = trackSample.curvature > 0 ? -1 : 1;
          } else {
            k.driftDir = k.lateralOffset > 0 ? -1 : 1;
          }
          k.driftTime = 0;
          k.driftLevel = 0;
        }
        if (k.drifting) {
          if (!k.isBot && k.driftTime < 0.45 && Math.abs(inp.steer) > 0.2) {
            k.driftDir = Math.sign(inp.steer);
          }
          const intoTurn = Math.max(0.8, 1.05 + inp.steer * k.driftDir * 0.65);
          k.driftTime += dt * intoTurn;
          const prevLevel = k.driftLevel;
          if (k.driftTime >= 1.85) k.driftLevel = 3;
          else if (k.driftTime >= 1.05) k.driftLevel = 2;
          else if (k.driftTime >= 0.45) k.driftLevel = 1;

          if (!k.isBot && k.driftLevel > prevLevel) {
            setKartStatus(
              k,
              k.driftLevel === 3
                ? '💜 ULTRA TURBO CHARGED!'
                : k.driftLevel === 2
                ? '🔥 SUPER TURBO READY!'
                : '💨 MINI-TURBO READY!',
              sim.elapsedMs,
              900,
            );
          }
        }
      }

      // Trigger Mini-Turbo on drift release
      if (k.drifting && !wantsDrift) {
        if (!inp.brake && k.speed > 15) {
          if (k.driftLevel === 3) {
            k.boostTimer = Math.max(k.boostTimer, 2.6);
            sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
            setKartStatus(k, '💜 ULTRA MINI-TURBO!!', sim.elapsedMs, 1800);
          } else if (k.driftLevel === 2) {
            k.boostTimer = Math.max(k.boostTimer, 1.9);
            sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
            setKartStatus(k, '🔥 SUPER MINI-TURBO!', sim.elapsedMs, 1500);
          } else if (k.driftLevel === 1) {
            k.boostTimer = Math.max(k.boostTimer, 1.2);
            sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
            setKartStatus(k, '💨 MINI-TURBO!', sim.elapsedMs, 1200);
          }
        }
        k.drifting = false;
        k.driftDir = 0;
        k.driftTime = 0;
        k.driftLevel = 0;
      }

      // Unified Curvilinear Smart Arcade Steering
      const effectiveSteer = k.drifting
        ? Math.max(-1.2, Math.min(1.2, k.driftDir * 0.35 + inp.steer * 0.85))
        : inp.steer;
      const maxAngle = k.drifting ? MAX_DRIFT_HEADING : MAX_STEER_HEADING;
      let targetRel = -effectiveSteer * maxAngle;

      // Smart Curb Assist: prevent steering off the asphalt near the left/right curbs
      const edgeRatio = k.lateralOffset / halfRoad;
      if (edgeRatio > 0.72) {
        const allowRight = Math.max(0, (0.9 - edgeRatio) / 0.18) * maxAngle;
        const inwardNudge = Math.max(0, edgeRatio - 0.86) * 0.9;
        targetRel = Math.max(targetRel, -allowRight + inwardNudge);
      } else if (edgeRatio < -0.72) {
        const allowLeft = Math.max(0, (0.9 + edgeRatio) / 0.18) * maxAngle;
        const inwardNudge = Math.max(0, -edgeRatio - 0.86) * 0.9;
        targetRel = Math.min(targetRel, allowLeft - inwardNudge);
      }

      const currRel = normalizeAngle(k.angle - trackSample.angle);
      const responseAlpha = 1 - Math.exp(-dt / (STEER_RESPONSE_S * (0.75 + 0.25 * sim.track.friction)));
      const nextRel = Math.max(
        -MAX_DRIFT_HEADING,
        Math.min(MAX_DRIFT_HEADING, currRel + (targetRel - currRel) * responseAlpha),
      );

      // Advance along road curvature so karts stay locked to the spline around sweeping turns
      const curveAdvance = Math.max(0, k.speed) * dt * trackSample.curvature;
      k.angle = normalizeAngle(trackSample.angle + curveAdvance + nextRel);

      // Top speed & acceleration calculation with speedClass scaling
      const speedScale = sim.speedClass === '200cc'
        ? 1.25
        : sim.speedClass === '100cc'
        ? 0.94
        : sim.speedClass === '50cc'
        ? 0.85
        : 1.06;

      let baseTopSpeed = 55 * speedScale;
      if (k.isBot) {
        const gap = leaderProgress - k.totalProgress;
        if (gap > 0.22) baseTopSpeed = 56.5 * speedScale;
        else if (gap < -0.1) baseTopSpeed = 50.0 * speedScale;
        else baseTopSpeed = 52.0 * speedScale;
      } else {
        const rankRatio = (k.rank - 1) / Math.max(1, allKarts.length - 1);
        baseTopSpeed = (55.5 + rankRatio * 3.5) * speedScale;
      }

      if (k.finished) baseTopSpeed = 38 * speedScale;
      if (k.drifting) baseTopSpeed *= 1.06;
      if (k.shrinkTimer > 0) baseTopSpeed *= 0.76;
      if (k.starTimer > 0) baseTopSpeed *= 1.28;
      else if (k.boostTimer > 0) baseTopSpeed *= 1.32;

      const ignoreOffRoad = k.boostTimer > 0 || k.starTimer > 0;
      if (k.offRoad && !ignoreOffRoad) {
        baseTopSpeed *= 0.82;
      }

      if (inp.brake && !k.finished) {
        k.speed = Math.max(-16, k.speed - 58 * dt);
      } else {
        const accel = (k.boostTimer > 0 || k.starTimer > 0 ? 84 : 46) * (sim.speedClass === '200cc' ? 1.25 : 1.0);
        if (k.speed < baseTopSpeed) {
          k.speed = Math.min(baseTopSpeed, k.speed + accel * dt);
        } else {
          k.speed = Math.max(baseTopSpeed, k.speed - 28 * dt);
        }
      }
    }

    // Slipstream Drafting behind opponent ahead
    if (!k.finished && k.speed > 20) {
      let inSlipstream = false;
      for (const other of allKarts) {
        if (other.id === k.id || other.finished) continue;
        const dx = other.x - k.x;
        const dz = other.z - k.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 3.0 && dist < 19.0) {
          const fwd = (dx * Math.sin(k.angle) + dz * Math.cos(k.angle)) / dist;
          const lat = Math.abs(dx * Math.cos(k.angle) - dz * Math.sin(k.angle));
          if ((fwd > 0.88 && lat < 3.2) || (dist < 14.0 && fwd > 0.65 && lat < 6.0)) {
            inSlipstream = true;
            break;
          }
        }
      }
      if (inSlipstream) {
        k.slipstreamTimer += dt;
        if (k.slipstreamTimer >= 1.8) {
          k.boostTimer = Math.max(k.boostTimer, 1.45);
          k.slipstreamTimer = 0;
          setKartStatus(k, '💨 SLIPSTREAM DRAFT!', sim.elapsedMs, 1400);
        }
      } else {
        k.slipstreamTimer = Math.max(0, k.slipstreamTimer - dt * 1.5);
      }
    } else {
      k.slipstreamTimer = 0;
    }

    // Move kart in XZ plane
    k.x += Math.sin(k.angle) * k.speed * dt;
    k.z += Math.cos(k.angle) * k.speed * dt;

    // Project onto track spline for progress, off-road, and outer wall collision
    const proj = projectOntoTrack(sim.track, k.x, k.z, k.sampleIdx);
    k.sampleIdx = proj.sampleIdx;
    k.lateralOffset = proj.lateralOffset;
    k.offRoad = Math.abs(k.lateralOffset) > halfRoad;

    // Soft outer wall cushion at +-wallWidth
    const maxWallOffset = sim.track.wallWidth - 1.5;
    if (Math.abs(proj.lateralOffset) > maxWallOffset) {
      const sign = Math.sign(proj.lateralOffset);
      k.x = proj.sample.x + proj.sample.nx * sign * maxWallOffset;
      k.z = proj.sample.z + proj.sample.nz * sign * maxWallOffset;
      k.lateralOffset = sign * maxWallOffset;
      k.speed *= 0.94;
      k.angle = proj.sample.angle;
    }

    // Lap & checkpoint tracking with timing
    const prevProgress = k.progress;
    const newProgress = proj.progress;
    if (newProgress >= 0.42 && newProgress <= 0.68) {
      k.passedHalfway = true;
    }

    if (k.lapStartTimeMs === 0 && sim.countdownMs === 0) {
      k.lapStartTimeMs = sim.elapsedMs;
    }

    if (!k.finished && sim.elapsedMs > 2500) {
      // Crossed start/finish line forward
      if (prevProgress > 0.78 && newProgress < 0.22 && k.passedHalfway) {
        const lapDuration = Math.round(sim.elapsedMs - k.lapStartTimeMs);
        k.lapStartTimeMs = sim.elapsedMs;
        if (!k.bestLapTimeMs || lapDuration < k.bestLapTimeMs) {
          k.bestLapTimeMs = lapDuration;
        }
        if (!sim.stats.fastestLap || lapDuration < sim.stats.fastestLap.timeMs) {
          sim.stats.fastestLap = { racerId: k.id, racerName: k.name, timeMs: lapDuration };
        }

        k.lap++;
        k.passedHalfway = false;
        if (k.lap === sim.totalLaps) {
          setKartStatus(k, '🔔 FINAL LAP!', sim.elapsedMs, 2600);
        } else if (k.lap > sim.totalLaps) {
          k.finished = true;
          k.finishTimeMs = Math.round(sim.elapsedMs);
          k.finishRank = sim.nextFinishRank++;
          setKartStatus(k, `🏁 FINISHED #${k.finishRank}!`, sim.elapsedMs, 10000);
          const hasHumanRacers = allKarts.some((kart) => !kart.isBot);
          if (sim.finishCountdownMs === null && (!k.isBot || !hasHumanRacers)) {
            sim.finishCountdownMs = POST_FIRST_FINISH_MS;
            sim.announcement = `🏁 ${k.name} crossed the finish line! 18s remaining!`;
            sim.announcementUntil = sim.elapsedMs + 4000;
          }
        }
      }
    }

    k.progress = newProgress;
    if (!k.finished) {
      const lapBase = k.lap - 1;
      const effectiveProgress = k.lap === 1 && !k.passedHalfway && newProgress > 0.85
        ? newProgress - 1
        : newProgress;
      k.totalProgress = lapBase + effectiveProgress;
    } else {
      k.totalProgress = sim.totalLaps + 1 + (10 - (k.finishRank || 10)) * 0.1;
    }

    // Check boost pads
    for (const pad of sim.track.boostPads) {
      if (Math.hypot(k.x - pad.x, k.z - pad.z) < 4.2) {
        if (k.boostTimer < 1.25) {
          k.boostTimer = 1.35;
          setKartStatus(k, '⚡ BOOST PAD!', sim.elapsedMs, 1000);
        }
      }
    }

    // Check item boxes
    for (const box of sim.itemBoxes) {
      if (box.respawnTimer > 0) continue;
      if (Math.hypot(k.x - box.x, k.z - box.z) < 3.6) {
        box.respawnTimer = box.isBonus ? 999 : 4.5;
        if (!k.heldItem && k.itemRouletteTimer <= 0 && !k.finished) {
          k.itemRouletteTimer = 1.1;
          k.pendingItem = rollWeightedItem(k.rank, allKarts.length, sim.itemsMode);
        }
      }
    }
  }

  // Kart-to-kart collisions & Star knockbacks
  for (let i = 0; i < allKarts.length; i++) {
    for (let j = i + 1; j < allKarts.length; j++) {
      const a = allKarts[i];
      const b = allKarts[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const minDist = 2.8;
      if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const nz = dz / dist;
        const push = (minDist - dist) * 0.5;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;

        if (a.starTimer > 0 && b.starTimer <= 0 && b.spinOutTimer <= 0) {
          b.spinOutTimer = 1.0;
          b.speed *= 0.35;
          sim.stats.hits[a.id] = (sim.stats.hits[a.id] || 0) + 1;
          sim.stats.spunOut[b.id] = (sim.stats.spunOut[b.id] || 0) + 1;
          setKartStatus(b, `⭐ BUMPED BY ${a.name}!`, sim.elapsedMs, 1800);
        } else if (b.starTimer > 0 && a.starTimer <= 0 && a.spinOutTimer <= 0) {
          a.spinOutTimer = 1.0;
          a.speed *= 0.35;
          sim.stats.hits[b.id] = (sim.stats.hits[b.id] || 0) + 1;
          sim.stats.spunOut[a.id] = (sim.stats.spunOut[a.id] || 0) + 1;
          setKartStatus(a, `⭐ BUMPED BY ${b.name}!`, sim.elapsedMs, 1800);
        }
      }
    }
  }

  // Step hazards (green/red/spiny shells, bananas, fake boxes)
  const remainingHazards: KartHazard[] = [];
  for (const h of sim.hazards) {
    h.ttl -= dt;
    if (h.ttl <= 0) continue;

    if (h.kind === 'green_shell') {
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      const proj = projectOntoTrack(sim.track, h.x, h.z);
      if (Math.abs(proj.lateralOffset) > sim.track.wallWidth - 1) {
        if (h.bouncesLeft > 0) {
          h.bouncesLeft--;
          const dot = h.vx * proj.sample.nx + h.vz * proj.sample.nz;
          h.vx -= 2 * dot * proj.sample.nx;
          h.vz -= 2 * dot * proj.sample.nz;
          h.angle = Math.atan2(h.vx, h.vz);
        } else {
          continue;
        }
      }
    } else if (h.kind === 'red_shell') {
      const speed = 92;
      let target = h.targetId ? sim.karts[h.targetId] : null;
      if (target?.finished) {
        const sortedActive = Object.values(sim.karts).sort((a, b) => a.rank - b.rank).filter((r) => !r.finished && r.id !== h.ownerId);
        target = sortedActive[0] || null;
        if (target) {
          h.targetId = target.id;
          h.targetKartId = target.id;
        }
      }
      if (target && !target.finished && Math.hypot(target.x - h.x, target.z - h.z) < 28) {
        const distToTarget = Math.hypot(target.x - h.x, target.z - h.z);
        const desired = Math.atan2(target.x - h.x, target.z - h.z);
        h.angle = desired;
        h.vx = Math.sin(desired) * speed;
        h.vz = Math.cos(desired) * speed;
        if (distToTarget <= speed * dt) {
          h.x = target.x;
          h.z = target.z;
        } else {
          h.x += h.vx * dt;
          h.z += h.vz * dt;
        }
        h.progress = projectOntoTrack(sim.track, h.x, h.z, target.sampleIdx).progress;
      } else {
        h.progress = (h.progress + (speed * dt) / sim.track.totalLength) % 1;
        const s = sampleTrackAtProgress(sim.track, h.progress);
        h.x = s.x;
        h.z = s.z;
        h.angle = s.angle;
      }
    } else if (h.kind === 'spiny_shell') {
      // Blue shell tracks toward active leader
      const sortedActive = Object.values(sim.karts).sort((a, b) => a.rank - b.rank).filter((r) => !r.finished);
      const currentLeader = sortedActive[0] || null;
      if (currentLeader) {
        h.targetId = currentLeader.id;
        h.targetKartId = currentLeader.id;
      }
      const target = h.targetId ? sim.karts[h.targetId] : null;
      const speed = 118;
      if (target && !target.finished && Math.hypot(target.x - h.x, target.z - h.z) < 28) {
        const distToTarget = Math.hypot(target.x - h.x, target.z - h.z);
        const desired = Math.atan2(target.x - h.x, target.z - h.z);
        h.angle = desired;
        h.vx = Math.sin(desired) * speed;
        h.vz = Math.cos(desired) * speed;
        if (distToTarget <= speed * dt) {
          h.x = target.x;
          h.z = target.z;
        } else {
          h.x += h.vx * dt;
          h.z += h.vz * dt;
        }
        h.progress = projectOntoTrack(sim.track, h.x, h.z, target.sampleIdx).progress;
      } else {
        h.progress = (h.progress + (speed * dt) / sim.track.totalLength) % 1;
        const s = sampleTrackAtProgress(sim.track, h.progress);
        h.x = s.x;
        h.z = s.z;
        h.angle = s.angle;
      }
    }

    // Shockwaves do not collide with karts (instant damage already dealt)
    if (h.kind === 'shockwave') {
      remainingHazards.push(h);
      continue;
    }

    // Check collision with karts
    let hitKart: KartState | null = null;
    for (const k of allKarts) {
      if (k.finished) continue;
      if (k.id === h.ownerId && h.ttl > (h.kind === 'fake_box' ? 49.2 : h.kind === 'banana' ? 44.2 : 8.4)) continue;
      const hitRadius = h.kind === 'banana' || h.kind === 'fake_box' ? 2.6 : 3.2;
      if (Math.hypot(k.x - h.x, k.z - h.z) < hitRadius) {
        hitKart = k;
        break;
      }
    }

    if (hitKart) {
      if (hitKart.starTimer <= 0) {
        const isSpiny = h.kind === 'spiny_shell';
        hitKart.spinOutTimer = isSpiny ? 1.7 : 1.15;
        hitKart.speed *= isSpiny ? 0.15 : 0.25;
        hitKart.drifting = false;
        hitKart.driftLevel = 0;
        if (h.ownerId && h.ownerId !== hitKart.id && sim.karts[h.ownerId]) {
          sim.stats.hits[h.ownerId] = (sim.stats.hits[h.ownerId] || 0) + 1;
          setKartStatus(sim.karts[h.ownerId], `🎯 HIT ${hitKart.name}!`, sim.elapsedMs, 1800);
        }
        sim.stats.spunOut[hitKart.id] = (sim.stats.spunOut[hitKart.id] || 0) + 1;
        const label = h.kind === 'banana'
          ? '🍌 SLIPPED ON BANANA!'
          : h.kind === 'fake_box'
          ? '📦 TRICKED BY FAKE BOX!'
          : isSpiny
          ? '💥 CRUSHED BY BLUE SHELL!'
          : '💥 HIT BY SHELL!';
        setKartStatus(hitKart, label, sim.elapsedMs, 2000);

        // Blue shell blast damages surrounding karts too & spawns expanding visual shockwave
        if (isSpiny) {
          remainingHazards.push({
            id: `haz_${sim.nextHazardId++}`,
            kind: 'shockwave',
            ownerId: h.ownerId,
            targetId: null,
            x: h.x,
            z: h.z,
            vx: 0,
            vz: 0,
            angle: 0,
            progress: h.progress,
            bouncesLeft: 0,
            ttl: 1.1,
          });
          for (const other of allKarts) {
            if (other.id !== hitKart.id && !other.finished && other.starTimer <= 0) {
              if (Math.hypot(other.x - h.x, other.z - h.z) < 9.0) {
                other.spinOutTimer = 1.0;
                other.speed *= 0.3;
                other.drifting = false;
                other.driftLevel = 0;
                setKartStatus(other, '💥 BLUE SHELL BLASTWAVE!', sim.elapsedMs, 1500);
              }
            }
          }
        }
      }
      continue;
    }

    remainingHazards.push(h);
  }
  sim.hazards = remainingHazards;

  // Update 1st..Nth ranks
  const sorted = [...allKarts].sort((a, b) => {
    if (a.finished && b.finished) return (a.finishRank || 99) - (b.finishRank || 99);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.totalProgress - a.totalProgress;
  });
  sorted.forEach((k, idx) => {
    k.rank = idx + 1;
  });

  // Check race completion conditions
  const humanKarts = allKarts.filter((k) => !k.isBot);
  const allHumansFinished = humanKarts.length > 0 && humanKarts.every((k) => k.finished);
  const allKartsFinished = allKarts.length > 0 && allKarts.every((k) => k.finished);

  if (sim.finishCountdownMs !== null) {
    sim.finishCountdownMs = Math.max(0, sim.finishCountdownMs - dtMs);
  }

  if (
    allHumansFinished ||
    allKartsFinished ||
    (sim.finishCountdownMs !== null && sim.finishCountdownMs <= 0) ||
    sim.elapsedMs >= MAX_RACE_DURATION_MS
  ) {
    for (const k of sorted) {
      if (!k.finished) {
        k.finished = true;
        k.finishRank = sim.nextFinishRank++;
        k.finishTimeMs = Math.round(sim.elapsedMs);
      }
    }
    sim.completed = true;
  }
}

export function getKartSnapshot(sim: KartRaceSim): KartTelemetrySnapshot {
  return {
    roomCode: sim.roomCode,
    raceId: sim.raceId,
    trackId: sim.trackId,
    totalLaps: sim.totalLaps,
    speedClass: sim.speedClass,
    elapsedMs: Math.round(sim.elapsedMs),
    countdownMs: Math.round(sim.countdownMs),
    finishCountdownMs: sim.finishCountdownMs !== null ? Math.round(sim.finishCountdownMs) : null,
    announcement: sim.announcement,
    fastestLap: sim.stats.fastestLap || null,
    karts: sim.kartOrder.map((id) => {
      const k = sim.karts[id];
      const driftChargePct = k.drifting
        ? k.driftLevel === 3
          ? 100
          : k.driftLevel === 2
          ? Math.min(100, Math.round(((k.driftTime - 1.05) / 0.8) * 100))
          : k.driftLevel === 1
          ? Math.min(100, Math.round(((k.driftTime - 0.45) / 0.6) * 100))
          : Math.min(100, Math.round((k.driftTime / 0.45) * 100))
        : 0;

      const hasIncomingShell = sim.hazards.some(
        (h) => (h.kind === 'red_shell' || h.kind === 'spiny_shell') && h.targetId === k.id,
      );

      return {
        id: k.id,
        name: k.name,
        avatar: k.avatar,
        color: k.color,
        isBot: k.isBot,
        kartStyle: k.kartStyle,
        sparksColor: k.sparksColor,
        x: Math.round(k.x * 100) / 100,
        z: Math.round(k.z * 100) / 100,
        angle: Math.round(k.angle * 1000) / 1000,
        speed: Math.round(k.speed * 10) / 10,
        lap: Math.min(k.lap, sim.totalLaps),
        progress: Math.round(k.progress * 1000) / 1000,
        lateralOffset: Math.round(k.lateralOffset * 100) / 100,
        sampleIdx: k.sampleIdx,
        rank: k.rank,
        finished: k.finished,
        finishRank: k.finishRank,
        finishTimeMs: k.finishTimeMs,
        bestLapTimeMs: k.bestLapTimeMs,
        drifting: k.drifting,
        driftDir: k.driftDir,
        driftLevel: k.driftLevel,
        driftCharge: driftChargePct,
        boostTimer: Math.round(k.boostTimer * 10) / 10,
        slipstreamTimer: Math.round(k.slipstreamTimer * 10) / 10,
        goldenShroomTimer: Math.round(k.goldenShroomTimer * 10) / 10,
        spinOutTimer: Math.round(k.spinOutTimer * 10) / 10,
        shrinkTimer: Math.round(k.shrinkTimer * 10) / 10,
        starTimer: Math.round(k.starTimer * 10) / 10,
        offRoad: k.offRoad,
        horn: sim.elapsedMs < k.hornUntil,
        hasIncomingShell,
        heldItem: k.heldItem,
        itemRoulette: k.itemRouletteTimer > 0,
        statusText: k.statusText,
      };
    }),
    itemBoxes: sim.itemBoxes
      .filter((b) => !(b.isBonus && b.respawnTimer > 0))
      .map((b) => ({
        id: b.id,
        x: Math.round(b.x * 10) / 10,
        z: Math.round(b.z * 10) / 10,
        active: b.respawnTimer <= 0,
      })),
    hazards: sim.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      x: Math.round(h.x * 10) / 10,
      z: Math.round(h.z * 10) / 10,
      angle: Math.round(h.angle * 100) / 100,
    })),
    timestamp: Date.now(),
  };
}
