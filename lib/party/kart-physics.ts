import { partyEmitter } from './emitter';
import { KART_TRACKS, KartTrack, TrackId, projectOntoTrack, sampleTrackAtProgress } from './kart-tracks';

export type KartItemType = 'mushroom' | 'green_shell' | 'red_shell' | 'banana' | 'lightning' | 'star';

export interface KartInputState {
  steer: number; // -1 (left) to +1 (right)
  drift: boolean;
  brake: boolean;
  useItem: boolean;
  rocketTap?: boolean;
  updatedAt: number;
}

export interface KartRacerInit {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
}

export interface KartState {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
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
  // Drifting & boosts
  drifting: boolean;
  driftDir: number; // -1 or +1
  driftTime: number;
  driftLevel: 0 | 1 | 2; // 0=none, 1=blue sparks, 2=orange sparks
  boostTimer: number;
  // Status effects
  spinOutTimer: number;
  shrinkTimer: number;
  starTimer: number;
  offRoad: boolean;
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
  kind: 'green_shell' | 'red_shell' | 'banana';
  ownerId: string;
  targetId: string | null;
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
}

export interface KartRaceSim {
  roomCode: string;
  raceId: string;
  trackId: TrackId;
  track: KartTrack;
  totalLaps: number;
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
  elapsedMs: number;
  countdownMs: number;
  finishCountdownMs: number | null;
  announcement: string | null;
  karts: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    isBot: boolean;
    x: number;
    z: number;
    angle: number;
    speed: number;
    lap: number;
    progress: number;
    rank: number;
    finished: boolean;
    finishRank: number | null;
    finishTimeMs: number | null;
    drifting: boolean;
    driftDir: number;
    driftLevel: 0 | 1 | 2;
    boostTimer: number;
    spinOutTimer: number;
    shrinkTimer: number;
    starTimer: number;
    offRoad: boolean;
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

function rollWeightedItem(rank: number, totalKarts: number): KartItemType {
  const normPos = totalKarts > 1 ? (rank - 1) / (totalKarts - 1) : 0.5; // 0 = 1st place, 1 = last place
  const r = Math.random();
  if (normPos <= 0.2) {
    // Leader / 2nd place: defensive & skill items
    if (r < 0.45) return 'banana';
    if (r < 0.85) return 'green_shell';
    return 'mushroom';
  }
  if (normPos <= 0.6) {
    // Mid-pack: offensive & boost items
    if (r < 0.30) return 'mushroom';
    if (r < 0.60) return 'red_shell';
    if (r < 0.80) return 'green_shell';
    if (r < 0.92) return 'banana';
    return 'star';
  }
  // Back of the pack: powerful catch-up items!
  if (r < 0.30) return 'red_shell';
  if (r < 0.58) return 'mushroom';
  if (r < 0.82) return 'star';
  return 'lightning';
}

export function buildKartRacers(
  humanRacers: { id: string; name: string; avatar?: string; avatarColor: string }[],
  fillWithBots: boolean,
  targetGridSize = 8,
): KartRacerInit[] {
  const racers: KartRacerInit[] = humanRacers.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || '🏎️',
    color: p.avatarColor || '#38bdf8',
    isBot: false,
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
  onFinish?: (sim: KartRaceSim) => void;
}): KartRaceSim {
  stopKartSimulation(opts.roomCode);

  const track = KART_TRACKS[opts.trackId] || KART_TRACKS['sunny-circuit'];
  const totalLaps = opts.totalLaps || 3;
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
      updatedAt: Date.now(),
    };

    karts[r.id] = {
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      color: r.color,
      isBot: r.isBot,
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
      drifting: false,
      driftDir: 0,
      driftTime: 0,
      driftLevel: 0,
      boostTimer: 0,
      spinOutTimer: 0,
      shrinkTimer: 0,
      starTimer: 0,
      offRoad: false,
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
    stats: { drifts: {}, hits: {}, spunOut: {} },
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
  const prev = sim.inputs[playerId] || { steer: 0, drift: false, brake: false, useItem: false, updatedAt: 0 };
  const steer = typeof raw.steer === 'number' && Number.isFinite(raw.steer)
    ? Math.max(-1, Math.min(1, raw.steer))
    : prev.steer;
  const drift = typeof raw.drift === 'boolean' ? raw.drift : prev.drift;
  const brake = typeof raw.brake === 'boolean' ? raw.brake : prev.brake;
  // Latch useItem=true until the next physics tick consumes it so a quick tap is never missed
  const useItem = raw.useItem === true ? true : prev.useItem;
  const rocketTap = raw.rocketTap === true ? true : prev.rocketTap;

  sim.inputs[playerId] = {
    steer,
    drift,
    brake,
    useItem,
    rocketTap,
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

function fireKartItem(sim: KartRaceSim, k: KartState) {
  const item = k.heldItem;
  if (!item) return;
  k.heldItem = null;

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
  }
}

function computeBotInput(sim: KartRaceSim, k: KartState, dt: number, leaderProgress: number): KartInputState {
  const m = sim.track.samples.length;
  // Pure-pursuit lookahead along uniform spline samples
  const lookAheadIdx = (k.sampleIdx + 9) % m;
  const farAheadIdx = (k.sampleIdx + 18) % m;
  const targetSample = sim.track.samples[lookAheadIdx];
  const farSample = sim.track.samples[farAheadIdx];

  // Pull bot's target lane toward the apex on sharper corners so bots carve clean racing lines
  const cornerDiff = normalizeAngle(farSample.angle - targetSample.angle);
  const apexBias = Math.max(-1, Math.min(1, -cornerDiff * 1.4)) * (sim.track.roadWidth * 0.16);
  const laneLateral = Math.max(
    -sim.track.roadWidth * 0.28,
    Math.min(sim.track.roadWidth * 0.28, k.aiTargetLateral * 0.7 + apexBias),
  );

  const targetX = targetSample.x + targetSample.nx * laneLateral;
  const targetZ = targetSample.z + targetSample.nz * laneLateral;

  const desiredAngle = Math.atan2(targetX - k.x, targetZ - k.z);
  const diff = normalizeAngle(desiredAngle - k.angle);
  // Since +steer decreases k.angle (turns right), steer = -diff * gain
  const steer = Math.max(-1, Math.min(1, -diff * 2.6));
  const sharpTurn = Math.abs(cornerDiff) > 0.28 && Math.abs(diff) < 0.45;

  let useItem = false;
  if (k.heldItem) {
    k.aiUseItemDelay -= dt;
    if (k.aiUseItemDelay <= 0) {
      useItem = true;
      k.aiUseItemDelay = 1.4 + Math.random() * 1.5;
    }
  }

  void leaderProgress;
  return {
    steer,
    drift: sharpTurn && k.speed > 40,
    brake: false,
    useItem,
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
    if (k.spinOutTimer > 0) k.spinOutTimer = Math.max(0, k.spinOutTimer - dt);
    if (k.shrinkTimer > 0) k.shrinkTimer = Math.max(0, k.shrinkTimer - dt);
    if (k.starTimer > 0) k.starTimer = Math.max(0, k.starTimer - dt);

    // Finished karts cruise on gentle autopilot
    const inp = k.isBot || k.finished
      ? computeBotInput(sim, k, dt, leaderProgress)
      : sim.inputs[k.id] || { steer: 0, drift: false, brake: false, useItem: false, updatedAt: 0 };

    // Consume item use
    if (inp.useItem && !k.finished && k.spinOutTimer <= 0) {
      if (k.itemRouletteTimer > 0 && k.pendingItem) {
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
    }

    // Handle spin-out state
    if (k.spinOutTimer > 0) {
      k.speed = Math.max(0, k.speed - 65 * dt);
      k.drifting = false;
      k.driftTime = 0;
      k.driftLevel = 0;
    } else {
      // Drifting logic
      const wantsDrift = inp.drift && !inp.brake && k.speed > 22;
      if (wantsDrift) {
        if (!k.drifting && Math.abs(inp.steer) > 0.08) {
          k.drifting = true;
          k.driftDir = Math.sign(inp.steer);
          k.driftTime = 0;
          k.driftLevel = 0;
        }
        if (k.drifting) {
          // Allow switching drift direction if player steers strongly the other way
          if (!k.isBot && inp.steer * k.driftDir < -0.55 && k.driftTime < 0.4) {
            k.driftDir = Math.sign(inp.steer);
          }
          const intoTurn = Math.max(0.5, 1 + inp.steer * k.driftDir * 0.75);
          k.driftTime += dt * intoTurn;
          if (k.driftTime >= 1.35) k.driftLevel = 2;
          else if (k.driftTime >= 0.6) k.driftLevel = 1;
        }
      } else if (k.drifting) {
        // Released drift -> check mini-turbo!
        if (k.driftLevel === 2) {
          k.boostTimer = Math.max(k.boostTimer, 1.85);
          sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
          setKartStatus(k, '🔥 SUPER MINI-TURBO!', sim.elapsedMs, 1600);
        } else if (k.driftLevel === 1) {
          k.boostTimer = Math.max(k.boostTimer, 1.15);
          sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
          setKartStatus(k, '💨 MINI-TURBO!', sim.elapsedMs, 1300);
        }
        k.drifting = false;
        k.driftDir = 0;
        k.driftTime = 0;
        k.driftLevel = 0;
      }

      const trackSample = sim.track.samples[k.sampleIdx] || sim.track.samples[0];
      const isBotLike = k.isBot || k.finished;

      if (isBotLike) {
        // Pure-pursuit spline steering for AI bots & post-finish autopilot
        const m = sim.track.samples.length;
        const lookSample = sim.track.samples[(k.sampleIdx + 8) % m];
        const laneTarget = Math.max(
          -sim.track.roadWidth * 0.26,
          Math.min(sim.track.roadWidth * 0.26, k.aiTargetLateral),
        );
        const tx = lookSample.x + lookSample.nx * laneTarget;
        const tz = lookSample.z + lookSample.nz * laneTarget;
        const desiredAngle = Math.atan2(tx - k.x, tz - k.z);
        const diff = normalizeAngle(desiredAngle - k.angle);
        const maxBotTurn = 3.8 * dt;
        k.angle = normalizeAngle(k.angle + Math.max(-maxBotTurn, Math.min(maxBotTurn, diff)));
      } else {
        // Human Smart Arcade Steering (Mario Kart 8 style):
        // 1. Follow 72% of natural road curvature while moving forward so sweeping curves feel effortless
        const forwardStep = Math.max(0, k.speed) * dt;
        const roadCurveDelta = forwardStep * (trackSample.curvature || 0) * 0.72;

        // 2. Apply responsive player steering (in Three.js chase cam, +steer turns right = -angle)
        const turnRate = k.drifting ? 2.85 : 2.45;
        const frictionTurn = 0.8 + 0.2 * sim.track.friction;
        const effectiveSteer = k.drifting
          ? k.driftDir * 0.42 + inp.steer * 0.78
          : inp.steer;
        const speedFactor = Math.min(1, Math.max(0.45, Math.abs(k.speed) / 26));
        const playerDelta = -effectiveSteer * turnRate * frictionTurn * speedFactor * dt;

        k.angle = normalizeAngle(k.angle + roadCurveDelta + playerDelta);

        // 3. Self-aligning assist when steering wheel is held near neutral & clamp max angle to ±52° so you never spin backwards
        let headingRel = normalizeAngle(k.angle - trackSample.angle);
        const neutralAmount = Math.max(0, 1 - Math.abs(effectiveSteer) * 1.8);
        if (neutralAmount > 0 && k.speed > 5) {
          headingRel *= Math.exp(-3.0 * neutralAmount * dt);
        }

        // 4. Smart Curb Assist: when near road edge, gently deflect heading back toward the asphalt
        const halfRoad = sim.track.roadWidth * 0.5;
        const edgeRatio = k.lateralOffset / halfRoad; // -1 = left curb, +1 = right curb
        // Note: headingRel < 0 points toward +lateralOffset (right side); headingRel > 0 points toward -lateralOffset (left side)
        if (edgeRatio > 0.78 && headingRel < 0.08) {
          headingRel += (edgeRatio - 0.78) * 4.5 * dt;
        } else if (edgeRatio < -0.78 && headingRel > -0.08) {
          headingRel += (edgeRatio + 0.78) * 4.5 * dt;
        }

        const maxHeading = 0.92; // ±52 deg max deviation from track forward direction
        headingRel = Math.max(-maxHeading, Math.min(maxHeading, headingRel));
        k.angle = normalizeAngle(trackSample.angle + headingRel);
      }

      // Top speed & acceleration calculation
      let baseTopSpeed = 55;
      if (k.isBot) {
        const gap = leaderProgress - k.totalProgress;
        if (gap > 0.22) baseTopSpeed = 56.5; // Catch-up
        else if (gap < -0.1) baseTopSpeed = 50.0; // Let humans catch up
        else baseTopSpeed = 52.0;
      } else {
        // Gentle position rubber-banding for trailing humans
        const rankRatio = (k.rank - 1) / Math.max(1, allKarts.length - 1);
        baseTopSpeed = 55.5 + rankRatio * 3.5;
      }

      if (k.finished) baseTopSpeed = 38;
      if (k.shrinkTimer > 0) baseTopSpeed *= 0.76;
      if (k.starTimer > 0) baseTopSpeed *= 1.28;
      else if (k.boostTimer > 0) baseTopSpeed *= 1.32;

      const ignoreOffRoad = k.boostTimer > 0 || k.starTimer > 0;
      if (k.offRoad && !ignoreOffRoad) {
        baseTopSpeed *= 0.8;
      }

      if (inp.brake && !k.finished) {
        // Brake / Reverse
        k.speed = Math.max(-16, k.speed - 58 * dt);
      } else {
        const accel = k.boostTimer > 0 || k.starTimer > 0 ? 82 : 42;
        if (k.speed < baseTopSpeed) {
          k.speed = Math.min(baseTopSpeed, k.speed + accel * dt);
        } else {
          k.speed = Math.max(baseTopSpeed, k.speed - 28 * dt);
        }
      }
    }

    // Move kart in XZ plane
    k.x += Math.sin(k.angle) * k.speed * dt;
    k.z += Math.cos(k.angle) * k.speed * dt;

    // Project onto track spline for progress, off-road, and outer wall collision
    const proj = projectOntoTrack(sim.track, k.x, k.z, k.sampleIdx);
    k.sampleIdx = proj.sampleIdx;
    k.lateralOffset = proj.lateralOffset;
    const halfRoad = sim.track.roadWidth * 0.5;

    // Keep AI bots strictly inside the asphalt road
    if ((k.isBot || k.finished) && Math.abs(k.lateralOffset) > halfRoad * 0.8) {
      const clampedLat = Math.sign(k.lateralOffset) * halfRoad * 0.8;
      k.x = proj.sample.x + proj.sample.nx * clampedLat;
      k.z = proj.sample.z + proj.sample.nz * clampedLat;
      k.lateralOffset = clampedLat;
    }

    k.offRoad = Math.abs(k.lateralOffset) > halfRoad;

    // Soft Smart Curb / Outer Wall cushion for human racers so you never get stuck on a wall
    const maxWallOffset = sim.track.wallWidth - 1.5;
    if (Math.abs(proj.lateralOffset) > maxWallOffset) {
      const sign = Math.sign(proj.lateralOffset);
      k.x = proj.sample.x + proj.sample.nx * sign * maxWallOffset;
      k.z = proj.sample.z + proj.sample.nz * sign * maxWallOffset;
      k.lateralOffset = sign * maxWallOffset;
      k.speed *= 0.92;
      k.angle = proj.sample.angle;
    }

    // Lap & checkpoint tracking
    const prevProgress = k.progress;
    const newProgress = proj.progress;
    if (newProgress >= 0.42 && newProgress <= 0.68) {
      k.passedHalfway = true;
    }

    if (!k.finished && sim.elapsedMs > 2500) {
      // Crossed start/finish line forward
      if (prevProgress > 0.78 && newProgress < 0.22 && k.passedHalfway) {
        k.lap++;
        k.passedHalfway = false;
        if (k.lap === sim.totalLaps) {
          setKartStatus(k, '🔔 FINAL LAP!', sim.elapsedMs, 2600);
        } else if (k.lap > sim.totalLaps) {
          k.finished = true;
          k.finishTimeMs = Math.round(sim.elapsedMs);
          k.finishRank = sim.nextFinishRank++;
          setKartStatus(k, `🏁 FINISHED #${k.finishRank}!`, sim.elapsedMs, 10000);
          if (!k.isBot && sim.finishCountdownMs === null) {
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
      // Avoid rank jump right before start line on lap 1 before passing halfway
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
        if (k.boostTimer < 1.2) {
          k.boostTimer = 1.25;
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
          k.pendingItem = rollWeightedItem(k.rank, allKarts.length);
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

  // Step hazards (shells & bananas)
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
          // Reflect velocity across track normal
          const dot = h.vx * proj.sample.nx + h.vz * proj.sample.nz;
          h.vx -= 2 * dot * proj.sample.nx;
          h.vz -= 2 * dot * proj.sample.nz;
          h.angle = Math.atan2(h.vx, h.vz);
        } else {
          continue;
        }
      }
    } else if (h.kind === 'red_shell') {
      const target = h.targetId ? sim.karts[h.targetId] : null;
      const speed = 90;
      if (target && !target.finished && Math.hypot(target.x - h.x, target.z - h.z) < 28) {
        // Direct lock-on when close
        const desired = Math.atan2(target.x - h.x, target.z - h.z);
        h.angle = desired;
        h.vx = Math.sin(desired) * speed;
        h.vz = Math.cos(desired) * speed;
        h.x += h.vx * dt;
        h.z += h.vz * dt;
      } else {
        // Follow track centerline spline
        h.progress = (h.progress + (speed * dt) / sim.track.totalLength) % 1;
        const s = sampleTrackAtProgress(sim.track, h.progress);
        h.x = s.x;
        h.z = s.z;
        h.angle = s.angle;
      }
    }

    // Check collision with karts
    let hitKart: KartState | null = null;
    for (const k of allKarts) {
      if (k.finished) continue;
      // Brief grace period for the thrower right after firing
      if (k.id === h.ownerId && h.ttl > (h.kind === 'banana' ? 44.2 : 8.4)) continue;
      const hitRadius = h.kind === 'banana' ? 2.4 : 2.9;
      if (Math.hypot(k.x - h.x, k.z - h.z) < hitRadius) {
        hitKart = k;
        break;
      }
    }

    if (hitKart) {
      if (hitKart.starTimer <= 0) {
        hitKart.spinOutTimer = 1.15;
        hitKart.speed *= 0.25;
        hitKart.drifting = false;
        hitKart.driftLevel = 0;
        if (h.ownerId && h.ownerId !== hitKart.id && sim.karts[h.ownerId]) {
          sim.stats.hits[h.ownerId] = (sim.stats.hits[h.ownerId] || 0) + 1;
          setKartStatus(sim.karts[h.ownerId], `🎯 HIT ${hitKart.name}!`, sim.elapsedMs, 1800);
        }
        sim.stats.spunOut[hitKart.id] = (sim.stats.spunOut[hitKart.id] || 0) + 1;
        const label = h.kind === 'banana' ? '🍌 SLIPPED ON BANANA!' : '💥 HIT BY SHELL!';
        setKartStatus(hitKart, label, sim.elapsedMs, 1800);
      }
      continue; // Hazard consumed
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

  if (sim.finishCountdownMs !== null) {
    sim.finishCountdownMs = Math.max(0, sim.finishCountdownMs - dtMs);
  }

  if (
    allHumansFinished ||
    (sim.finishCountdownMs !== null && sim.finishCountdownMs <= 0) ||
    sim.elapsedMs >= MAX_RACE_DURATION_MS
  ) {
    // Assign final ranks to any unfinished karts based on current progress order
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
    elapsedMs: Math.round(sim.elapsedMs),
    countdownMs: Math.round(sim.countdownMs),
    finishCountdownMs: sim.finishCountdownMs !== null ? Math.round(sim.finishCountdownMs) : null,
    announcement: sim.announcement,
    karts: sim.kartOrder.map((id) => {
      const k = sim.karts[id];
      return {
        id: k.id,
        name: k.name,
        avatar: k.avatar,
        color: k.color,
        isBot: k.isBot,
        x: Math.round(k.x * 100) / 100,
        z: Math.round(k.z * 100) / 100,
        angle: Math.round(k.angle * 1000) / 1000,
        speed: Math.round(k.speed * 10) / 10,
        lap: Math.min(k.lap, sim.totalLaps),
        progress: Math.round(k.progress * 1000) / 1000,
        rank: k.rank,
        finished: k.finished,
        finishRank: k.finishRank,
        finishTimeMs: k.finishTimeMs,
        drifting: k.drifting,
        driftDir: k.driftDir,
        driftLevel: k.driftLevel,
        boostTimer: Math.round(k.boostTimer * 10) / 10,
        spinOutTimer: Math.round(k.spinOutTimer * 10) / 10,
        shrinkTimer: Math.round(k.shrinkTimer * 10) / 10,
        starTimer: Math.round(k.starTimer * 10) / 10,
        offRoad: k.offRoad,
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
