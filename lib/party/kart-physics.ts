import { partyEmitter } from './emitter';
import { KART_STYLES, KartItemType, KartItemsMode, KartSpeedClass, KartStyle } from './kart-shared';
import { KART_TRACKS, KartTrack, TrackId, projectOntoTrack, sampleTrackAtProgress } from './kart-tracks';

export type { KartItemType, KartItemsMode, KartSpeedClass, KartStyle } from './kart-shared';

/**
 * Engine classes. `assist` scales how strongly the road pulls a kart back onto its line, so
 * 50cc is forgiving and 200cc makes you do the work yourself.
 */
export const SPEED_CLASSES: Record<KartSpeedClass, { maxSpeed: number; accel: number; turn: number; assist: number }> = {
  '50cc': { maxSpeed: 50, accel: 0.88, turn: 1.1, assist: 1.3 },
  '100cc': { maxSpeed: 57, accel: 0.95, turn: 1.05, assist: 1.12 },
  '150cc': { maxSpeed: 64, accel: 1, turn: 1, assist: 1 },
  '200cc': { maxSpeed: 78, accel: 1.22, turn: 0.98, assist: 0.82 },
};

export interface KartInputState {
  steer: number; // -1 (left) to +1 (right)
  drift: boolean;
  brake: boolean;
  useItem: boolean;
  rocketTap?: boolean;
  honk?: boolean;
  isHorizontal?: boolean;
  isReady?: boolean;
  seq?: number;
  updatedAt: number;
}

export interface KartRacerInit {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  kartStyle?: KartStyle;
  sparksColor?: string;
}

export interface KartState {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  kartStyle: KartStyle;
  sparksColor: string;
  x: number;
  z: number;
  angle: number; // heading in radians, 0 = +Z, PI/2 = +X, increasing turns left
  velAngle: number; // direction of travel; lags the heading while drifting so karts slide
  speed: number;
  pushX: number; // decaying shove from bumps, walls and blasts
  pushZ: number;
  steerSmooth: number;
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
  dnf: boolean;
  lapStartTimeMs: number;
  bestLapTimeMs: number | null;
  lastLapTimeMs: number | null;
  // Drifting & boosts
  drifting: boolean;
  driftDir: number; // -1 or +1
  driftTime: number;
  driftLevel: 0 | 1 | 2 | 3; // 0=none, 1=blue, 2=orange, 3=ultra purple
  boostTimer: number;
  slipstreamTimer: number;
  goldenShroomTimer: number;
  // Jumps
  airTimer: number; // seconds left in the air
  airDuration: number;
  trickDone: boolean;
  lastRampLap: Record<string, number>;
  // Status effects
  spinOutTimer: number;
  hitImmuneTimer: number;
  shrinkTimer: number;
  starTimer: number;
  offRoad: boolean;
  autopilot: boolean;
  hornUntil: number;
  wallCooldown: number;
  // Items
  heldItem: KartItemType | null;
  itemRouletteTimer: number;
  pendingItem: KartItemType | null;
  itemHeldFor: number;
  // Start-line rocket boost tracking
  launchHoldTimer: number;
  // AI driver
  aiLane: number;
  aiSkill: number;
  aiPhase: number;
  aiUseItemDelay: number;
  aiCurvAhead: number;
  // Telemetry event text for HUD
  statusText: string | null;
  statusUntil: number;
}

export interface KartHazard {
  id: string;
  kind: 'green_shell' | 'red_shell' | 'banana' | 'spiny_shell' | 'fake_box' | 'shockwave';
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
  age: number;
  sampleIdx?: number;
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

export type KartEventType =
  | 'box' | 'boost' | 'pad' | 'miniturbo' | 'rocket' | 'stall' | 'shell' | 'drop' | 'hit' | 'explosion'
  | 'lightning' | 'horn' | 'wall' | 'bump' | 'jump' | 'land' | 'trick' | 'lap' | 'final_lap' | 'finish'
  | 'star' | 'lead' | 'clash' | 'go';

export interface KartEvent {
  id: number;
  tick: number;
  type: KartEventType;
  kartId?: string;
  x?: number;
  z?: number;
  value?: number;
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
  raceTimeMs: number; // clock from the green light, the only time shown to players
  waitingForOrientation: boolean;
  orientationWaitTimerMs: number;
  countdownMs: number; // >0 during 3-2-1 countdown
  finishCountdownMs: number | null; // starts once the first human finishes
  celebrationMs: number | null; // short victory lap after every human is home
  completed: boolean;
  karts: Record<string, KartState>;
  kartOrder: string[];
  inputs: Record<string, KartInputState>;
  itemBoxes: ActiveItemBox[];
  hazards: KartHazard[];
  nextHazardId: number;
  nextFinishRank: number;
  chaosFired: boolean;
  queuedChaos: ChaosEffect | null;
  lastPowerItemAt: number;
  lastLeaderId: string | null;
  lastLeadCallAt: number;
  tick: number;
  events: KartEvent[];
  nextEventId: number;
  announcement: string | null;
  announcementUntil: number;
  stats: KartRaceStats;
  timer?: ReturnType<typeof setInterval>;
  onFinish?: (sim: KartRaceSim) => void;
}

export type ChaosEffect = 'bananas' | 'item-boxes' | 'boost-pack';

export interface KartTelemetrySnapshot {
  roomCode: string;
  raceId: string;
  trackId: TrackId;
  totalLaps: number;
  speedClass: KartSpeedClass;
  elapsedMs: number;
  raceTimeMs: number;
  waitingForOrientation?: boolean;
  orientationAutoStartMs: number;
  humanRacersStatus?: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    isHorizontal: boolean;
  }[];
  countdownMs: number;
  finishCountdownMs: number | null;
  celebrating: boolean;
  announcement: string | null;
  chaosFired: boolean;
  fastestLap?: { racerId: string; racerName: string; timeMs: number } | null;
  karts: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    isBot: boolean;
    kartStyle: KartStyle;
    sparksColor: string;
    x: number;
    z: number;
    angle: number;
    velAngle: number;
    steer: number;
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
    lastLapTimeMs: number | null;
    drifting: boolean;
    driftDir: number;
    driftLevel: 0 | 1 | 2 | 3;
    driftCharge: number; // 0..100% progress towards the next tier
    boostTimer: number;
    slipstreamTimer: number;
    goldenShroomTimer: number;
    spinOutTimer: number;
    shrinkTimer: number;
    starTimer: number;
    airT: number; // 0 on the ground, otherwise 0..1 through the jump arc
    trick: boolean;
    offRoad: boolean;
    autopilot: boolean;
    horn: boolean;
    hasIncomingShell: boolean;
    heldItem: KartItemType | null;
    itemRoulette: boolean;
    statusText: string | null;
  }[];
  itemBoxes: { id: string; x: number; z: number; active: boolean; bonus?: boolean }[];
  hazards: { id: string; kind: KartHazard['kind']; x: number; z: number; angle: number; age: number; ttl: number }[];
  events: KartEvent[];
  timestamp: number;
}

const globalForKart = globalThis as unknown as {
  kartSims?: Map<string, KartRaceSim>;
};

const activeSims: Map<string, KartRaceSim> = globalForKart.kartSims || new Map();
globalForKart.kartSims = activeSims;

const BOT_POOL: { name: string; avatar: string; color: string; style: KartStyle }[] = [
  { name: 'Turbo Tina', avatar: '🦊', color: '#f97316', style: 'rocket' },
  { name: 'Mo Mentum', avatar: '🦖', color: '#22c55e', style: 'bruiser' },
  { name: 'Peach Fuzz', avatar: '🍑', color: '#f472b6', style: 'classic' },
  { name: 'Yolo Yoshi', avatar: '🐸', color: '#4ade80', style: 'cyber' },
  { name: 'Nitro Toad', avatar: '🍄', color: '#ef4444', style: 'classic' },
  { name: 'Big Bowser', avatar: '🐢', color: '#ca8a04', style: 'bruiser' },
  { name: 'Zap Wario', avatar: '⚡', color: '#facc15', style: 'cyber' },
  { name: 'Donkey Drift', avatar: '🦍', color: '#a855f7', style: 'rocket' },
];

const TICK_HZ = 30;
const TICK_DT = 1 / TICK_HZ;
const TICK_MS = 1000 / TICK_HZ;
const COUNTDOWN_MS = 3400;
const MAX_RACE_DURATION_MS = 210_000;
const POST_FIRST_FINISH_MS = 25_000;
const CELEBRATION_MS = 4_500;
const ORIENTATION_TIMEOUT_MS = 20_000;
const STALE_INPUT_MS = 2_500;
const EVENT_KEEP_TICKS = 12; // long enough for a phone's 10Hz stream to see every event

const TURN_RATE = 1.45; // radians per second at full lock
const BASE_ASSIST = 2.6; // how fast the road corrects a kart's heading with no steering
const MAX_ROAD_ANGLE = 1.15; // karts can't turn further than this from the road, so no wrong way
const BOOST_SPEED_MUL = 1.3;
const STAR_SPEED_MUL = 1.24;
const OFFROAD_SPEED_MUL = 0.6;
const ACCEL = 42;
const BOOST_ACCEL = 95;
const GRIP = 12; // how quickly travel direction catches up with the heading
const DRIFT_GRIP = 3.6;
const DRIFT_TIERS = [0.5, 1.15, 1.95] as const;
const DRIFT_BOOSTS = [0.9, 1.5, 2.2] as const;
const HIT_IMMUNITY_S = 1.4;
const SPIN_SPEED_FLOOR = 14;
const BOT_CORNER_YAW = 1.55; // radians per second a bot is willing to corner at

