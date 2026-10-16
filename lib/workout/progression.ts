import { calcAverage1RM } from './analytics';

// RIR-based autoregulation.
//
//   1. Every working set gives an e1RM from reps + RIR (reps to failure), so
//      8 reps @ RIR 3 counts as an 11-rep max, 8 @ RIR 0 as an 8-rep max.
//   2. The session estimate is the mean over its working sets, smoothed with up
//      to two earlier sessions so one bad (or great) day doesn't swing the plan.
//   3. The target RIR comes from the workout type and the intensity slider.
//   4. A small strength gain is assumed only if the last session wasn't harder
//      than the target, and the next weight × reps is picked from the real
//      equipment ladder so the estimate predicts the target RIR (double
//      progression: reps first, then weight with a rep reset at the top).
//   5. The reasoning text is written from the same decision record.

// ─── Core Data Types ───────────────────────────────────────────────────────────

export type SetLog = {
  plannedReps: number;
  actualReps: number;
  plannedWeight: number;
  actualWeight: number;
  completed: boolean;
  rir?: number;
};

export type Session = {
  liftId: string;
  sets: SetLog[];
  timestamp: string;
  /** Number of sets that were planned for this lift. Defaults to sets.length. */
  plannedSets?: number;
};

export type PerformanceMetrics = {
  completionRatio: number;
  intensityDeviation: number;
  setDelta: number;
  fatigueSlope: number;
  /** 1.0 = effort on target; ±0.1 per rep in reserve away from it (see SCORE_PER_RIR). */
  performanceScore: number;
  weightDropDetected: boolean;   // true if user dropped weight mid-session
  extraSetsDetected: boolean;    // true if user added sets beyond planned
  /** Average logged RIR (sets without a logged RIR are left out). */
  avgRir?: number;
  lastSetRir?: number;
  rirCoverage?: number;
  /** performanceScore contribution of the working sets' RIR vs. the target. */
  rirAdjustment?: number;
};

export type ScoringBreakdown = {
  totalLoad: number;        // planned total load (weight × reps × sets)
  lastLoad: number;         // previous session's total load
  overloadRatio: number;    // totalLoad / lastLoad
  e1RM: number;             // estimated 1RM the plan is built on (reps + RIR, smoothed)
  lastE1RM: number;         // estimated 1RM from the last session alone
  intensityRatio: number;   // e1RM / lastE1RM
  targetRir?: number;       // reps in reserve the plan aims for
  predictedRir?: number;    // RIR the estimate predicts for the planned weight × reps
  expectedGain?: number;    // strength gain assumed since last session (0.025 = +2.5%)
  sessionsUsed?: number;    // sessions averaged into e1RM
  performanceAdjustment: string;  // human-readable explanation
};

export type ProgressionProfile = 'standard' | 'high-rep' | 'endurance';

export type ProgressionInput = {
  lastSession: Session;
  /** Earlier sessions of this lift, oldest first (may also contain lastSession). */
  history: Session[];
  constraints: {
    minReps: number;
    maxReps: number;
    minSets: number;
    maxSets: number;
    timeLimit?: number; // optional, in minutes
  };
  equipment: {
    getValidWeights: (liftId: string) => number[];
  };
  intensity: number; // user-controlled [0.5 – 1.5]
  profile?: ProgressionProfile; // per-lift progression strategy
  /** Recovery session: lighter weight and one fewer set instead of progressing. */
  deload?: boolean;
  /** The workout type's intensity (% of 1RM, e.g. 75). */
  typeIntensity?: number;
  /** Engine weight → the number shown to the user (calibrated machines). Only used for the text. */
  displayWeight?: (lbs: number) => number;
};

export type WorkoutPlan = {
  suggestedWeight: number;
  suggestedReps: number;
  suggestedSets: number;
  reasoning: string;
  scoringBreakdown: ScoringBreakdown;
  candidatesEvaluated: number;
  performanceMetrics: PerformanceMetrics;
};