function normalizeAngle(a: number): number {
  let res = a % (Math.PI * 2);
  if (res > Math.PI) res -= Math.PI * 2;
  if (res < -Math.PI) res += Math.PI * 2;
  return res;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function setKartStatus(k: KartState, text: string, elapsedMs: number, durationMs = 2000) {
  k.statusText = text;
  k.statusUntil = elapsedMs + durationMs;
}

function pushEvent(sim: KartRaceSim, type: KartEventType, kart?: KartState | null, extra?: { x?: number; z?: number; value?: number }) {
  sim.events.push({
    id: sim.nextEventId++,
    tick: sim.tick,
    type,
    kartId: kart?.id,
    x: extra?.x ?? (kart ? Math.round(kart.x * 10) / 10 : undefined),
    z: extra?.z ?? (kart ? Math.round(kart.z * 10) / 10 : undefined),
    value: extra?.value,
  });
}

function announce(sim: KartRaceSim, text: string, ms = 3000) {
  sim.announcement = text;
  sim.announcementUntil = sim.elapsedMs + ms;
}

function rollWeightedItem(sim: KartRaceSim, rank: number, totalKarts: number): KartItemType {
  const mode = sim.itemsMode;
  const roll = (): KartItemType => {
    const r = Math.random();
    const normPos = totalKarts > 1 ? (rank - 1) / (totalKarts - 1) : 0.5; // 0 = 1st place, 1 = last place
    if (mode === 'pure') return r < 0.3 ? 'golden_mushroom' : 'mushroom';
    if (mode === 'shells-only') {
      if (rank === 1) return r < 0.55 ? 'banana' : 'green_shell';
      if (normPos > 0.6 && r < 0.25) return 'spiny_shell';
      return r < 0.45 ? 'red_shell' : r < 0.75 ? 'green_shell' : 'banana';
    }
    if (mode === 'frantic') {
      if (rank === 1) return r < 0.3 ? 'super_horn' : r < 0.6 ? 'star' : r < 0.8 ? 'golden_mushroom' : 'fake_box';
      if (r < 0.18) return 'star';
      if (r < 0.36) return 'golden_mushroom';
      if (r < 0.54) return 'red_shell';
      if (r < 0.68) return 'super_horn';
      if (r < 0.82) return 'spiny_shell';
      return 'lightning';
    }
    if (normPos <= 0.2) {
      // Front of the pack: defensive items
      if (r < 0.34) return 'banana';
      if (r < 0.52) return 'green_shell';
      if (r < 0.72) return 'fake_box';
      if (r < 0.86) return 'super_horn';
      return 'mushroom';
    }
    if (normPos <= 0.6) {
      // Mid-pack: attack and boost
      if (r < 0.24) return 'mushroom';
      if (r < 0.48) return 'red_shell';
      if (r < 0.66) return 'green_shell';
      if (r < 0.78) return 'super_horn';
      if (r < 0.88) return 'golden_mushroom';
      if (r < 0.94) return 'star';
      return 'banana';
    }
    // Back of the pack: comeback items
    if (r < 0.24) return 'red_shell';
    if (r < 0.46) return 'golden_mushroom';
    if (r < 0.66) return 'star';
    if (r < 0.8) return 'spiny_shell';
    if (r < 0.92) return 'mushroom';
    return 'lightning';
  };
  // Blue shells and lightning swing a whole race, so never let them stack up.
  for (let i = 0; i < 6; i++) {
    const item = roll();
    const isPower = item === 'spiny_shell' || item === 'lightning';
    const recent = sim.raceTimeMs - sim.lastPowerItemAt < 14_000;
    const spinyLive = sim.hazards.some((h) => h.kind === 'spiny_shell');
    if (isPower && (recent || (item === 'spiny_shell' && spinyLive)) && mode !== 'frantic') continue;
    if (isPower) sim.lastPowerItemAt = sim.raceTimeMs;
    return item;
  }
  return mode === 'pure' ? 'mushroom' : 'green_shell';
}

export function buildKartRacers(
  humanRacers: { id: string; name: string; avatar?: string; avatarColor: string; kartStyle?: KartStyle; sparksColor?: string }[],
  fillWithBots = false,
  targetGridSize = 8,
): KartRacerInit[] {
  const racers: KartRacerInit[] = humanRacers.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar || '🏎️',
    color: p.avatarColor || '#38bdf8',
    isBot: false,
    kartStyle: p.kartStyle || 'classic',
    sparksColor: p.sparksColor || p.avatarColor || '#38bdf8',
  }));

  if (fillWithBots) {
    const usedNames = new Set(racers.map((r) => r.name.toLowerCase()));
    const usedAvatars = new Set(racers.map((r) => r.avatar));
    // Prefer bots whose face isn't already on the grid, then shuffle so grids differ between races
    const pool = [...BOT_POOL]
      .map((b) => ({ b, order: Math.random() + (usedAvatars.has(b.avatar) ? 1 : 0) }))
      .sort((a, c) => a.order - c.order)
      .map(({ b }) => b);
    let botIdx = 0;
    while (racers.length < targetGridSize && botIdx < pool.length) {
      const candidate = pool[botIdx++];
      if (usedNames.has(candidate.name.toLowerCase())) continue;
      racers.push({
        id: `BOT_${botIdx}`,
        name: candidate.name,
        avatar: candidate.avatar,
        color: candidate.color,
        isBot: true,
        kartStyle: candidate.style,
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
  requireOrientation?: boolean;
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
  const m = track.samples.length;

  // Two-column staggered starting grid behind the line; humans start at the back so the
  // first lap is a charge through the pack rather than a lonely lead.
  const gridOrder = [...opts.racers].sort((a, b) => Number(a.isBot === false) - Number(b.isBot === false));
  gridOrder.forEach((r, idx) => {
    const row = Math.floor(idx / 2);
    const col = idx % 2 === 0 ? -1 : 1;
    const startS = 12 + row * 12 + (idx % 2) * 4;
    const startProgress = 1 - startS / track.totalLength;
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
      velAngle: sample.angle,
      speed: 0,
      pushX: 0,
      pushZ: 0,
      steerSmooth: 0,
      lap: 1,
      progress: startProgress,
      totalProgress: startProgress - 1,
      passedHalfway: false,
      sampleIdx: Math.floor(startProgress * m) % m,
      lateralOffset: lateral,
      rank: idx + 1,
      finished: false,
      finishTimeMs: null,
      finishRank: null,
      dnf: false,
      lapStartTimeMs: 0,
      bestLapTimeMs: null,
      lastLapTimeMs: null,
      drifting: false,
      driftDir: 0,
      driftTime: 0,
      driftLevel: 0,
      boostTimer: 0,
      slipstreamTimer: 0,
      goldenShroomTimer: 0,
      airTimer: 0,
      airDuration: 0,
      trickDone: false,
      lastRampLap: {},
      spinOutTimer: 0,
      hitImmuneTimer: 0,
      shrinkTimer: 0,
      starTimer: 0,
      offRoad: false,
      autopilot: false,
      hornUntil: 0,
      wallCooldown: 0,
      heldItem: null,
      itemRouletteTimer: 0,
      pendingItem: null,
      itemHeldFor: 0,
      launchHoldTimer: 0,
      aiLane: lateral * 0.5,
      aiSkill: 0.965 + Math.random() * 0.05,
      aiPhase: Math.random() * Math.PI * 2,
      aiUseItemDelay: 1.5,
      aiCurvAhead: 0,
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

  const waitingForOrientation = Boolean(opts.requireOrientation);
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
    raceTimeMs: 0,
    waitingForOrientation,
    orientationWaitTimerMs: 0,
    countdownMs: COUNTDOWN_MS,
    finishCountdownMs: null,
    celebrationMs: null,
    completed: false,
    karts,
    kartOrder,
    inputs,
    itemBoxes,
    hazards: [],
    nextHazardId: 1,
    nextFinishRank: 1,
    chaosFired: false,
    queuedChaos: null,
    lastPowerItemAt: -60_000,
    lastLeaderId: null,
    lastLeadCallAt: 0,
    tick: 0,
    events: [],
    nextEventId: 1,
    announcement: null,
    announcementUntil: 0,
    stats: { drifts: {}, hits: {}, spunOut: {}, fastestLap: null },
    onFinish: opts.onFinish,
  };

  activeSims.set(opts.roomCode, sim);
  return sim;
}

export function startKartSimulationLoop(sim: KartRaceSim) {
  if (sim.timer) clearInterval(sim.timer);
  let tickCount = 0;
  let last = performance.now();
  let accumulator = 0;
  // A fixed-step accumulator keeps race speed honest when the host machine stutters.
  sim.timer = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min(now - last, 250);
    last = now;
    let stepped = false;
    while (accumulator >= TICK_MS && !sim.completed) {
      stepKartSimulation(sim, TICK_DT);
      accumulator -= TICK_MS;
      stepped = true;
    }
    if (!stepped) return;
    tickCount++;
    const channel = `kart-tick-${sim.roomCode}`;
    if (partyEmitter.listenerCount(channel) > 0) {
      partyEmitter.emit(channel, JSON.stringify(getKartSnapshot(sim)), tickCount);
    }
    if (sim.completed) {
      if (sim.timer) clearInterval(sim.timer);
      sim.timer = undefined;
      sim.onFinish?.(sim);
    }
  }, 16);
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

export function forceStartCountdown(roomCode: string): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || !sim.waitingForOrientation) return false;
  sim.waitingForOrientation = false;
  sim.countdownMs = COUNTDOWN_MS;
  return true;
}

export function updateKartInput(roomCode: string, playerId: string, raw: Partial<KartInputState>): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || !sim.karts[playerId]) return false;
  const prev = sim.inputs[playerId] || { steer: 0, drift: false, brake: false, useItem: false, honk: false, isHorizontal: false, isReady: false, updatedAt: 0 };
  // Phones post over plain HTTP, so packets can overtake each other. Taps are always
  // honoured, but stale held state (steering, drift) must not overwrite newer state.
  const stale = typeof raw.seq === 'number' && typeof prev.seq === 'number' && raw.seq < prev.seq;
  const steer = !stale && typeof raw.steer === 'number' && Number.isFinite(raw.steer)
    ? clamp(raw.steer, -1, 1)
    : prev.steer;
  const drift = !stale && typeof raw.drift === 'boolean' ? raw.drift : prev.drift;
  const brake = !stale && typeof raw.brake === 'boolean' ? raw.brake : prev.brake;
  // Latch taps until the next physics tick consumes them so a quick press is never missed
  const useItem = raw.useItem === true ? true : prev.useItem;
  const rocketTap = raw.rocketTap === true ? true : prev.rocketTap;
  const isHorizontal = !stale && typeof raw.isHorizontal === 'boolean' ? raw.isHorizontal : prev.isHorizontal;
  const isReady = !stale && typeof raw.isReady === 'boolean' ? raw.isReady : prev.isReady;
  if (raw.honk === true) {
    const k = sim.karts[playerId];
    if (sim.elapsedMs >= k.hornUntil) pushEvent(sim, 'horn', k);
    k.hornUntil = sim.elapsedMs + 600;
  }

  sim.inputs[playerId] = {
    steer,
    drift,
    brake,
    useItem,
    rocketTap,
    honk: false,
    isHorizontal,
    isReady,
    seq: !stale && typeof raw.seq === 'number' ? raw.seq : prev.seq,
    updatedAt: Date.now(),
  };
  return true;
}

export function triggerChaosDrop(roomCode: string, effect: ChaosEffect): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || sim.completed) return false;

  const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
  const leader = ranked[0];
  if (!leader) return false;
  sim.chaosFired = true;
  sim.queuedChaos = null;
  pushEvent(sim, 'clash');

  if (effect === 'bananas') {
    // A scattered wall of bananas just ahead of the leader
    for (let i = 1; i <= 7; i++) {
      const p = (leader.progress + 0.025 + i * 0.008) % 1;
      const s = sampleTrackAtProgress(sim.track, p);
      const lat = ((i % 3) - 1) * (sim.track.roadWidth * 0.3);
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
        age: 0,
      });
    }
    announce(sim, '🍌 PIT CREW CHAOS: Banana shower ahead of the leader!', 4000);
  } else if (effect === 'item-boxes') {
    for (const k of ranked) {
      if (k.finished) continue;
      const p = (k.progress + 0.03) % 1;
      const s = sampleTrackAtProgress(sim.track, p);
      sim.itemBoxes.push({
        id: `bonus_box_${sim.nextHazardId++}`,
        x: s.x,
        z: s.z,
        respawnTimer: 0,
        isBonus: true,
      });
    }
    announce(sim, '📦 PIT CREW CHAOS: Mystery boxes dropped on the track!', 4000);
  } else if (effect === 'boost-pack') {
    for (const k of ranked.slice(1)) {
      if (k.finished) continue;
      k.boostTimer = Math.max(k.boostTimer, 2.2);
      setKartStatus(k, '⚡ CROWD TURBO!', sim.elapsedMs, 2200);
    }
    announce(sim, '⚡ PIT CREW CHAOS: Turbo for everyone but the leader!', 4000);
  }
  return true;
}

/** Pit crew votes can land before the race is under way; the drop waits for the action. */
export function queueChaosDrop(roomCode: string, effect: ChaosEffect): boolean {
  const sim = activeSims.get(roomCode);
  if (!sim || sim.completed || sim.chaosFired) return false;
  sim.queuedChaos = effect;
  return true;
}

function spinKart(
  sim: KartRaceSim,
  k: KartState,
  opts: { duration: number; speedMul: number; label: string; attackerId?: string | null; push?: { x: number; z: number } },
): boolean {
  if (k.finished || k.starTimer > 0 || k.hitImmuneTimer > 0) return false;
  k.spinOutTimer = Math.max(k.spinOutTimer, opts.duration);
  k.hitImmuneTimer = opts.duration + HIT_IMMUNITY_S;
  k.speed *= opts.speedMul;
  k.drifting = false;
  k.driftDir = 0;
  k.driftTime = 0;
  k.driftLevel = 0;
  if (opts.push) {
    k.pushX += opts.push.x;
    k.pushZ += opts.push.z;
  }
  sim.stats.spunOut[k.id] = (sim.stats.spunOut[k.id] || 0) + 1;
  if (opts.attackerId && opts.attackerId !== k.id && sim.karts[opts.attackerId]) {
    sim.stats.hits[opts.attackerId] = (sim.stats.hits[opts.attackerId] || 0) + 1;
    setKartStatus(sim.karts[opts.attackerId], `🎯 HIT ${k.name}!`, sim.elapsedMs, 1800);
  }
  setKartStatus(k, opts.label, sim.elapsedMs, 1800);
  pushEvent(sim, 'hit', k);
  return true;
}

function spawnHazard(sim: KartRaceSim, hazard: Omit<KartHazard, 'id' | 'age'>): KartHazard {
  const h: KartHazard = { ...hazard, id: `haz_${sim.nextHazardId++}`, age: 0 };
  sim.hazards.push(h);
  return h;
}