export type Candidate = {
  weight: number;
  reps: number;
  sets: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Reps in reserve aimed for by default. */
const DEFAULT_TARGET_RIR = 2;
/** Workout types at or below this % of 1RM are endurance work: aim one rep further from failure. */
const ENDURANCE_TYPE_INTENSITY = 60;
/** Target RIR change per 1.0 of the intensity slider (0.5 → +1 RIR, 1.5 → −1 RIR). */
const RIR_PER_SLIDER_UNIT = 2;
/** Effort within this many reps of the target RIR counts as on target. */
const RIR_TOLERANCE = 0.5;
/** performanceScore change per rep in reserve away from the target (so ±0.05 ↔ ±RIR_TOLERANCE). */
const SCORE_PER_RIR = 0.1;
/** Sets without a logged RIR are assumed at the planned RIR ± reps beyond/short of plan, up to this much above it. */
const MAX_ASSUMED_EXTRA_RIR = 3;
const EXTRA_SET_BONUS = 0.05;
const WEIGHT_DROP_PENALTY = 0.08;
/** Reps lost per set that counts as unusually steep fatigue (10 → 7 → 4); 10 → 9 → 8 is normal. */
const STEEP_FATIGUE_SLOPE = -1.5;
/** Effort this many RIR harder than the target, with reps under the range, also drops a set. */
const SET_CUT_RIR_SHORTFALL = 1.5;
/** Sets at least this fraction of the top weight are working sets; lighter ones are back-off/drop sets. */
const WORKING_SET_FRACTION = 0.9;
/** Recency weights for the last session and up to two before it. */
const SMOOTHING_WEIGHTS = [0.6, 0.25, 0.15];
/** Earlier sessions older than this (before the last one) are left out of the estimate. */
const SMOOTHING_WINDOW_DAYS = 42;
/** Largest weight decrease per session, as a fraction (at least one rung is always allowed). */
const MAX_DROP_FRACTION = 0.2;
/** Rep-max formulas are meaningless beyond this many reps to failure. */
const MAX_REPS_TO_FAILURE = 30;
/** Average seconds per set including rest (heuristic for time-limit filtering) */
const AVG_SET_TIME_SECONDS = 90;
/** Deload sessions drop the working weight by about this fraction. */
const DELOAD_WEIGHT_REDUCTION = 0.15;

type ProfileSettings = {
  /** Strength assumed gained between sessions when the last one wasn't too hard (2.5% ≈ one more rep). */
  sessionGain: number;
  /** Largest weight increase per session as a fraction of the weight (at least one rung is always allowed). */
  maxJump: number;
  /** Below the top of the rep range, may the weight rise when the estimate supports it, or only reps? */
  loadBeforeTop: boolean;
  /** Add a set (up to the max) whenever the last session wasn't too hard, and before adding weight. */
  addSets: boolean;
};

const PROFILE_SETTINGS: Record<ProgressionProfile, ProfileSettings> = {
  standard: { sessionGain: 0.025, maxJump: 0.1, loadBeforeTop: true, addSets: false },
  'high-rep': { sessionGain: 0.02, maxJump: 0.05, loadBeforeTop: false, addSets: false },
  endurance: { sessionGain: 0.015, maxJump: 0.05, loadBeforeTop: false, addSets: true },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]) {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function getProfileSettings(profile: ProgressionProfile | undefined): ProfileSettings {
  return PROFILE_SETTINGS[profile || 'standard'] || PROFILE_SETTINGS.standard;
}

function getCompletedSets(session: Session) {
  return session.sets.filter(s => s.completed);
}

/** Completed sets within WORKING_SET_FRACTION of the session's heaviest set. */
function getWorkingSets(completedSets: SetLog[]): SetLog[] {
  const top = Math.max(0, ...completedSets.map(s => s.actualWeight));
  return completedSets.filter(s => s.actualWeight >= top * WORKING_SET_FRACTION - 1e-9);
}

/**
 * The set count a session is anchored on: what was planned (so skipping a set
 * once doesn't permanently shrink the workout), clamped into the constraints.
 */
function getAnchorSetCount(session: Session, constraints: ProgressionInput['constraints']) {
  const completed = getCompletedSets(session).length;
  const planned = session.plannedSets && session.plannedSets > 0 ? session.plannedSets : completed;
  return clamp(planned, constraints.minSets, constraints.maxSets);
}

function getLadder(equipment: ProgressionInput['equipment'], liftId: string) {
  return [...new Set(equipment.getValidWeights(liftId).filter(w => Number.isFinite(w) && w >= 0))].sort((a, b) => a - b);
}

function maxSetsForTime(constraints: ProgressionInput['constraints']) {
  return constraints.timeLimit ? Math.floor((constraints.timeLimit * 60) / AVG_SET_TIME_SECONDS) : Infinity;
}

// ─── Strength Model ────────────────────────────────────────────────────────────

/** e1RM ÷ weight for a set taken this many reps from failure (the site's averaged formula). */
function repFactor(repsToFailure: number) {
  return calcAverage1RM(1, clamp(repsToFailure, 1, MAX_REPS_TO_FAILURE));
}

/** Estimated 1RM from one set: reps + RIR is the rep max at that weight. */
export function estimateE1RM(weight: number, reps: number, rir = 0): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return weight * repFactor(reps + Math.max(0, rir));
}

/** How many reps to failure an e1RM predicts at a weight (inverse of estimateE1RM). */
export function repsToFailureAt(e1RM: number, weight: number): number {
  if (!(weight > 0)) return MAX_REPS_TO_FAILURE;
  const ratio = e1RM / weight;
  if (ratio <= 1) return Math.max(0, ratio);
  if (ratio >= repFactor(MAX_REPS_TO_FAILURE)) return MAX_REPS_TO_FAILURE;
  let lo = 1;
  let hi = MAX_REPS_TO_FAILURE;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (repFactor(mid) < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Reps in reserve aimed for next session. Endurance-type workouts (≤ 60% 1RM)
 * stay one rep further from failure; the slider moves it ±1 at its ends.
 * Rounded to half reps.
 */
export function getTargetRir(intensity: number, typeIntensity?: number): number {
  const base = typeof typeIntensity === 'number' && typeIntensity > 0 && typeIntensity <= ENDURANCE_TYPE_INTENSITY
    ? DEFAULT_TARGET_RIR + 1
    : DEFAULT_TARGET_RIR;
  const slider = clamp(Number.isFinite(intensity) ? intensity : 1, 0.5, 1.5);
  return clamp(Math.round((base - (slider - 1) * RIR_PER_SLIDER_UNIT) * 2) / 2, 0, 4);
}

/**
 * RIR of a set: as logged, or — when not logged — the RIR the plan aimed for,
 * shifted by reps beyond (or short of) the planned reps.
 */
function effectiveRir(set: SetLog, plannedRir: number): number {
  if (typeof set.rir === 'number' && Number.isFinite(set.rir)) return Math.max(0, set.rir);
  const planned = Number.isFinite(set.plannedReps) ? set.plannedReps : set.actualReps;
  return clamp(plannedRir + (set.actualReps - planned), 0, plannedRir + MAX_ASSUMED_EXTRA_RIR);
}

type SessionSummary = {
  topWeight: number;
  /** Mean per-working-set e1RM (0 for bodyweight). */
  e1RM: number;
  /** Mean reps to failure (reps + RIR) per working set. */
  repsToFailure: number;
  avgRir: number;
  /** True if any working set had no logged RIR. */
  rirAssumed: boolean;
  meanReps: number;
  minReps: number;
  workingSets: number;
};

function summarizeSession(session: Session, plannedRir: number): SessionSummary | null {
  const working = getWorkingSets(getCompletedSets(session)).filter(s => s.actualReps > 0);
  if (working.length === 0) return null;
  const rirs = working.map(s => effectiveRir(s, plannedRir));
  return {
    topWeight: Math.max(...working.map(s => s.actualWeight)),
    e1RM: mean(working.map((s, i) => estimateE1RM(s.actualWeight, s.actualReps, rirs[i]))),
    repsToFailure: mean(working.map((s, i) => s.actualReps + rirs[i])),
    avgRir: mean(rirs),
    rirAssumed: working.some(s => typeof s.rir !== 'number' || !Number.isFinite(s.rir)),
    meanReps: mean(working.map(s => s.actualReps)),
    minReps: Math.min(...working.map(s => s.actualReps)),
    workingSets: working.length,
  };
}

const sessionSignature = (session: Session) =>
  getCompletedSets(session).map(s => `${s.actualWeight}x${s.actualReps}@${s.rir ?? ''}`).join(',');

/**
 * The last session plus up to two earlier ones (most recent first). History
 * may already contain the last session; a matching newest entry is skipped.
 */
function recentSessions(input: ProgressionInput): Session[] {
  const prior = input.history.filter(s => getCompletedSets(s).length > 0);
  const newest = prior[prior.length - 1];
  if (newest && sessionSignature(newest) === sessionSignature(input.lastSession)) prior.pop();

  const lastTime = Date.parse(input.lastSession.timestamp);
  const recent = prior.filter((s) => {
    const t = Date.parse(s.timestamp);
    return !Number.isFinite(lastTime) || !Number.isFinite(t) || lastTime - t <= SMOOTHING_WINDOW_DAYS * 86400000;
  });
  return [input.lastSession, ...recent.slice(-(SMOOTHING_WEIGHTS.length - 1)).reverse()];
}

/**
 * Recency-weighted capacity: e1RM for loaded lifts, reps to failure for
 * bodyweight ones. Sessions of the other kind are skipped.
 */
function smoothedCapacity(input: ProgressionInput, last: SessionSummary, plannedRir: number) {
  const bodyweight = last.topWeight <= 0;
  let total = 0;
  let weightSum = 0;
  let used = 0;
  recentSessions(input).forEach((session, i) => {
    const summary = i === 0 ? last : summarizeSession(session, plannedRir);
    if (!summary || (summary.topWeight <= 0) !== bodyweight) return;
    total += SMOOTHING_WEIGHTS[i] * (bodyweight ? summary.repsToFailure : summary.e1RM);
    weightSum += SMOOTHING_WEIGHTS[i];
    used++;
  });
  return { value: weightSum > 0 ? total / weightSum : 0, sessionsUsed: used };
}

// ─── Performance Analysis ──────────────────────────────────────────────────────

export type PerformanceOptions = {
  /** RIR the next session aims for; effort is scored against it. Default 2. */
  targetRir?: number;
  /** RIR the last session's plan aimed for — assumed for sets without a logged RIR. Defaults to targetRir. */
  plannedRir?: number;
};

/**
 * Analyze a workout session to produce performance metrics.
 *
 * performanceScore is the effort of the working sets against the target RIR
 * (1 + 0.1 per rep in reserve above it), plus a bonus for extra sets and a
 * penalty for dropping weight mid-session:
 *   > 1.05 → easier than target, 0.95–1.05 → on target, < 0.95 → harder.
 * The engine classifies effort with exactly these thresholds.
 */
export function analyzePerformance(session: Session, options: PerformanceOptions = {}): PerformanceMetrics {
  const targetRir = options.targetRir ?? DEFAULT_TARGET_RIR;
  const plannedRir = options.plannedRir ?? targetRir;
  const completedSets = getCompletedSets(session);
  const plannedSetCount = session.plannedSets && session.plannedSets > 0
    ? session.plannedSets
    : session.sets.length;

  // Edge case: no completed sets
  if (completedSets.length === 0) {
    return {
      completionRatio: 0,
      intensityDeviation: 1,
      setDelta: -plannedSetCount,
      fatigueSlope: 0,
      performanceScore: 0.8,
      weightDropDetected: false,
      extraSetsDetected: false,
      avgRir: undefined,
      lastSetRir: undefined,
      rirCoverage: 0,
      rirAdjustment: 0,
    };
  }

  // ── Completion Ratio ──
  // Only the planned sets count toward the denominator.
  const plannedSetsOnly = session.sets.slice(0, plannedSetCount);
  const totalPlannedReps = plannedSetsOnly.reduce((sum, s) => sum + (s.plannedReps ?? s.actualReps), 0);
  const totalActualReps = plannedSetsOnly
    .filter(s => s.completed)
    .reduce((sum, s) => sum + s.actualReps, 0);
  const completionRatio = totalPlannedReps > 0 ? totalActualReps / totalPlannedReps : 1;

  // ── Intensity Deviation ──
  const avgPlannedWeight = completedSets.reduce((sum, s) => sum + (s.plannedWeight ?? s.actualWeight), 0) / completedSets.length;
  const avgActualWeight = completedSets.reduce((sum, s) => sum + s.actualWeight, 0) / completedSets.length;
  const intensityDeviation = avgPlannedWeight > 0 ? avgActualWeight / avgPlannedWeight : 1;

  // ── Set Delta ── (positive = extra sets, negative = skipped sets)
  const setDelta = completedSets.length - plannedSetCount;

  // ── Fatigue Slope ── (reps lost per set; negative is normal fatigue)
  let fatigueSlope = 0;
  if (completedSets.length > 1) {
    const firstRep = completedSets[0].actualReps;
    const lastRep = completedSets[completedSets.length - 1].actualReps;
    fatigueSlope = (lastRep - firstRep) / (completedSets.length - 1);
  }

  // ── Behavioral Flags ──
  const weightDropDetected = completedSets.some(s => s.actualWeight < (s.plannedWeight ?? s.actualWeight));
  const extraSetsDetected = setDelta > 0;

  // ── Reps In Reserve ──
  const rirSets = completedSets.filter((set) => typeof set.rir === 'number' && Number.isFinite(set.rir));
  const avgRir = rirSets.length > 0
    ? rirSets.reduce((sum, set) => sum + (set.rir as number), 0) / rirSets.length
    : undefined;
  const lastSetRir = rirSets.length > 0 ? rirSets[rirSets.length - 1].rir : undefined;
  const rirCoverage = rirSets.length / completedSets.length;
  const workingRir = mean(getWorkingSets(completedSets).map(s => effectiveRir(s, plannedRir)));
  const rirAdjustment = SCORE_PER_RIR * (workingRir - targetRir);

  // ── Performance Score ──
  let performanceScore = 1 + rirAdjustment;
  if (extraSetsDetected) performanceScore += Math.min(setDelta, 3) * EXTRA_SET_BONUS;
  if (weightDropDetected) performanceScore -= WEIGHT_DROP_PENALTY;

  return {
    completionRatio,
    intensityDeviation,
    setDelta,
    fatigueSlope,
    performanceScore,
    weightDropDetected,
    extraSetsDetected,
    avgRir,
    lastSetRir,
    rirCoverage,
    rirAdjustment,
  };
}

type Effort = 'harder' | 'on-target' | 'easier';

function classifyEffort(performanceScore: number): Effort {
  const band = SCORE_PER_RIR * RIR_TOLERANCE;
  if (performanceScore < 1 - band - 1e-9) return 'harder';
  if (performanceScore > 1 + band + 1e-9) return 'easier';
  return 'on-target';
}

// ─── Candidate Generation ──────────────────────────────────────────────────────

/** Nearest ladder rung to a weight, and the rungs a session may move to from it. */
function weightWindow(ladder: number[], weight: number, profile?: ProgressionProfile) {
  let idx = 0;
  for (let i = 1; i < ladder.length; i++) {
    if (Math.abs(ladder[i] - weight) < Math.abs(ladder[idx] - weight)) idx = i;
  }
  const base = ladder[idx];
  const up = Math.max(base * (1 + getProfileSettings(profile).maxJump), ladder[idx + 1] ?? base);
  const down = Math.min(base * (1 - MAX_DROP_FRACTION), ladder[idx - 1] ?? base);
  return { base, weights: ladder.filter(w => w >= down - 1e-9 && w <= up + 1e-9) };
}

/**
 * Every next-session option the engine considers: ladder weights within one
 * session's jump of the last top weight (at least one rung each way), every
 * rep count in the range, and the anchor set count ±1 — filtered by the
 * set bounds and time limit.
 */
export function generateCandidates(
  lastSession: Session,
  constraints: ProgressionInput['constraints'],
  equipment: ProgressionInput['equipment'],
  profile?: ProgressionProfile,
): Candidate[] {
  const working = getWorkingSets(getCompletedSets(lastSession));
  if (working.length === 0) return [];
  const ladder = getLadder(equipment, lastSession.liftId);
  if (ladder.length === 0) return [];

  const { weights } = weightWindow(ladder, Math.max(...working.map(s => s.actualWeight)), profile);
  const baseSets = getAnchorSetCount(lastSession, constraints);
  const timeSets = maxSetsForTime(constraints);
  const candidates: Candidate[] = [];
  for (const weight of weights) {
    for (let reps = Math.max(1, constraints.minReps); reps <= constraints.maxReps; reps++) {
      for (let sets = baseSets - 1; sets <= baseSets + 1; sets++) {
        if (sets < Math.max(1, constraints.minSets) || sets > constraints.maxSets || sets > timeSets) continue;
        candidates.push({ weight, reps, sets });
      }
    }
  }
  return candidates;
}

// ─── Decision ──────────────────────────────────────────────────────────────────

type Mode =
  | 'add-reps'    // same weight, more reps (double progression)
  | 'load'        // estimate supports a heavier weight before the top of the range
  | 'catch-up'    // +1 rep although the smoothed estimate lags behind it
  | 'weight-step' // top of the range → heavier, reps reset
  | 'big-jump'    // top of the range, next rung is beyond what the estimate supports
  | 'add-set'     // top of the range, endurance: a set before weight
  | 'ladder-top'  // top of the range at the heaviest weight available
  | 'hold'        // too hard / below range, weight stays
  | 'back-off'    // too hard / below range, lighter
  | 'floor';      // even the lightest option is predicted under the range

type Decision = Candidate & {
  mode: Mode;
  effort: Effort;
  targetRir: number;
  baseWeight: number;
  last: SessionSummary;
  e1RM: number;
  lastE1RM: number;
  gain: number;
  sessionsUsed: number;
  predictedRir?: number;
  setNote?: string;
};

function decideSets(input: ProgressionInput, perf: PerformanceMetrics, effort: Effort, last: SessionSummary) {
  const { constraints } = input;
  const anchor = getAnchorSetCount(input.lastSession, constraints);
  let sets = anchor;
  let note: string | undefined;
  if (effort !== 'harder' && anchor < constraints.maxSets && (perf.extraSetsDetected || getProfileSettings(input.profile).addSets)) {
    sets++;
    note = perf.extraSetsDetected ? 'you added sets last time' : 'endurance adds volume first';
  } else if (perf.fatigueSlope <= STEEP_FATIGUE_SLOPE) {
    sets--;
    note = 'reps fell off steeply across sets';
  } else if (effort === 'harder' && last.meanReps < constraints.minReps
    && perf.performanceScore <= 1 - SCORE_PER_RIR * SET_CUT_RIR_SHORTFALL) {
    sets--;
    note = 'well short of the target last time';
  }
  const limit = Math.max(1, Math.min(constraints.maxSets, maxSetsForTime(constraints)));
  return { anchor, sets: clamp(sets, Math.max(1, Math.min(constraints.minSets, limit)), limit), note, limit };
}

function decide(input: ProgressionInput, perf: PerformanceMetrics, last: SessionSummary, candidates: Candidate[], targetRir: number, plannedRir: number): Decision {
  const { minReps, maxReps } = input.constraints;
  const settings = getProfileSettings(input.profile);
  const effort = classifyEffort(perf.performanceScore);
  const bodyweight = last.topWeight <= 0;
  const { base } = weightWindow(getLadder(input.equipment, input.lastSession.liftId), last.topWeight, input.profile);

  const capacity = smoothedCapacity(input, last, plannedRir);
  const gain = effort === 'harder' ? 0 : settings.sessionGain;
  const expected = capacity.value * (1 + gain);
  /** RIR the estimate predicts for weight × reps; undefined where it can't say (added weight on a bodyweight lift). */
  const predictRir = (weight: number, reps: number) => {
    if (bodyweight) return weight <= 0 ? expected - reps : undefined;
    return repsToFailureAt(expected, weight) - reps;
  };

  const setPlan = decideSets(input, perf, effort, last);
  const { anchor, limit } = setPlan;
  let sets = setPlan.sets;
  let setNote = setPlan.note;
  const pool = candidates.filter(c => c.sets === sets);
  const options = pool.length > 0 ? pool : candidates;

  const heaviest = (allowed: (w: number) => boolean, goal: number, ceiling: number) => options
    .filter((c) => {
      const rir = predictRir(c.weight, c.reps);
      return allowed(c.weight) && c.reps >= goal && c.reps <= ceiling && rir !== undefined && rir >= targetRir - RIR_TOLERANCE - 1e-9;
    })
    .sort((a, b) => b.weight - a.weight || b.reps - a.reps)[0];

  const top = last.minReps >= maxReps;
  const below = last.meanReps < minReps;
  let weight = base;
  let reps: number;
  let mode: Mode;

  if (top && effort !== 'harder') {
    const heavier = options.map(c => c.weight).filter(w => w > base + 1e-9).sort((a, b) => a - b);
    if (settings.addSets && sets > anchor) {
      mode = 'add-set';
      reps = maxReps;
    } else {
      // Reset below the top so the coming sessions can add reps again.
      const pick = heaviest(w => w > base + 1e-9, minReps, maxReps > minReps ? maxReps - 1 : maxReps);
      if (pick) {
        mode = 'weight-step';
        weight = pick.weight;
        reps = pick.reps;
      } else if (heavier.length > 0) {
        mode = 'big-jump';
        weight = heavier[0];
        reps = minReps;
      } else {
        mode = 'ladder-top';
        reps = maxReps;
        if (anchor < limit) {
          sets = Math.max(sets, anchor + 1);
          setNote = 'no heavier weight available';
        }
      }
    }
  } else if (effort === 'harder' || below) {
    const pick = heaviest(w => w <= base + 1e-9, minReps, maxReps);
    if (pick) {
      mode = pick.weight < base - 1e-9 ? 'back-off' : 'hold';
      weight = pick.weight;
      reps = pick.reps;
    } else {
      mode = 'floor';
      weight = Math.min(...options.map(c => c.weight));
      reps = minReps;
    }
  } else {
    const goal = clamp(Math.round(last.meanReps) + 1, minReps, maxReps);
    const pick = heaviest(settings.loadBeforeTop ? (w => w >= base - 1e-9) : (w => Math.abs(w - base) < 1e-9), goal, maxReps);
    if (pick) {
      mode = pick.weight > base + 1e-9 ? 'load' : 'add-reps';
      weight = pick.weight;
      reps = pick.reps;
    } else {
      mode = 'catch-up';
      reps = goal;
    }
  }

  const lastE1RM = bodyweight ? last.repsToFailure : last.e1RM;
  return {
    weight, reps, sets, mode, effort, targetRir, baseWeight: base, last,
    e1RM: capacity.value, lastE1RM, gain, sessionsUsed: capacity.sessionsUsed,
    predictedRir: predictRir(weight, reps),
    setNote: sets !== anchor ? setNote : undefined,
  };
}

// ─── Workout Generation ────────────────────────────────────────────────────────

/**
 * Generate the next workout plan for one lift.
 *
 * 1. Target RIR from the workout type and the intensity slider.
 * 2. Score last session's effort against it (performanceScore).
 * 3. Estimate strength from reps + RIR, smoothed over recent sessions.
 * 4. Pick sets, then the heaviest ladder weight × reps the estimate predicts at
 *    the target RIR, following double progression.
 * 5. Explain the decision from the same numbers.
 */
export function generateNextWorkout(input: ProgressionInput): WorkoutPlan {
  const emptyBreakdown: ScoringBreakdown = {
    totalLoad: 0, lastLoad: 0, overloadRatio: 1,
    e1RM: 0, lastE1RM: 0, intensityRatio: 1,
    performanceAdjustment: 'No previous data available.',
  };

  const emptyMetrics: PerformanceMetrics = {
    completionRatio: 1, intensityDeviation: 1, setDelta: 0,
    fatigueSlope: 0, performanceScore: 1,
    weightDropDetected: false, extraSetsDetected: false,
    avgRir: undefined, lastSetRir: undefined, rirCoverage: 0, rirAdjustment: 0,
  };

  // Edge case: no previous sets
  if (input.lastSession.sets.length === 0) {
    return {
      suggestedWeight: 0,
      suggestedReps: 10,
      suggestedSets: 3,
      reasoning: 'No previous session data. Starting with baseline.',
      scoringBreakdown: emptyBreakdown,
      candidatesEvaluated: 0,
      performanceMetrics: emptyMetrics,
    };
  }

  // The plan last time aimed at the slider-neutral target; that's what unlogged sets are assumed at.
  const plannedRir = getTargetRir(1, input.typeIntensity);
  const targetRir = getTargetRir(input.intensity, input.typeIntensity);
  const perf = analyzePerformance(input.lastSession, { targetRir, plannedRir });
  if (input.deload) return buildDeloadPlan(input, perf, emptyBreakdown);

  const last = summarizeSession(input.lastSession, plannedRir);
  const candidates = generateCandidates(input.lastSession, input.constraints, input.equipment, input.profile);
  if (!last || candidates.length === 0) {
    const completedSets = getCompletedSets(input.lastSession);
    return {
      suggestedWeight: last?.topWeight || 0,
      suggestedReps: last ? Math.round(last.meanReps) : 10,
      suggestedSets: completedSets.length || 3,
      reasoning: 'No valid options within the constraints. Repeating previous session.',
      scoringBreakdown: emptyBreakdown,
      candidatesEvaluated: candidates.length,
      performanceMetrics: perf,
    };
  }

  const decision = decide(input, perf, last, candidates, targetRir, plannedRir);
  const completedSets = getCompletedSets(input.lastSession);
  const lastLoad = completedSets.reduce((sum, s) => sum + s.actualWeight * s.actualReps, 0);
  const totalLoad = decision.weight * decision.reps * decision.sets;
  const overloadRatio = lastLoad > 0
    ? totalLoad / lastLoad
    : (decision.reps * decision.sets) / Math.max(1, completedSets.reduce((sum, s) => sum + s.actualReps, 0));
  const text = describe(decision, input);

  return {
    suggestedWeight: decision.weight,
    suggestedReps: decision.reps,
    suggestedSets: decision.sets,
    reasoning: text.reasoning,
    scoringBreakdown: {
      totalLoad,
      lastLoad,
      overloadRatio,
      // For bodyweight lifts these are reps to failure, not lbs.
      e1RM: decision.last.topWeight > 0 ? decision.e1RM : 0,
      lastE1RM: decision.last.topWeight > 0 ? decision.lastE1RM : 0,
      intensityRatio: decision.lastE1RM > 0 ? decision.e1RM / decision.lastE1RM : 1,
      targetRir,
      predictedRir: decision.predictedRir,
      expectedGain: decision.gain,
      sessionsUsed: decision.sessionsUsed,
      performanceAdjustment: text.explanation,
    },
    candidatesEvaluated: candidates.length,
    performanceMetrics: perf,
  };
}

/**
 * Deload: same reps, ~15% lighter (snapped down to a valid weight), one fewer
 * set. Deliberately not scored — the point is to recover, not to progress.
 */
function buildDeloadPlan(input: ProgressionInput, perf: PerformanceMetrics, emptyBreakdown: ScoringBreakdown): WorkoutPlan {
  const working = getWorkingSets(getCompletedSets(input.lastSession));
  const refWeight = working.length > 0 ? Math.max(...working.map(s => s.actualWeight)) : 0;
  const refReps = working.filter(s => s.actualWeight === refWeight).reduce((best, s) => Math.max(best, s.actualReps), 0);
  const ladder = getLadder(input.equipment, input.lastSession.liftId);
  const targetWeight = refWeight * (1 - DELOAD_WEIGHT_REDUCTION);
  const weight = [...ladder].reverse().find(w => w <= targetWeight + 1e-9) ?? ladder[0] ?? 0;
  const reps = clamp(refReps || input.constraints.minReps, input.constraints.minReps, input.constraints.maxReps);
  const sets = Math.max(1, input.constraints.minSets, getAnchorSetCount(input.lastSession, input.constraints) - 1);

  return {
    suggestedWeight: weight,
    suggestedReps: reps,
    suggestedSets: sets,
    reasoning: `Deload: ${refWeight > 0 ? `~${Math.round(DELOAD_WEIGHT_REDUCTION * 100)}% lighter, ` : ''}one fewer set to recover.`,
    scoringBreakdown: { ...emptyBreakdown, performanceAdjustment: 'Deload session — progression paused.' },
    candidatesEvaluated: 0,
    performanceMetrics: perf,
  };
}

// ─── Explanation ───────────────────────────────────────────────────────────────

/**
 * Short reasoning (shown with the suggestion) and a longer explanation (the
 * "how this was picked" panel), both written from the decision's numbers.
 */
function describe(d: Decision, input: ProgressionInput): { reasoning: string; explanation: string } {
  const display = input.displayWeight ?? ((w: number) => w);
  const lbs = (w: number) => `${round1(display(w))} lbs`;
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const { minReps, maxReps } = input.constraints;
  const bodyweight = d.last.topWeight <= 0;
  const lastReps = Math.round(d.last.meanReps);
  const T = d.targetRir;

  // What changes vs. last session
  const changes: string[] = [];
  const weightDelta = round1(display(d.weight) - display(d.last.topWeight));
  changes.push(weightDelta > 0 ? `↑ Weight +${weightDelta} lbs` : weightDelta < 0 ? `↓ Weight ${weightDelta} lbs` : '→ Weight held');
  if (d.reps !== lastReps) changes.push(`${d.reps > lastReps ? '↑' : '↓'} Reps ${signed(d.reps - lastReps)}`);
  const setDelta = d.sets - getCompletedSets(input.lastSession).length;
  if (setDelta !== 0) changes.push(`${setDelta > 0 ? '↑' : '↓'} Sets ${signed(setDelta)}`);

  // Effort vs. target
  const effortWord = { harder: 'harder than target', 'on-target': 'on target', easier: 'easier than target' }[d.effort];
  const effort = `RIR ${round1(d.last.avgRir)}${d.last.rirAssumed ? ' (est.)' : ''} vs target ${T}: ${effortWord}`;

  // Strength estimate the plan is built on
  const estimate = bodyweight
    ? `~${round1(d.e1RM)} reps to failure`
    : `est. 1RM ${lbs(d.e1RM)}`;
  const overReach = d.predictedRir !== undefined && d.predictedRir < 0;
  const plan = `${bodyweight && d.weight <= 0 ? 'bodyweight' : lbs(d.weight)} × ${d.reps}${
    d.predictedRir === undefined ? '' : overReach ? ' (above the estimate)' : ` ≈ RIR ${round1(d.predictedRir)}`}`;

  const sentences: string[] = [];
  sentences.push(`Last session's working sets averaged ${round1(d.last.meanReps)} reps at ${d.last.rirAssumed ? 'an estimated ' : ''}RIR ${round1(d.last.avgRir)} (target ${T}), so it was ${effortWord}.`);
  if (d.last.rirAssumed) sentences.push('Sets without a logged RIR are assumed at the planned RIR, adjusted by reps over or under plan.');
  const basis = bodyweight
    ? `That's about ${round1(d.e1RM)} reps to failure`
    : `Reps + RIR put your 1RM at ${lbs(d.e1RM)}`;
  sentences.push(`${basis}${d.sessionsUsed > 1 ? ` (weighted over the last ${d.sessionsUsed} sessions)` : ''}${d.gain > 0 ? `; planning for +${round1(d.gain * 100)}% progress` : '; no progress assumed until the effort is back on target'}.`);

  const atBase = bodyweight ? undefined : round1(repsToFailureAt(d.e1RM * (1 + d.gain), d.baseWeight) - T);
  const predicted = d.predictedRir !== undefined ? `, predicted RIR ${round1(Math.max(0, d.predictedRir))}` : '';
  switch (d.mode) {
    case 'add-reps':
      sentences.push(`Double progression: same weight, ${d.reps} reps${predicted}; weight goes up once every set reaches ${maxReps}.`);
      break;
    case 'load':
      sentences.push(`The estimate supports ${lbs(d.weight)} for ${d.reps} reps${predicted}.`);
      break;
    case 'catch-up':
      sentences.push(`Double progression: +1 rep to ${d.reps}${predicted} — the averaged estimate trails your latest session.`);
      break;
    case 'weight-step':
      sentences.push(`Every set reached the top of the ${minReps}–${maxReps} range, so the weight goes up and reps reset to ${d.reps}${predicted}.`);
      break;
    case 'big-jump': {
      const jump = d.baseWeight > 0 ? `+${Math.round((d.weight / d.baseWeight - 1) * 100)}%` : 'the first added weight';
      const toFailure = d.predictedRir !== undefined ? round1(Math.max(0, d.predictedRir + d.reps)) : undefined;
      sentences.push(toFailure !== undefined
        ? `Top of the ${minReps}–${maxReps} range, and the next weight is ${jump}: the estimate gives only ~${toFailure} reps to failure there, so ${d.reps} is a stretch — stop a rep short of failure and the next plan adjusts to what you log.`
        : `Top of the ${minReps}–${maxReps} range: moving to ${lbs(d.weight)} (${jump}) at ${d.reps} reps.`);
      break;
    }
    case 'add-set':
      sentences.push(`Top of the range: adding a set before adding weight.`);
      break;
    case 'ladder-top':
      sentences.push(`Top of the range at the heaviest weight available; holding ${d.reps} reps.`);
      break;
    case 'hold':
      sentences.push(`Holding ${lbs(d.weight)}: ${d.reps} reps${predicted}.`);
      break;
    case 'back-off':
      sentences.push(`${lbs(d.baseWeight)} projects only ${atBase} reps at RIR ${T}, below ${minReps}, so the weight comes down: ${d.reps} reps${predicted}.`);
      break;
    case 'floor':
      sentences.push(`Even ${lbs(d.weight)} projects under ${minReps} reps at RIR ${T}; start there and rebuild.`);
      break;
  }
  if (d.setNote) sentences.push(`${d.sets > getAnchorSetCount(input.lastSession, input.constraints) ? 'One more set' : 'One set fewer'}: ${d.setNote}.`);

  return {
    reasoning: `${changes.join(' ')} • ${effort} • ${estimate} → ${plan}`,
    explanation: sentences.join(' '),
  };
}

// ─── Analytics Helpers ─────────────────────────────────────────────────────────
// Used by the analytics pages only, built from the engine's own pieces so the
// numbers shown there match what generateNextWorkout does.

export type ProgressReview = {
  /** RIR the engine aimed for going into the latest session. */
  targetRir: number;
  /** The session before it, scored the way the engine scores it. */
  performance: PerformanceMetrics;
  effort: Effort;
  /** Strength gain the engine assumed after that session (0.025 = +2.5%). */
  expectedGain: number;
  /** e1RM the plan was built on: the previous session's reps + RIR, smoothed with up to two earlier ones. */
  estimatedE1RM: number;
  /** Working-set e1RM (reps + RIR) of the previous and the latest session alone. */
  prevE1RM: number;
  currE1RM: number;
  /** Latest e1RM vs. the estimate (compare with expectedGain). */
  achievedGain: number;
  /** Mean RIR the estimate (plus the expected gain) predicts for the latest working sets as lifted. */
  predictedRir: number;
  /** Mean RIR of those sets as logged; assumed from planned reps where none was logged. */
  actualRir: number;
  actualRirAssumed: boolean;
};

/**
 * Compare a lift's latest session with what the engine expected from the ones
 * before it. Sessions oldest first; undefined without two loaded sessions.
 */
export function reviewProgress(
  sessions: Session[],
  options: { intensity: number; typeIntensity?: number; profile?: ProgressionProfile },
): ProgressReview | undefined {
  if (sessions.length < 2) return undefined;
  const prev = sessions[sessions.length - 2];
  const curr = sessions[sessions.length - 1];
  const plannedRir = getTargetRir(1, options.typeIntensity);
  const targetRir = getTargetRir(options.intensity, options.typeIntensity);
  const prevSummary = summarizeSession(prev, plannedRir);
  const currSummary = summarizeSession(curr, plannedRir);
  if (!prevSummary || !currSummary || prevSummary.topWeight <= 0 || currSummary.topWeight <= 0) return undefined;

  const performance = analyzePerformance(prev, { targetRir, plannedRir });
  const effort = classifyEffort(performance.performanceScore);
  const expectedGain = effort === 'harder' ? 0 : getProfileSettings(options.profile).sessionGain;
  // smoothedCapacity only reads lastSession and history.
  const capacity = smoothedCapacity({ lastSession: prev, history: sessions.slice(0, -2) } as ProgressionInput, prevSummary, plannedRir);
  const expected = capacity.value * (1 + expectedGain);
  const working = getWorkingSets(getCompletedSets(curr)).filter(s => s.actualReps > 0);

  return {
    targetRir,
    performance,
    effort,
    expectedGain,
    estimatedE1RM: capacity.value,
    prevE1RM: prevSummary.e1RM,
    currE1RM: currSummary.e1RM,
    achievedGain: capacity.value > 0 ? currSummary.e1RM / capacity.value - 1 : 0,
    predictedRir: mean(working.map(s => repsToFailureAt(expected, s.actualWeight) - s.actualReps)),
    actualRir: currSummary.avgRir,
    actualRirAssumed: currSummary.rirAssumed,
  };
}