export function fireKartItem(sim: KartRaceSim, target: string | KartState) {
  const k = typeof target === 'string' ? sim.karts[target] : target;
  if (!k) return;
  const item = k.heldItem;
  if (!item) return;
  if (item !== 'golden_mushroom') {
    k.heldItem = null;
  }
  k.itemHeldFor = 0;
  const shellScale = SPEED_CLASSES[sim.speedClass].maxSpeed / SPEED_CLASSES['150cc'].maxSpeed;

  switch (item) {
    case 'mushroom': {
      k.boostTimer = Math.max(k.boostTimer, 1.7);
      setKartStatus(k, '🍄 TURBO BOOST!', sim.elapsedMs, 1500);
      pushEvent(sim, 'boost', k);
      break;
    }
    case 'star': {
      k.starTimer = Math.max(k.starTimer, 7.0);
      k.shrinkTimer = 0;
      k.spinOutTimer = 0;
      setKartStatus(k, '⭐ SUPER STAR!', sim.elapsedMs, 2500);
      pushEvent(sim, 'star', k);
      break;
    }
    case 'lightning': {
      for (const other of Object.values(sim.karts)) {
        if (other.id === k.id || other.finished || other.starTimer > 0) continue;
        other.shrinkTimer = 5.0;
        other.speed *= 0.5;
        other.spinOutTimer = Math.max(other.spinOutTimer, 0.7);
        other.drifting = false;
        other.driftDir = 0;
        other.driftTime = 0;
        other.driftLevel = 0;
        sim.stats.hits[k.id] = (sim.stats.hits[k.id] || 0) + 1;
        sim.stats.spunOut[other.id] = (sim.stats.spunOut[other.id] || 0) + 1;
        setKartStatus(other, '⚡ ZAPPED & SHRUNK!', sim.elapsedMs, 2500);
      }
      announce(sim, `⚡ ${k.name} called down the lightning!`, 3000);
      setKartStatus(k, '⚡ LIGHTNING!', sim.elapsedMs, 2000);
      pushEvent(sim, 'lightning', k);
      break;
    }
    case 'banana': {
      spawnHazard(sim, {
        kind: 'banana',
        ownerId: k.id,
        targetId: null,
        x: k.x - Math.sin(k.angle) * 4.2,
        z: k.z - Math.cos(k.angle) * 4.2,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 0,
        ttl: 45,
      });
      pushEvent(sim, 'drop', k);
      break;
    }
    case 'green_shell': {
      const shellSpeed = 100 * shellScale;
      spawnHazard(sim, {
        kind: 'green_shell',
        ownerId: k.id,
        targetId: null,
        x: k.x + Math.sin(k.angle) * 4.5,
        z: k.z + Math.cos(k.angle) * 4.5,
        vx: Math.sin(k.angle) * shellSpeed,
        vz: Math.cos(k.angle) * shellSpeed,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 4,
        ttl: 9,
        sampleIdx: k.sampleIdx,
      });
      pushEvent(sim, 'shell', k);
      break;
    }
    case 'red_shell': {
      // The racer directly ahead. From 1st place it just runs the road and takes whoever it finds.
      const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
      const myIdx = ranked.findIndex((r) => r.id === k.id);
      const shellTarget = myIdx > 0 && !ranked[myIdx - 1].finished ? ranked[myIdx - 1] : null;
      if (shellTarget) setKartStatus(shellTarget, '⚠️ RED SHELL!', sim.elapsedMs, 1600);
      spawnHazard(sim, {
        kind: 'red_shell',
        ownerId: k.id,
        targetId: shellTarget ? shellTarget.id : null,
        x: k.x + Math.sin(k.angle) * 4.5,
        z: k.z + Math.cos(k.angle) * 4.5,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: (k.progress + 0.004) % 1,
        bouncesLeft: 0,
        ttl: 9,
        sampleIdx: k.sampleIdx,
      });
      pushEvent(sim, 'shell', k);
      break;
    }
    case 'spiny_shell': {
      const ranked = Object.values(sim.karts).sort((a, b) => a.rank - b.rank);
      const leader = ranked.find((r) => !r.finished) || null;
      if (leader && leader.id !== k.id) setKartStatus(leader, '🚨 BLUE SHELL INCOMING!', sim.elapsedMs, 3000);
      spawnHazard(sim, {
        kind: 'spiny_shell',
        ownerId: k.id,
        targetId: leader ? leader.id : null,
        x: k.x,
        z: k.z,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: (k.progress + 0.004) % 1,
        bouncesLeft: 0,
        ttl: 16,
      });
      announce(sim, `🚨 ${k.name} launched a Blue Shell at ${leader?.name || 'the leader'}!`, 3200);
      pushEvent(sim, 'shell', k);
      break;
    }
    case 'golden_mushroom': {
      k.goldenShroomTimer = Math.max(k.goldenShroomTimer, 5.5);
      k.boostTimer = Math.max(k.boostTimer, 1.2);
      setKartStatus(k, '✨ GOLDEN! KEEP TAPPING!', sim.elapsedMs, 1800);
      pushEvent(sim, 'boost', k);
      break;
    }
    case 'super_horn': {
      const blastRadius = 16;
      spawnHazard(sim, {
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
      sim.hazards = sim.hazards.filter((h) => h.kind === 'shockwave' || Math.hypot(h.x - k.x, h.z - k.z) > blastRadius);
      for (const other of Object.values(sim.karts)) {
        if (other.id === k.id) continue;
        const dx = other.x - k.x;
        const dz = other.z - k.z;
        const d = Math.hypot(dx, dz);
        if (d <= blastRadius) {
          spinKart(sim, other, {
            duration: 1.0,
            speedMul: 0.4,
            label: `📯 BLASTED BY ${k.name.toUpperCase()}!`,
            attackerId: k.id,
            push: { x: (dx / (d || 1)) * 16, z: (dz / (d || 1)) * 16 },
          });
        }
      }
      setKartStatus(k, '📯 SUPER HORN!', sim.elapsedMs, 1400);
      pushEvent(sim, 'horn', k, { value: 1 });
      break;
    }
    case 'fake_box': {
      spawnHazard(sim, {
        kind: 'fake_box',
        ownerId: k.id,
        targetId: null,
        x: k.x - Math.sin(k.angle) * 4.2,
        z: k.z - Math.cos(k.angle) * 4.2,
        vx: 0,
        vz: 0,
        angle: k.angle,
        progress: k.progress,
        bouncesLeft: 0,
        ttl: 50,
      });
      pushEvent(sim, 'drop', k);
      break;
    }
  }
}

/** Progress difference in world units going forward from a to b. */
function forwardGap(track: KartTrack, a: number, b: number): number {
  return ((((b - a) % 1) + 1) % 1) * track.totalLength;
}

function botWantsItem(sim: KartRaceSim, k: KartState, curvAhead: number): boolean {
  if (k.itemHeldFor < k.aiUseItemDelay) return false;
  const others = Object.values(sim.karts).filter((o) => o.id !== k.id && !o.finished);
  const behindClose = others.some((o) => forwardGap(sim.track, o.progress, k.progress) < 34);
  const aheadClose = others.some((o) => forwardGap(sim.track, k.progress, o.progress) < 42 && Math.abs(o.lateralOffset - k.lateralOffset) < 7);
  const incoming = sim.hazards.some((h) => (h.kind === 'red_shell' || h.kind === 'spiny_shell') && h.targetId === k.id);
  const patience = k.itemHeldFor > 9;
  switch (k.heldItem) {
    case 'banana':
    case 'fake_box':
      return behindClose || patience;
    case 'green_shell':
      return aheadClose || patience;
    case 'red_shell':
      return k.rank > 1 || patience;
    case 'spiny_shell':
    case 'lightning':
      return true;
    case 'mushroom':
    case 'golden_mushroom':
      return Math.abs(curvAhead) < 0.007 || k.offRoad || patience;
    case 'star':
      return incoming || k.rank > 2 || patience;
    case 'super_horn':
      return incoming || others.filter((o) => Math.hypot(o.x - k.x, o.z - k.z) < 14).length >= 2 || patience;
    default:
      return false;
  }
}

/**
 * AI driver: a pure-pursuit steering target on a lane that hugs the apex, dodges what's on the
 * road and picks up what's useful, fed through the same controls humans use.
 */
function computeBotInput(sim: KartRaceSim, k: KartState, dt: number): KartInputState {
  const track = sim.track;
  const m = track.samples.length;
  const halfRoad = track.roadWidth * 0.5;
  const ds = track.totalLength / m;

  // Average curvature over the next stretch to anticipate the corner
  const lookSamples = Math.max(3, Math.round(40 / ds));
  let curvAhead = 0;
  for (let i = 2; i <= lookSamples; i++) {
    curvAhead += track.samples[(k.sampleIdx + i) % m].curvature;
  }
  curvAhead /= lookSamples - 1;
  k.aiCurvAhead = curvAhead;

  // Positive curvature = left turn; the inside of a left turn is negative lateral offset
  const apex = -clamp(curvAhead * 42, -1, 1) * halfRoad * 0.55;
  let laneTarget = apex + Math.sin(sim.elapsedMs / 2300 + k.aiPhase) * halfRoad * 0.22;

  if (!k.finished) {
    // Grab a box if we have no item, or line up a boost pad
    if (!k.heldItem && k.itemRouletteTimer <= 0) {
      let best = 90;
      for (const b of sim.itemBoxes) {
        if (b.respawnTimer > 0) continue;
        const def = projectOntoTrack(track, b.x, b.z, k.sampleIdx);
        const gap = forwardGap(track, k.progress, def.progress);
        if (gap > 4 && gap < best) {
          best = gap;
          laneTarget = def.lateralOffset;
        }
      }
    } else {
      for (const pad of track.boostPads) {
        const gap = forwardGap(track, k.progress, pad.progress);
        if (gap > 4 && gap < 70) laneTarget = pad.lateral * halfRoad;
      }
    }
    // Steer around bananas, fake boxes and the kart directly ahead
    for (const h of sim.hazards) {
      if (h.kind !== 'banana' && h.kind !== 'fake_box') continue;
      const p = projectOntoTrack(track, h.x, h.z, k.sampleIdx);
      const gap = forwardGap(track, k.progress, p.progress);
      if (gap > 3 && gap < 48 && Math.abs(p.lateralOffset - laneTarget) < 8) {
        // Fake boxes fool bots some of the time, like everyone else
        if (h.kind === 'fake_box' && k.aiPhase > Math.PI) continue;
        laneTarget = p.lateralOffset + (p.lateralOffset > 0 ? -10 : 10);
      }
    }
    for (const o of Object.values(sim.karts)) {
      if (o.id === k.id || o.finished) continue;
      const gap = forwardGap(track, k.progress, o.progress);
      if (gap > 1 && gap < 18 && Math.abs(o.lateralOffset - laneTarget) < 4.5 && o.speed < k.speed + 2) {
        laneTarget = o.lateralOffset + (o.lateralOffset > 0 ? -6 : 6);
      }
    }
  }

  laneTarget = clamp(laneTarget, -halfRoad * 0.78, halfRoad * 0.78);
  k.aiLane += (laneTarget - k.aiLane) * Math.min(1, dt * 2.4);

  // Pure pursuit at a look-ahead that grows with speed
  const lookIdx = Math.round(Math.max(14, Math.abs(k.speed) * 0.55) / ds);
  const aim = track.samples[(k.sampleIdx + lookIdx) % m];
  const tx = aim.x + aim.nx * k.aiLane - k.x;
  const tz = aim.z + aim.nz * k.aiLane - k.z;
  const headingErr = normalizeAngle(Math.atan2(tx, tz) - k.angle);
  let steer = clamp(-headingErr * 2.6, -1, 1);

  const sharpCorner = Math.abs(curvAhead) > 0.0125;
  const cornerSteer = -Math.sign(curvAhead);
  const wantsDrift = !k.finished && k.speed > 34 && k.airTimer <= 0 && sharpCorner;
  if (k.drifting) {
    // While sliding, keep pointing at the line rather than fighting the drift direction
    steer = clamp(steer + k.driftDir * 0.15, -1, 1);
  }

  let useItem = false;
  if (!k.finished && k.heldItem && botWantsItem(sim, k, curvAhead)) {
    useItem = true;
    k.aiUseItemDelay = 0.8 + Math.random() * 1.4;
  }

  return {
    steer,
    drift: wantsDrift && (k.drifting || steer * cornerSteer > 0.05),
    brake: false,
    useItem,
    updatedAt: Date.now(),
  };
}

function awardDriftBoost(sim: KartRaceSim, k: KartState) {
  if (k.driftLevel === 0) return;
  k.boostTimer = Math.max(k.boostTimer, DRIFT_BOOSTS[k.driftLevel - 1]);
  sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
  setKartStatus(k, k.driftLevel === 3 ? '💜 ULTRA MINI-TURBO!!' : k.driftLevel === 2 ? '🔥 SUPER MINI-TURBO!' : '💨 MINI-TURBO!', sim.elapsedMs, 1100);
  pushEvent(sim, 'miniturbo', k, { value: k.driftLevel });
}

function clearDrift(k: KartState) {
  k.drifting = false;
  k.driftDir = 0;
  k.driftTime = 0;
  k.driftLevel = 0;
}

function stepCountdown(sim: KartRaceSim, dt: number, dtMs: number) {
  const prevCountdown = sim.countdownMs;
  sim.countdownMs = Math.max(0, sim.countdownMs - dtMs);

  for (const k of Object.values(sim.karts)) {
    if (k.isBot) continue;
    const inp = sim.inputs[k.id];
    // Hold drift from the moment "1" is close to the green light. Too early and the engine floods.
    k.launchHoldTimer = inp?.drift ? k.launchHoldTimer + dt : 0;
    if (inp) {
      inp.useItem = false;
      inp.rocketTap = false;
    }
  }

  if (prevCountdown > 0 && sim.countdownMs === 0) {
    announce(sim, '🏁 GO! GO! GO!', 1400);
    pushEvent(sim, 'go');
    for (const k of Object.values(sim.karts)) {
      if (k.isBot) {
        if (Math.random() < 0.3) k.boostTimer = 0.9;
      } else if (k.launchHoldTimer > 1.5) {
        k.spinOutTimer = 0.7;
        setKartStatus(k, '💥 ENGINE FLOODED!', sim.elapsedMs, 1500);
        pushEvent(sim, 'stall', k);
      } else if (k.launchHoldTimer > 0.05) {
        k.boostTimer = 1.6;
        sim.stats.drifts[k.id] = (sim.stats.drifts[k.id] || 0) + 1;
        setKartStatus(k, '🚀 ROCKET START!', sim.elapsedMs, 1600);
        pushEvent(sim, 'rocket', k);
      }
    }
  }
}

function stepKart(sim: KartRaceSim, k: KartState, allKarts: KartState[], dt: number, bestHumanProgress: number | null) {
  const track = sim.track;
  const m = track.samples.length;
  const cls = SPEED_CLASSES[sim.speedClass];
  const style = KART_STYLES[k.kartStyle] || KART_STYLES.classic;
  const halfRoad = track.roadWidth * 0.5;

  if (k.statusText && sim.elapsedMs > k.statusUntil) {
    k.statusText = null;
  }

  // Item roulette completion
  if (k.itemRouletteTimer > 0) {
    k.itemRouletteTimer = Math.max(0, k.itemRouletteTimer - dt);
    if (k.itemRouletteTimer === 0 && k.pendingItem) {
      k.heldItem = k.pendingItem;
      k.pendingItem = null;
      k.itemHeldFor = 0;
    }
  }
  if (k.heldItem) k.itemHeldFor += dt;

  // Decrement active timers
  if (k.boostTimer > 0) k.boostTimer = Math.max(0, k.boostTimer - dt);
  if (k.goldenShroomTimer > 0) {
    k.goldenShroomTimer = Math.max(0, k.goldenShroomTimer - dt);
    if (k.goldenShroomTimer === 0 && k.heldItem === 'golden_mushroom') {
      k.heldItem = null;
    }
  }
  if (k.spinOutTimer > 0) k.spinOutTimer = Math.max(0, k.spinOutTimer - dt);
  if (k.hitImmuneTimer > 0) k.hitImmuneTimer = Math.max(0, k.hitImmuneTimer - dt);
  if (k.shrinkTimer > 0) k.shrinkTimer = Math.max(0, k.shrinkTimer - dt);
  if (k.starTimer > 0) k.starTimer = Math.max(0, k.starTimer - dt);
  if (k.wallCooldown > 0) k.wallCooldown = Math.max(0, k.wallCooldown - dt);

  // A phone that drops out hands its kart to the autopilot instead of holding the last steer
  const humanInput = sim.inputs[k.id];
  k.autopilot = !k.isBot && !k.finished && (!humanInput || Date.now() - humanInput.updatedAt > STALE_INPUT_MS);
  const inp: KartInputState = k.isBot || k.finished || k.autopilot
    ? computeBotInput(sim, k, dt)
    : humanInput;
  if (!k.isBot && !k.finished && !humanInput) sim.inputs[k.id] = inp;

  // Consume item use or golden mushroom tap
  if (inp.useItem && !k.finished && k.spinOutTimer <= 0) {
    if (k.goldenShroomTimer > 0) {
      k.boostTimer = Math.max(k.boostTimer, 1.1);
      setKartStatus(k, '✨ GOLDEN BURST!', sim.elapsedMs, 700);
      pushEvent(sim, 'boost', k);
    } else if (k.itemRouletteTimer > 0 && k.pendingItem) {
      // A tap stops the roulette early
      k.itemRouletteTimer = 0;
      k.heldItem = k.pendingItem;
      k.pendingItem = null;
      k.itemHeldFor = 0;
    } else if (k.heldItem) {
      fireKartItem(sim, k);
    }
  }
  if (humanInput) {
    humanInput.useItem = false;
    humanInput.rocketTap = false;
  }

  const sample = track.samples[k.sampleIdx] || track.samples[0];
  k.steerSmooth += (inp.steer - k.steerSmooth) * (1 - Math.exp(-dt / 0.05));

  // ── Jump: in the air the kart flies straight; a drift press pulls a trick for a landing boost
  if (k.airTimer > 0) {
    k.airTimer = Math.max(0, k.airTimer - dt);
    if (!k.trickDone && inp.drift && !k.isBot) {
      k.trickDone = true;
      setKartStatus(k, '🤸 TRICK!', sim.elapsedMs, 900);
      pushEvent(sim, 'trick', k);
    } else if (!k.trickDone && k.isBot && k.airTimer < k.airDuration * 0.7 && k.aiPhase < 4) {
      k.trickDone = true;
    }
    if (k.airTimer === 0) {
      if (k.trickDone) {
        k.boostTimer = Math.max(k.boostTimer, 1.1);
        pushEvent(sim, 'boost', k);
      }
      pushEvent(sim, 'land', k);
    }
  } else if (k.spinOutTimer > 0) {
    // Spun out: bleed speed, keep sliding the way it was going
    k.speed = Math.max(Math.min(k.speed, SPIN_SPEED_FLOOR), k.speed - 60 * dt);
    if (k.drifting) clearDrift(k);
  } else {
    // ── Drift state
    const wantsDrift = inp.drift && !inp.brake && k.speed > 18;
    if (wantsDrift && !k.drifting) {
      k.drifting = true;
      if (Math.abs(inp.steer) > 0.08) {
        k.driftDir = Math.sign(inp.steer);
      } else if (Math.abs(sample.curvature) > 0.002) {
        k.driftDir = sample.curvature > 0 ? -1 : 1;
      } else {
        k.driftDir = k.lateralOffset > 0 ? -1 : 1;
      }
      k.driftTime = 0;
      k.driftLevel = 0;
    }
    if (k.drifting && wantsDrift) {
      // Early on you can still commit the slide to the other side
      if (k.driftTime < 0.3 && Math.abs(inp.steer) > 0.25) k.driftDir = Math.sign(inp.steer);
      const inward = inp.steer * k.driftDir;
      // Sparks charge by leaning into the slide, not just by holding the button on a straight
      const chargeRate = (inward > 0.12 ? 1 + inward * 0.6 : 0.35) * style.driftCharge;
      k.driftTime += dt * chargeRate;
      const prevLevel = k.driftLevel;
      if (k.driftTime >= DRIFT_TIERS[2]) k.driftLevel = 3;
      else if (k.driftTime >= DRIFT_TIERS[1]) k.driftLevel = 2;
      else if (k.driftTime >= DRIFT_TIERS[0]) k.driftLevel = 1;
      if (!k.isBot && k.driftLevel > prevLevel) {
        setKartStatus(k, k.driftLevel === 3 ? '💜 ULTRA CHARGED!' : k.driftLevel === 2 ? '🔥 SUPER READY!' : '💨 MINI READY!', sim.elapsedMs, 700);
      }
    }
    if (k.drifting && !wantsDrift) {
      if (!inp.brake && k.speed > 15) awardDriftBoost(sim, k);
      clearDrift(k);
    }

    // ── Steering: real yaw from the wheel, plus a road assist that fades as you steer
    const steer = k.steerSmooth;
    const speedFactor = clamp(Math.abs(k.speed) / 24, 0.15, 1);
    const reverse = k.speed < -1 ? -1 : 1;
    let yawRate: number;
    if (k.drifting) {
      const inward = clamp(steer * k.driftDir, -1, 1);
      yawRate = -k.driftDir * (0.95 + 0.8 * inward) * TURN_RATE * 0.92 * cls.turn * style.turn;
    } else {
      yawRate = -steer * TURN_RATE * cls.turn * style.turn;
    }
    k.angle = normalizeAngle(k.angle + yawRate * speedFactor * reverse * dt);

    const lookIdx = Math.round((Math.max(8, Math.abs(k.speed)) * 0.22) / (track.totalLength / m));
    const aheadSample = track.samples[(k.sampleIdx + lookIdx) % m];
    const centering = clamp(k.lateralOffset * 0.012, -0.3, 0.3);
    const assistHeading = aheadSample.angle + centering;
    const assistGain = (k.drifting ? 0.55 : BASE_ASSIST * (1 - 0.8 * Math.min(1, Math.abs(steer)))) * cls.assist;
    k.angle = normalizeAngle(k.angle + normalizeAngle(assistHeading - k.angle) * (1 - Math.exp(-assistGain * dt)));

    // Never let a kart turn around, there's no wrong way in a party race
    const rel = normalizeAngle(k.angle - sample.angle);
    if (Math.abs(rel) > MAX_ROAD_ANGLE) {
      k.angle = normalizeAngle(sample.angle + Math.sign(rel) * MAX_ROAD_ANGLE);
    }

    // ── Speed
    let top = cls.maxSpeed * style.topSpeed;
    if (k.isBot) {
      top *= k.aiSkill;
      // Lift for corners too tight to take flat out
      top = Math.min(top, BOT_CORNER_YAW / Math.max(0.001, Math.abs(k.aiCurvAhead)));
      if (bestHumanProgress !== null) {
        // Keep the pack around the humans, a close race beats a fair one
        const gap = k.totalProgress - bestHumanProgress;
        if (gap > 0.08) top *= 1 - Math.min(0.2, (gap - 0.08) * 0.9);
        else if (gap < -0.1) top *= 1 + Math.min(0.12, (-gap - 0.1) * 0.5);
      }
    } else {
      const rankRatio = (k.rank - 1) / Math.max(1, allKarts.length - 1);
      top *= 1 + rankRatio * 0.05;
    }
    if (k.finished) top = cls.maxSpeed * 0.7;
    if (k.drifting) top *= 0.985;
    if (k.shrinkTimer > 0) top *= 0.78;
    if (k.starTimer > 0) top *= STAR_SPEED_MUL;
    else if (k.boostTimer > 0) top *= BOOST_SPEED_MUL;
    const ignoreOffRoad = k.boostTimer > 0 || k.starTimer > 0;
    if (k.offRoad && !ignoreOffRoad) top *= OFFROAD_SPEED_MUL;

    if (inp.brake && !k.finished) {
      k.speed = Math.max(-16, k.speed - (k.speed > 0 ? 75 : 30) * dt);
    } else if (k.speed < top) {
      const taper = k.boostTimer > 0 || k.starTimer > 0 ? 1 : 0.35 + 0.65 * clamp(1 - k.speed / top, 0, 1);
      const accel = (k.boostTimer > 0 || k.starTimer > 0 ? BOOST_ACCEL : ACCEL) * cls.accel * style.accel * taper;
      k.speed = Math.min(top, k.speed + accel * dt);
    } else {
      // Off-road drags you down hard, otherwise lifting off a boost is gentle
      k.speed = Math.max(top, k.speed - (k.offRoad ? 62 : 26) * dt);
    }
  }

  // Slipstream behind the kart ahead: a sustained tow earns a short boost
  if (!k.finished && k.speed > 20 && k.airTimer <= 0) {
    let inSlipstream = false;
    for (const other of allKarts) {
      if (other.id === k.id || other.finished) continue;
      const dx = other.x - k.x;
      const dz = other.z - k.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 3.0 && dist < 22.0) {
        const fwd = (dx * Math.sin(k.angle) + dz * Math.cos(k.angle)) / dist;
        const lat = Math.abs(dx * Math.cos(k.angle) - dz * Math.sin(k.angle));
        if (fwd > 0.9 && lat < 4) {
          inSlipstream = true;
          break;
        }
      }
    }
    if (inSlipstream) {
      k.slipstreamTimer += dt;
      if (k.slipstreamTimer >= 1.8) {
        k.boostTimer = Math.max(k.boostTimer, 0.9);
        k.slipstreamTimer = 0;
        setKartStatus(k, '💨 SLIPSTREAM!', sim.elapsedMs, 1000);
        pushEvent(sim, 'boost', k);
      }
    } else {
      k.slipstreamTimer = Math.max(0, k.slipstreamTimer - dt * 1.5);
    }
  } else {
    k.slipstreamTimer = 0;
  }

  // ── Travel direction: lags the heading by how much grip this surface and state allow
  const surfaceGrip = track.friction * track.friction;
  const grip = (k.drifting ? DRIFT_GRIP : k.spinOutTimer > 0 ? 1.4 : GRIP) * surfaceGrip;
  if (k.airTimer <= 0) {
    k.velAngle = normalizeAngle(k.velAngle + normalizeAngle(k.angle - k.velAngle) * (1 - Math.exp(-grip * dt)));
  }

  k.x += Math.sin(k.velAngle) * k.speed * dt + k.pushX * dt;
  k.z += Math.cos(k.velAngle) * k.speed * dt + k.pushZ * dt;
  const pushDecay = Math.exp(-dt * 5);
  k.pushX *= pushDecay;
  k.pushZ *= pushDecay;

  // Project onto the spline for progress, off-road and the barriers
  const prevProgress = k.progress;
  const proj = projectOntoTrack(track, k.x, k.z, k.sampleIdx);
  k.sampleIdx = proj.sampleIdx;
  k.lateralOffset = proj.lateralOffset;
  k.offRoad = k.airTimer <= 0 && Math.abs(k.lateralOffset) > halfRoad + 1.2;

  const maxWallOffset = track.wallWidth - 1.2;
  if (Math.abs(proj.lateralOffset) > maxWallOffset) {
    const side = Math.sign(proj.lateralOffset);
    const nx = proj.sample.nx * side;
    const nz = proj.sample.nz * side;
    const along = proj.distanceToCenter > 0 ? (k.x - proj.sample.x) * proj.sample.tx + (k.z - proj.sample.z) * proj.sample.tz : 0;
    k.x = proj.sample.x + proj.sample.tx * along + nx * maxWallOffset;
    k.z = proj.sample.z + proj.sample.tz * along + nz * maxWallOffset;
    k.lateralOffset = side * maxWallOffset;
    // Lose only the speed going into the wall, glance off the rest
    const into = Math.max(0, Math.sin(k.velAngle) * k.speed * nx + Math.cos(k.velAngle) * k.speed * nz);
    if (into > 0.5) {
      k.speed = Math.max(k.speed - into * 0.4, 8);
      k.pushX -= nx * Math.min(14, into * 0.55);
      k.pushZ -= nz * Math.min(14, into * 0.55);
      // Turn the nose back along the road
      const rel = normalizeAngle(k.velAngle - proj.sample.angle);
      const bounced = proj.sample.angle + rel * 0.25;
      k.velAngle = normalizeAngle(bounced);
      k.angle = normalizeAngle(bounced);
      if (into > 7 && k.wallCooldown <= 0) {
        k.wallCooldown = 0.5;
        pushEvent(sim, 'wall', k, { value: Math.round(into) });
      }
    }
  }

  // Lap & checkpoint tracking
  const newProgress = proj.progress;
  if (newProgress >= 0.42 && newProgress <= 0.68) {
    k.passedHalfway = true;
  }

  if (!k.finished && prevProgress > 0.78 && newProgress < 0.22 && k.passedHalfway) {
    const lapDuration = Math.round(sim.raceTimeMs - k.lapStartTimeMs);
    k.lapStartTimeMs = sim.raceTimeMs;
    k.lastLapTimeMs = lapDuration;
    if (!k.bestLapTimeMs || lapDuration < k.bestLapTimeMs) {
      k.bestLapTimeMs = lapDuration;
    }
    if (!sim.stats.fastestLap || lapDuration < sim.stats.fastestLap.timeMs) {
      sim.stats.fastestLap = { racerId: k.id, racerName: k.name, timeMs: lapDuration };
    }

    k.lap++;
    k.passedHalfway = false;
    if (k.lap > sim.totalLaps) {
      k.finished = true;
      k.finishTimeMs = Math.round(sim.raceTimeMs);
      k.finishRank = sim.nextFinishRank++;
      k.drifting = false;
      k.driftLevel = 0;
      k.heldItem = null;
      setKartStatus(k, k.finishRank === 1 ? '🏆 YOU WIN!' : `🏁 FINISHED #${k.finishRank}!`, sim.elapsedMs, 10000);
      pushEvent(sim, 'finish', k, { value: k.finishRank });
      const hasHumanRacers = allKarts.some((kart) => !kart.isBot);
      if (sim.finishCountdownMs === null && (!k.isBot || !hasHumanRacers)) {
        sim.finishCountdownMs = POST_FIRST_FINISH_MS;
        announce(sim, `🏁 ${k.name} takes the flag! ${Math.round(POST_FIRST_FINISH_MS / 1000)}s left!`, 4000);
      }
    } else if (k.lap === sim.totalLaps) {
      setKartStatus(k, '🔔 FINAL LAP!', sim.elapsedMs, 2400);
      pushEvent(sim, 'final_lap', k);
    } else {
      setKartStatus(k, `LAP ${k.lap}/${sim.totalLaps}`, sim.elapsedMs, 1600);
      pushEvent(sim, 'lap', k);
    }
  }

  k.progress = newProgress;
  if (!k.finished) {
    // Before the checkpoint a high progress value is still the tail of the previous lap
    const effectiveProgress = !k.passedHalfway && newProgress > 0.85 ? newProgress - 1 : newProgress;
    k.totalProgress = k.lap - 1 + effectiveProgress;
  } else {
    k.totalProgress = sim.totalLaps + 1 + (10 - (k.finishRank || 10)) * 0.1;
  }

  if (k.airTimer <= 0) {
    // Boost pads
    for (const pad of track.boostPads) {
      if (Math.hypot(k.x - pad.x, k.z - pad.z) < 5) {
        if (k.boostTimer < 1.2) {
          k.boostTimer = 1.3;
          if (!k.isBot) setKartStatus(k, '⚡ BOOST!', sim.elapsedMs, 800);
          pushEvent(sim, 'pad', k);
        }
      }
    }

    // Ramps launch anyone crossing the road line at speed, once per lap
    for (const ramp of track.ramps) {
      const gap = forwardGap(track, ramp.progress, k.progress);
      if (gap < 7 && k.speed > 22 && k.lastRampLap[ramp.id] !== k.lap && Math.abs(k.lateralOffset) < halfRoad) {
        k.lastRampLap[ramp.id] = k.lap;
        k.airDuration = clamp(0.55 + (k.speed / 60) * 0.5, 0.6, 1.25);
        k.airTimer = k.airDuration;
        k.trickDone = false;
        if (k.drifting) {
          awardDriftBoost(sim, k);
          clearDrift(k);
        }
        pushEvent(sim, 'jump', k);
      }
    }
  }

  // Item boxes
  for (const box of sim.itemBoxes) {
    if (box.respawnTimer > 0) continue;
    if (Math.hypot(k.x - box.x, k.z - box.z) < 4) {
      box.respawnTimer = box.isBonus ? 999 : 4.5;
      pushEvent(sim, 'box', k, { x: box.x, z: box.z, value: k.heldItem || k.itemRouletteTimer > 0 ? 0 : 1 });
      if (!k.heldItem && k.itemRouletteTimer <= 0 && !k.finished) {
        k.itemRouletteTimer = 1.1;
        k.pendingItem = rollWeightedItem(sim, k.rank, allKarts.length);
      }
    }
  }
}

function stepCollisions(sim: KartRaceSim, allKarts: KartState[]) {
  for (let i = 0; i < allKarts.length; i++) {
    for (let j = i + 1; j < allKarts.length; j++) {
      const a = allKarts[i];
      const b = allKarts[j];
      if (a.airTimer > 0.15 || b.airTimer > 0.15) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const minDist = 3.2 * (a.shrinkTimer > 0 || b.shrinkTimer > 0 ? 0.8 : 1);
      if (dist <= 0 || dist >= minDist) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const massA = (KART_STYLES[a.kartStyle] || KART_STYLES.classic).mass;
      const massB = (KART_STYLES[b.kartStyle] || KART_STYLES.classic).mass;
      const share = massB / (massA + massB);
      const overlap = minDist - dist;
      a.x -= nx * overlap * share;
      a.z -= nz * overlap * share;
      b.x += nx * overlap * (1 - share);
      b.z += nz * overlap * (1 - share);

      // Closing speed along the contact line turns into a shove, heavy karts win
      const avx = Math.sin(a.velAngle) * a.speed + a.pushX;
      const avz = Math.cos(a.velAngle) * a.speed + a.pushZ;
      const bvx = Math.sin(b.velAngle) * b.speed + b.pushX;
      const bvz = Math.cos(b.velAngle) * b.speed + b.pushZ;
      const closing = (avx - bvx) * nx + (avz - bvz) * nz;
      if (closing > 0) {
        const impulse = Math.min(26, closing * 0.9 + 4);
        a.pushX -= nx * impulse * share;
        a.pushZ -= nz * impulse * share;
        b.pushX += nx * impulse * (1 - share);
        b.pushZ += nz * impulse * (1 - share);
        if (closing > 12) pushEvent(sim, 'bump', a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }

      if (a.starTimer > 0 && b.starTimer <= 0) {
        spinKart(sim, b, { duration: 1.0, speedMul: 0.35, label: `⭐ RUN OVER BY ${a.name.toUpperCase()}!`, attackerId: a.id });
      } else if (b.starTimer > 0 && a.starTimer <= 0) {
        spinKart(sim, a, { duration: 1.0, speedMul: 0.35, label: `⭐ RUN OVER BY ${b.name.toUpperCase()}!`, attackerId: b.id });
      }
    }
  }
}

function stepHazards(sim: KartRaceSim, allKarts: KartState[], dt: number) {
  const track = sim.track;
  const shellScale = SPEED_CLASSES[sim.speedClass].maxSpeed / SPEED_CLASSES['150cc'].maxSpeed;
  const remaining: KartHazard[] = [];

  const chase = (h: KartHazard, target: KartState | null, speed: number) => {
    if (target && !target.finished && Math.hypot(target.x - h.x, target.z - h.z) < 34) {
      const distToTarget = Math.hypot(target.x - h.x, target.z - h.z);
      const desired = Math.atan2(target.x - h.x, target.z - h.z);
      h.angle = desired;
      const stepLen = Math.min(distToTarget, speed * dt);
      h.x += Math.sin(desired) * stepLen;
      h.z += Math.cos(desired) * stepLen;
      h.progress = projectOntoTrack(track, h.x, h.z, target.sampleIdx).progress;
    } else {
      h.progress = (h.progress + (speed * dt) / track.totalLength) % 1;
      const s = sampleTrackAtProgress(track, h.progress);
      h.x = s.x;
      h.z = s.z;
      h.angle = s.angle;
    }
  };

  for (const h of sim.hazards) {
    h.ttl -= dt;
    h.age = (h.age || 0) + dt;
    if (h.ttl <= 0) continue;

    if (h.kind === 'green_shell') {
      h.x += h.vx * dt;
      h.z += h.vz * dt;
      const proj = projectOntoTrack(track, h.x, h.z, h.sampleIdx);
      h.sampleIdx = proj.sampleIdx;
      h.progress = proj.progress;
      const limit = track.wallWidth - 1;
      if (Math.abs(proj.lateralOffset) > limit) {
        const side = Math.sign(proj.lateralOffset);
        const dot = (h.vx * proj.sample.nx + h.vz * proj.sample.nz) * side;
        // Only bounce while moving outward, otherwise a shell inside the wall spends all its bounces in one go
        if (dot > 0) {
          if (h.bouncesLeft <= 0) {
            pushEvent(sim, 'explosion', null, { x: h.x, z: h.z, value: 0 });
            continue;
          }
          h.bouncesLeft--;
          h.vx -= 2 * dot * side * proj.sample.nx;
          h.vz -= 2 * dot * side * proj.sample.nz;
          h.angle = Math.atan2(h.vx, h.vz);
          pushEvent(sim, 'wall', null, { x: h.x, z: h.z, value: 0 });
        }
      }
    } else if (h.kind === 'red_shell') {
      let target = h.targetId ? sim.karts[h.targetId] : null;
      if (target?.finished) {
        target = null;
        h.targetId = null;
      }
      chase(h, target, 94 * shellScale);
    } else if (h.kind === 'spiny_shell') {
      // Always re-aims at whoever is in the lead right now
      const currentLeader = [...allKarts].sort((a, b) => a.rank - b.rank).find((r) => !r.finished) || null;
      h.targetId = currentLeader ? currentLeader.id : null;
      chase(h, currentLeader, 135 * shellScale);
    }

    if (h.kind === 'shockwave') {
      remaining.push(h);
      continue;
    }

    let hitKart: KartState | null = null;
    if (h.kind === 'spiny_shell') {
      // Flies over everyone until it drops on its target
      const target = h.targetId ? sim.karts[h.targetId] : null;
      if (target && Math.hypot(target.x - h.x, target.z - h.z) < 3.4) hitKart = target;
    } else {
      const grounded = h.kind === 'banana' || h.kind === 'fake_box';
      const hitRadius = grounded ? 2.9 : 3.2;
      const ownerGrace = grounded ? 0.8 : 0.5;
      for (const k of allKarts) {
        if (k.finished) continue;
        if (k.airTimer > 0.1 && grounded) continue; // jump over it!
        if (k.id === h.ownerId && h.age < ownerGrace) continue;
        if (Math.hypot(k.x - h.x, k.z - h.z) < hitRadius) {
          hitKart = k;
          break;
        }
      }
    }

    if (hitKart) {
      const isSpiny = h.kind === 'spiny_shell';
      const label = h.kind === 'banana'
        ? '🍌 SLIPPED!'
        : h.kind === 'fake_box'
        ? '📦 FAKE BOX!'
        : isSpiny
        ? '💥 BLUE SHELLED!'
        : '💥 SHELLED!';
      const dx = hitKart.x - h.x;
      const dz = hitKart.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      spinKart(sim, hitKart, {
        duration: isSpiny ? 1.8 : h.kind === 'banana' ? 0.95 : 1.15,
        speedMul: isSpiny ? 0.15 : h.kind === 'banana' ? 0.5 : 0.25,
        label,
        attackerId: h.ownerId,
        push: h.kind === 'banana' ? undefined : { x: (dx / d) * 10, z: (dz / d) * 10 },
      });
      pushEvent(sim, 'explosion', null, { x: h.x, z: h.z, value: isSpiny ? 2 : h.kind === 'banana' ? 0 : 1 });

      if (isSpiny) {
        // Blast damages anyone riding close to the leader too
        remaining.push({
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
          age: 0,
        });
        for (const other of allKarts) {
          if (other.id === hitKart.id) continue;
          if (Math.hypot(other.x - h.x, other.z - h.z) < 11) {
            spinKart(sim, other, { duration: 1.0, speedMul: 0.3, label: '💥 CAUGHT IN THE BLAST!', attackerId: h.ownerId });
          }
        }
      }
      continue;
    }

    remaining.push(h);
  }

  // Shells smash through bananas and fake boxes, and take each other out
  const destroyed = new Set<string>();
  for (let i = 0; i < remaining.length; i++) {
    const a = remaining[i];
    if (a.kind !== 'green_shell' && a.kind !== 'red_shell') continue;
    for (let j = 0; j < remaining.length; j++) {
      const b = remaining[j];
      if (i === j || b.kind === 'spiny_shell' || b.kind === 'shockwave') continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < 3) {
        destroyed.add(a.id);
        destroyed.add(b.id);
        pushEvent(sim, 'explosion', null, { x: b.x, z: b.z, value: 1 });
      }
    }
  }
  sim.hazards = destroyed.size ? remaining.filter((h) => !destroyed.has(h.id)) : remaining;
}

export function stepKartSimulation(sim: KartRaceSim, dt: number) {
  if (sim.completed) return;

  const dtMs = dt * 1000;
  sim.elapsedMs += dtMs;
  sim.tick++;
  if (sim.events.length && sim.events[0].tick < sim.tick - EVENT_KEEP_TICKS) {
    sim.events = sim.events.filter((e) => e.tick >= sim.tick - EVENT_KEEP_TICKS);
  }

  // Hold the grid until every racer has their phone sideways or has tapped ready
  if (sim.waitingForOrientation) {
    const humanRacers = Object.values(sim.karts).filter((k) => !k.isBot);
    const allReady = humanRacers.length === 0 || humanRacers.every((k) => Boolean(sim.inputs[k.id]?.isHorizontal || sim.inputs[k.id]?.isReady));
    sim.orientationWaitTimerMs += dtMs;
    if (allReady || sim.orientationWaitTimerMs > ORIENTATION_TIMEOUT_MS) {
      sim.waitingForOrientation = false;
      sim.countdownMs = COUNTDOWN_MS;
    } else {
      for (const inp of Object.values(sim.inputs)) inp.updatedAt = Date.now();
      return;
    }
  }

  // Handle 3-2-1 Countdown
  if (sim.countdownMs > 0) {
    stepCountdown(sim, dt, dtMs);
    for (const inp of Object.values(sim.inputs)) inp.updatedAt = Date.now();
    return;
  }

  sim.raceTimeMs += dtMs;

  // Clear expired announcements
  if (sim.announcement && sim.elapsedMs > sim.announcementUntil) {
    sim.announcement = null;
  }

  if (sim.queuedChaos && sim.raceTimeMs >= 12_000) {
    triggerChaosDrop(sim.roomCode, sim.queuedChaos);
  }

  // Update item box respawn timers
  for (const box of sim.itemBoxes) {
    if (box.respawnTimer > 0) {
      box.respawnTimer = Math.max(0, box.respawnTimer - dt);
    }
  }

  const allKarts = Object.values(sim.karts);
  const humans = allKarts.filter((k) => !k.isBot);
  const bestHumanProgress = humans.length ? Math.max(...humans.map((k) => k.totalProgress)) : null;

  for (const k of allKarts) stepKart(sim, k, allKarts, dt, bestHumanProgress);

  stepCollisions(sim, allKarts);
  stepHazards(sim, allKarts, dt);

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

  // Commentary when a new racer takes the lead
  const leader = sorted[0];
  if (leader && leader.id !== sim.lastLeaderId && sim.raceTimeMs > 8000 && !leader.finished) {
    sim.lastLeaderId = leader.id;
    if (sim.raceTimeMs - sim.lastLeadCallAt > 7000 && !sim.announcement) {
      sim.lastLeadCallAt = sim.raceTimeMs;
      announce(sim, `${leader.avatar} ${leader.name} takes the lead!`, 2000);
      pushEvent(sim, 'lead', leader);
    }
  }

  // Check race completion conditions
  const humanKarts = allKarts.filter((k) => !k.isBot);
  const allHumansFinished = humanKarts.length > 0 && humanKarts.every((k) => k.finished);
  const allKartsFinished = allKarts.length > 0 && allKarts.every((k) => k.finished);

  if (sim.finishCountdownMs !== null) {
    sim.finishCountdownMs = Math.max(0, sim.finishCountdownMs - dtMs);
  }

  // Everyone's home: a few seconds of victory lap before the results cut in
  if (sim.celebrationMs === null && (allHumansFinished || allKartsFinished)) {
    sim.celebrationMs = CELEBRATION_MS;
  } else if (sim.celebrationMs !== null) {
    sim.celebrationMs = Math.max(0, sim.celebrationMs - dtMs);
  }

  if (
    (sim.celebrationMs !== null && sim.celebrationMs <= 0) ||
    (sim.finishCountdownMs !== null && sim.finishCountdownMs <= 0) ||
    sim.raceTimeMs >= MAX_RACE_DURATION_MS
  ) {
    for (const k of sorted) {
      if (!k.finished) {
        k.finished = true;
        k.dnf = true;
        k.finishRank = sim.nextFinishRank++;
        k.finishTimeMs = null;
      }
    }
    sim.completed = true;
  }
}

export function getKartSnapshot(sim: KartRaceSim): KartTelemetrySnapshot {
  const humanRacers = Object.values(sim.karts).filter((k) => !k.isBot);
  const humanRacersStatus = humanRacers.map((k) => ({
    id: k.id,
    name: k.name,
    avatar: k.avatar,
    color: k.color,
    isHorizontal: Boolean(sim.inputs[k.id]?.isHorizontal || sim.inputs[k.id]?.isReady),
  }));

  const incoming = new Set<string>();
  for (const h of sim.hazards) {
    if ((h.kind === 'red_shell' || h.kind === 'spiny_shell') && h.targetId) incoming.add(h.targetId);
  }

  return {
    roomCode: sim.roomCode,
    raceId: sim.raceId,
    trackId: sim.trackId,
    totalLaps: sim.totalLaps,
    speedClass: sim.speedClass,
    elapsedMs: Math.round(sim.elapsedMs),
    raceTimeMs: Math.round(sim.raceTimeMs),
    waitingForOrientation: Boolean(sim.waitingForOrientation),
    orientationAutoStartMs: Math.max(0, Math.round(ORIENTATION_TIMEOUT_MS - sim.orientationWaitTimerMs)),
    humanRacersStatus,
    countdownMs: Math.round(sim.countdownMs),
    finishCountdownMs: sim.finishCountdownMs !== null ? Math.round(sim.finishCountdownMs) : null,
    celebrating: sim.celebrationMs !== null,
    announcement: sim.announcement,
    chaosFired: sim.chaosFired,
    fastestLap: sim.stats.fastestLap || null,
    karts: sim.kartOrder.map((id) => {
      const k = sim.karts[id];
      const driftChargePct = k.drifting
        ? k.driftLevel === 3
          ? 100
          : Math.min(100, Math.round(((k.driftTime - (k.driftLevel === 0 ? 0 : DRIFT_TIERS[k.driftLevel - 1])) / (DRIFT_TIERS[k.driftLevel] - (k.driftLevel === 0 ? 0 : DRIFT_TIERS[k.driftLevel - 1]))) * 100))
        : 0;

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
        velAngle: Math.round(k.velAngle * 1000) / 1000,
        steer: Math.round(k.steerSmooth * 100) / 100,
        speed: Math.round(k.speed * 10) / 10,
        lap: Math.min(k.lap, sim.totalLaps),
        progress: Math.round(k.progress * 10000) / 10000,
        lateralOffset: Math.round(k.lateralOffset * 100) / 100,
        sampleIdx: k.sampleIdx,
        rank: k.rank,
        finished: k.finished,
        finishRank: k.finishRank,
        finishTimeMs: k.finishTimeMs,
        bestLapTimeMs: k.bestLapTimeMs,
        lastLapTimeMs: k.lastLapTimeMs,
        drifting: k.drifting,
        driftDir: k.driftDir,
        driftLevel: k.driftLevel,
        driftCharge: driftChargePct,
        boostTimer: Math.round(k.boostTimer * 100) / 100,
        slipstreamTimer: Math.round(k.slipstreamTimer * 10) / 10,
        goldenShroomTimer: Math.round(k.goldenShroomTimer * 10) / 10,
        spinOutTimer: Math.round(k.spinOutTimer * 100) / 100,
        shrinkTimer: Math.round(k.shrinkTimer * 10) / 10,
        starTimer: Math.round(k.starTimer * 10) / 10,
        airT: k.airTimer > 0 && k.airDuration > 0 ? Math.round((1 - k.airTimer / k.airDuration) * 100) / 100 : 0,
        trick: k.airTimer > 0 && k.trickDone,
        offRoad: k.offRoad,
        autopilot: k.autopilot,
        horn: sim.elapsedMs < k.hornUntil,
        hasIncomingShell: incoming.has(k.id),
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
        bonus: b.isBonus,
      })),
    hazards: sim.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      x: Math.round(h.x * 10) / 10,
      z: Math.round(h.z * 10) / 10,
      angle: Math.round(h.angle * 100) / 100,
      age: Math.round(h.age * 100) / 100,
      ttl: Math.round(h.ttl * 100) / 100,
    })),
    events: sim.events,
    timestamp: Date.now(),
  };
}
