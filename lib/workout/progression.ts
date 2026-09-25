import { calcAverage1RM } from './analytics';

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
  performanceScore: number;
  weightDropDetected: boolean;   // true if user dropped weight mid-session
  extraSetsDetected: boolean;    // true if user added sets beyond planned
  avgRir?: number;
  lastSetRir?: number;
  rirCoverage?: number;
  rirAdjustment?: number;
};

export type ScoringBreakdown = {
  totalLoad: number;        // candidate's total load (weight × reps × sets)
  lastLoad: number;         // previous session's total load
  overloadRatio: number;    // totalLoad / lastLoad
  e1RM: number;             // candidate's estimated 1RM
  lastE1RM: number;         // previous session's estimated 1RM
  intensityRatio: number;   // e1RM / lastE1RM
  targetRatio?: number;     // blended progress ratio the engine aimed for
  rawScore: number;         // numeric score before intensity bias
  intensityBias: number;    // score contribution from intensity preference
  performanceAdjustment: string;  // human-readable explanation
};

export type ProgressionProfile = 'standard' | 'high-rep' | 'endurance';

export type ProgressionInput = {
  lastSession: Session;
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

/**
 * Pre-computed values shared by every candidate in one engine run. Computing
 * them once keeps the performance/trend adjustments from being applied twice.
 */
export type ScoringContext = {
  /** Target progress for the blended strength/volume ratio, e.g. 0.05 = +5%. */
  targetOverload: number;
  /** 0..1 — how much the score cares about e1RM vs. total volume. */
  strengthWeight: number;
  /** Largest weight increase allowed this session, in lbs. */
  allowedJump: number;
  historyTrend: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Average seconds per set including rest (heuristic for time-limit filtering) */
const AVG_SET_TIME_SECONDS = 90;

type ProfileSettings = {
  /** Base percentage increase target per session */
  baseIncrease: number;
  /** Maximum allowed weight jump as fraction of current weight */
  jumpFraction: number;
  /** Baseline emphasis on strength (e1RM) over volume */
  strengthWeight: number;
};

const PROFILE_SETTINGS: Record<ProgressionProfile, ProfileSettings> = {
  standard: { baseIncrease: 0.05, jumpFraction: 0.15, strengthWeight: 0.6 },
  'high-rep': { baseIncrease: 0.03, jumpFraction: 0.05, strengthWeight: 0.3 },
  endurance: { baseIncrease: 0.02, jumpFraction: 0.03, strengthWeight: 0.15 },
};

/** How strongly last session's performance moves the target (per 1.0 of score). */
const PERFORMANCE_SENSITIVITY = 0.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getProfileSettings(profile: ProgressionProfile | undefined): ProfileSettings {
  return PROFILE_SETTINGS[profile || 'standard'] || PROFILE_SETTINGS.standard;
}

function getCompletedSets(session: Session) {
  return session.sets.filter(s => s.completed);
}

/**
 * The reference ("top") set of a session — the heaviest completed set, using
 * reps as the tie-breaker. Using the last set instead made a single back-off or
 * drop set drag the next suggestion down.
 */
function getReferenceSet(completedSets: SetLog[]): SetLog | undefined {
  let best: SetLog | undefined;
  let bestE1RM = -Infinity;
  for (const set of completedSets) {
    const e1rm = calcAverage1RM(set.actualWeight, set.actualReps);
    if (!best || set.actualWeight > best.actualWeight || (set.actualWeight === best.actualWeight && e1rm > bestE1RM)) {
      best = set;
      bestE1RM = e1rm;
    }
  }
  return best;
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

// ─── Performance Analysis ──────────────────────────────────────────────────────

/**
 * Analyze a workout session to produce performance metrics.
 *
 * Key signals:
 * - completionRatio: did the user hit their planned reps?
 * - intensityDeviation: did the user use the planned weight?
 * - fatigueSlope: how quickly did reps drop across sets?
 * - weightDropDetected / extraSetsDetected: binary flags for specific behaviors
 *
 * performanceScore is normalized around 1.0:
 *   > 1.05 → session was too easy
 *   0.95–1.05 → appropriate difficulty
 *   < 0.95 → session was too hard
 */
export function analyzePerformance(session: Session): PerformanceMetrics {
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
  // Only the planned sets count toward the denominator; extra sets are
  // rewarded separately below instead of inflating completion.
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

  // ── Set Delta ──
  // Positive = user did extra sets, negative = user skipped sets
  const setDelta = completedSets.length - plannedSetCount;

  // ── Fatigue Slope ──
  // Negative slope means reps decreased across sets (normal fatigue)
  // Positive slope means reps increased (unusual — indicates too easy)
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
  const rirCoverage = completedSets.length > 0 ? rirSets.length / completedSets.length : 0;
  const rirAdjustment = avgRir !== undefined && lastSetRir !== undefined
    ? clamp(((avgRir - 2) * 0.04) + ((lastSetRir - 2) * 0.02), -0.12, 0.12)
    : 0;

  // ── Performance Score ──
  // Base: weighted combination of completion and intensity
  let performanceScore = (completionRatio * 0.5) + (intensityDeviation * 0.5);

  // Reward extra sets (user felt strong)
  if (extraSetsDetected) {
    performanceScore += Math.min(setDelta, 3) * 0.05;
  }

  // Penalize weight drops (user struggled with planned weight)
  if (weightDropDetected) {
    performanceScore -= 0.08;
  }

  // Factor in fatigue slope: steep negative slope = user fatiguing quickly = harder session
  // Typical values: -0.5 to +0.5 per set
  if (fatigueSlope < 0) {
    performanceScore += fatigueSlope * 0.1; // negative slope reduces score
  } else if (fatigueSlope > 0) {
    performanceScore += fatigueSlope * 0.05; // positive slope slightly boosts score
  }

  performanceScore += rirAdjustment;

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

// ─── History Trend Analysis ────────────────────────────────────────────────────

/**
 * Compute a rolling performance trend from recent history.
 * Returns a multiplier: >1.0 means recent sessions trended strong, <1.0 means struggled.
 * Used to bias the effective intensity up or down.
 */
export function computeHistoryTrend(history: Session[]): number {
  if (history.length < 2) return 1.0;

  // Analyze up to last 5 sessions for trend
  const recentSessions = history.slice(-5);
  const scores = recentSessions.map(s => analyzePerformance(s).performanceScore);
  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  // Check for consistent direction
  let consecutiveOver = 0;
  let consecutiveUnder = 0;
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] > 1.05) consecutiveOver++;
    else break;
  }
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i] < 0.95) consecutiveUnder++;
    else break;
  }

  // Amplify trend if consistent across 3+ sessions
  if (consecutiveOver >= 3) return clamp(avgScore, 1.0, 1.15);
  if (consecutiveUnder >= 3) return clamp(avgScore, 0.85, 1.0);

  return clamp(avgScore, 0.9, 1.1);
}

// ─── Candidate Generation ──────────────────────────────────────────────────────

/**
 * Generate nearby workout candidates by varying weight, reps, and sets.
 *
 * Weight: ±2 discrete steps on the equipment weight ladder
 * Reps: ±2 from base (down to −4 for heavier weights)
 * Sets: ±1 from base
 *
 * All candidates are pre-filtered against:
 * - Equipment validity (only valid weights)
 * - Rep/set bounds from constraints
 * - Time limit (if specified)
 */
export function generateCandidates(
  lastSession: Session,
  constraints: ProgressionInput['constraints'],
  equipment: ProgressionInput['equipment']
): Candidate[] {
  const completedSets = getCompletedSets(lastSession);
  const refSet = getReferenceSet(completedSets);
  if (!refSet) return [];

  const baseWeight = refSet.actualWeight;
  // Clamp the rep anchor into the allowed range so a session far outside the
  // rep range still produces candidates instead of an empty list.
  const baseReps = clamp(refSet.actualReps, constraints.minReps, constraints.maxReps);
  const baseSets = getAnchorSetCount(lastSession, constraints);

  // Get the sorted list of valid weights for this lift's equipment
  const possibleWeights = [...equipment.getValidWeights(lastSession.liftId)]
    .filter(w => Number.isFinite(w))
    .sort((a, b) => a - b);
  if (possibleWeights.length === 0) return [];

  // Find the rung closest to the weight actually used (it may not be on the
  // ladder at all if the equipment changed since last session).
  let safeIdx = 0;
  for (let i = 1; i < possibleWeights.length; i++) {
    if (Math.abs(possibleWeights[i] - baseWeight) < Math.abs(possibleWeights[safeIdx] - baseWeight)) {
      safeIdx = i;
    }
  }

  // Generate weight candidates: ±2 steps on the ladder
  const uniqueWeights = new Set<number>();
  for (let offset = -2; offset <= 2; offset++) {
    const idx = safeIdx + offset;
    if (idx >= 0 && idx < possibleWeights.length) uniqueWeights.add(possibleWeights[idx]);
  }

  // Time limit in seconds (if specified)
  const timeLimitSecs = constraints.timeLimit ? constraints.timeLimit * 60 : Infinity;

  const candidates: Candidate[] = [];

  for (const w of uniqueWeights) {
    // Heavier rungs may need to drop further down the rep range (e.g. 10 lb
    // → 15 lb dumbbells), so they get a wider downward rep window.
    const minOffset = w > baseWeight ? -4 : -2;
    for (let rOffset = minOffset; rOffset <= 2; rOffset++) {
      const r = baseReps + rOffset;
      if (r < constraints.minReps || r > constraints.maxReps || r < 1) continue;

      for (let sOffset = -1; sOffset <= 1; sOffset++) {
        const s = baseSets + sOffset;
        if (s < constraints.minSets || s > constraints.maxSets || s < 1) continue;

        // Time limit filter: reject if estimated time exceeds limit
        if (s * AVG_SET_TIME_SECONDS > timeLimitSecs) continue;

        candidates.push({ weight: w, reps: r, sets: s });
      }
    }
  }

  return candidates;
}

// ─── Scoring Context ───────────────────────────────────────────────────────────

/**
 * Build the per-run scoring context.
 *
 * The target is additive rather than multiplicative so a poor session can
 * actually produce a *negative* target (back off), while a strong one pushes
 * harder. Previously the target was baseIncrease × intensity × performance,
 * which was always positive — the engine kept adding load after failed sessions.
 */
export function buildScoringContext(
  input: ProgressionInput,
  performanceMetrics: PerformanceMetrics,
  historyTrend = 1.0,
): ScoringContext {
  const settings = getProfileSettings(input.profile);
  const intensity = clamp(Number.isFinite(input.intensity) ? input.intensity : 1, 0.5, 1.5);

  const perfDelta = clamp(performanceMetrics.performanceScore - 1, -0.3, 0.3);
  const targetOverload = clamp(
    settings.baseIncrease * intensity * historyTrend + perfDelta * PERFORMANCE_SENSITIVITY,
    -0.15,
    0.2,
  );

  // Higher intensity shifts emphasis toward strength (heavier weight), lower
  // intensity toward volume (reps/sets). Continuous — no hard mode switches.
  const strengthWeight = clamp(settings.strengthWeight + (intensity - 1) * 0.6, 0.1, 0.9);

  const refSet = getReferenceSet(getCompletedSets(input.lastSession));
  const refWeight = refSet?.actualWeight || 0;
  let allowedJump = refWeight * settings.jumpFraction * (0.75 + intensity);

  // Always allow at least one rung up the ladder. Otherwise light dumbbells
  // (10 → 15 lbs is +50%) or coarse stacks could never progress on weight.
  const ladder = [...input.equipment.getValidWeights(input.lastSession.liftId)].sort((a, b) => a - b);
  const nextRung = ladder.find(w => w > refWeight);
  if (nextRung !== undefined) {
    allowedJump = Math.max(allowedJump, nextRung - refWeight);
  }

  return { targetOverload, strengthWeight, allowedJump, historyTrend };
}

// ─── Candidate Scoring ─────────────────────────────────────────────────────────

/**
 * Score a workout candidate with a full breakdown of contributing factors.
 *
 * Scoring considers:
 * 1. How close the candidate's blended strength/volume progress is to target
 * 2. Rep-range (double progression): at the rep ceiling → add weight,
 *    below the rep floor → drop weight
 * 3. Profile preferences (high-rep and endurance favor reps/sets over weight)
 * 4. Fatigue awareness (steep fatigue → reward fewer sets)
 * 5. Rep scheme continuity (reward staying at current reps if performance was appropriate)
 * 6. Allowed jump limits (reject unrealistic weight increases)
 */
export function scoreCandidateDetailed(
  candidate: Candidate,
  input: ProgressionInput,
  performanceMetrics: PerformanceMetrics,
  context: ScoringContext = buildScoringContext(input, performanceMetrics),
): { score: number; breakdown: ScoringBreakdown } {
  const completedSets = getCompletedSets(input.lastSession);
  const refSet = getReferenceSet(completedSets);
  if (!refSet) {
    return {
      score: 0,
      breakdown: {
        totalLoad: 0, lastLoad: 0, overloadRatio: 1,
        e1RM: 0, lastE1RM: 0, intensityRatio: 1,
        rawScore: 0, intensityBias: 0,
        performanceAdjustment: 'No completed sets to compare.',
      },
    };
  }

  const profile = input.profile || 'standard';
  const { minReps, maxReps } = input.constraints;
  const lastWeight = refSet.actualWeight;
  const lastReps = refSet.actualReps;
  const anchorSets = getAnchorSetCount(input.lastSession, input.constraints);

  // ── Load & 1RM calculations ──
  const lastLoad = completedSets.reduce((sum, s) => sum + s.actualWeight * s.actualReps, 0);
  const totalLoad = candidate.weight * candidate.reps * candidate.sets;
  const lastE1RM = calcAverage1RM(lastWeight, lastReps);
  const e1RM = calcAverage1RM(candidate.weight, candidate.reps);

  // Bodyweight lifts can have 0 added weight — fall back to rep/set volume.
  const overloadRatio = lastLoad > 0
    ? totalLoad / lastLoad
    : (candidate.reps * candidate.sets) / Math.max(1, completedSets.reduce((sum, s) => sum + s.actualReps, 0));
  const intensityRatio = lastE1RM > 0
    ? e1RM / lastE1RM
    : candidate.reps / Math.max(1, lastReps);

  const targetRatio = 1 + context.targetOverload;

  // ── Allowed jump enforcement ──
  const weightDelta = candidate.weight - lastWeight;
  if (weightDelta > context.allowedJump + 1e-9) {
    return {
      score: -1000,
      breakdown: {
        totalLoad, lastLoad, overloadRatio, e1RM, lastE1RM, intensityRatio, targetRatio,
        rawScore: -1000, intensityBias: 0,
        performanceAdjustment: `Weight jump of ${weightDelta} lbs exceeds allowed ${Math.round(context.allowedJump)} lbs.`,
      },
    };
  }

  // ── Core score: closeness to target progress ──
  // Volume is compared per set so the set count can't be used to "balance" a
  // weight/rep choice; set changes are handled by explicit rules below.
  const lastPerSetLoad = lastLoad / completedSets.length;
  const perSetRatio = lastPerSetLoad > 0
    ? (candidate.weight * candidate.reps) / lastPerSetLoad
    : candidate.reps / Math.max(1, lastReps);
  const blendedRatio = context.strengthWeight * intensityRatio + (1 - context.strengthWeight) * perSetRatio;
  const diffFromTarget = Math.abs(blendedRatio - targetRatio);
  let rawScore = 100 - (diffFromTarget * 100);

  // ── Regression guards ──
  // When the goal is to progress, a candidate must not quietly trade one
  // dimension for another (e.g. drop 10 lbs but add a set). Going heavier for
  // fewer reps is a legitimate progression, so volume dips are only penalized
  // when the weight didn't go up.
  if (context.targetOverload >= 0) {
    if (intensityRatio < 0.995) rawScore -= (1 - intensityRatio) * 150;
    if (perSetRatio < 0.97 && weightDelta <= 0) rawScore -= (1 - perSetRatio) * 60;
    // Lighter weight is a step back unless reps fell below the range.
    if (weightDelta < 0 && lastReps >= minReps) rawScore -= 5;
  }

  // ── Set stability ──
  // Changing set count swings volume by 25–50%, so only do it with a reason.
  const setChange = candidate.sets - anchorSets;
  if (setChange !== 0) {
    const justifiedUp = setChange > 0 && (performanceMetrics.extraSetsDetected || profile === 'endurance');
    const justifiedDown = setChange < 0 && (performanceMetrics.fatigueSlope < -0.5 || context.targetOverload < -0.03);
    if (justifiedUp || justifiedDown) rawScore += 3;
    else rawScore -= 12 * Math.abs(setChange);
  }

  // ── Rep scheme continuity bonus ──
  // If performance was appropriate (0.95–1.05), reward staying at current reps
  if (performanceMetrics.performanceScore >= 0.95 &&
      performanceMetrics.performanceScore <= 1.05 &&
      context.strengthWeight < 0.8 &&
      candidate.reps === lastReps) {
    rawScore += 2;
  }

  // ── Preference biases ──
  let intensityBias = 0;
  const notes: string[] = [];

  // Double progression: once reps hit the top of the range, the next step is
  // more weight; if reps fell under the floor, the weight was too heavy.
  if (lastReps >= maxReps && context.targetOverload > 0) {
    if (weightDelta > 0) intensityBias += 10;
    notes.push('Top of rep range reached → adding weight.');
  } else if (lastReps < minReps) {
    if (weightDelta < 0) intensityBias += 8;
    if (weightDelta > 0) intensityBias -= 15;
    notes.push('Below rep range → reducing weight.');
  }

  if (profile === 'high-rep') {
    // High-rep: favor reps first; only permit weight increase once near ceiling
    if (candidate.reps > lastReps) intensityBias += 6;
    if (weightDelta > 0 && lastReps < maxReps) intensityBias -= 15;
    notes.push('High-rep profile: favoring rep increases over weight.');
  } else if (profile === 'endurance') {
    // Endurance: sets > reps > weight
    if (setChange > 0) intensityBias += 3;
    if (candidate.reps > lastReps) intensityBias += 3;
    if (weightDelta > 0) intensityBias -= 15;
    notes.push('Endurance profile: favoring volume over intensity.');
  } else if (context.strengthWeight >= 0.75) {
    if (weightDelta > 0) intensityBias += 5;
    notes.push('High intensity: favoring weight over volume.');
  } else if (context.strengthWeight <= 0.4) {
    // Low intensity: keep weight steady, progress via reps/sets
    if (weightDelta > 0) intensityBias -= 10;
    notes.push('Low intensity: favoring volume, limiting weight.');
  } else {
    notes.push('Balanced progression targeting moderate overload.');
  }

  // A negative target means back off; don't reward adding weight in that case.
  if (context.targetOverload < 0 && weightDelta > 0) {
    intensityBias -= 10;
  }

  if (performanceMetrics.fatigueSlope < -0.5 && setChange < 0) {
    notes.push('Fatigue detected: fewer sets preferred.');
  }

  const score = rawScore + intensityBias;

  // ── Build performance adjustment explanation ──
  let performanceAdjustment = notes.join(' ');
  if (performanceMetrics.performanceScore > 1.05) {
    performanceAdjustment = 'Strong past performance → pushing harder. ' + performanceAdjustment;
  } else if (performanceMetrics.performanceScore < 0.95) {
    performanceAdjustment = 'Past session was challenging → backing off. ' + performanceAdjustment;
  }
  if (performanceMetrics.weightDropDetected) {
    performanceAdjustment += ' Weight drop detected last session.';
  }
  if (performanceMetrics.extraSetsDetected) {
    performanceAdjustment += ' Extra sets completed last session.';
  }

  return {
    score,
    breakdown: {
      totalLoad,
      lastLoad,
      overloadRatio,
      e1RM,
      lastE1RM,
      intensityRatio,
      targetRatio,
      rawScore,
      intensityBias,
      performanceAdjustment,
    },
  };
}

/**
 * Legacy-compatible scoring function (returns just the numeric score).
 * Used by tests that only need the score value.
 */
export function scoreCandidate(
  candidate: Candidate,
  input: ProgressionInput,
  performanceMetrics: PerformanceMetrics
): number {
  return scoreCandidateDetailed(candidate, input, performanceMetrics).score;
}

// ─── Workout Generation ────────────────────────────────────────────────────────

/**
 * Generate the optimal next workout plan.
 *
 * Pipeline:
 * 1. Analyze performance from last session
 * 2. Compute history trend (if history available)
 * 3. Build a scoring context (target progress, strength/volume emphasis, jump cap)
 * 4. Generate all valid candidates (weight/rep/set combinations)
 * 5. Score each candidate against the target
 * 6. Select the highest-scoring candidate
 * 7. Build a rich reasoning string explaining the decision
 */
export function generateNextWorkout(input: ProgressionInput): WorkoutPlan {
  const emptyBreakdown: ScoringBreakdown = {
    totalLoad: 0, lastLoad: 0, overloadRatio: 1,
    e1RM: 0, lastE1RM: 0, intensityRatio: 1,
    rawScore: 0, intensityBias: 0,
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

  // Step 1–3
  const perf = analyzePerformance(input.lastSession);
  const historyTrend = computeHistoryTrend(input.history);
  const context = buildScoringContext(input, perf, historyTrend);

  // Step 4: Generate candidates
  const candidates = generateCandidates(input.lastSession, input.constraints, input.equipment);

  // Step 5 & 6: Score and select best. Ties go to the lighter/less-volume
  // option because candidates are generated in ascending order.
  let bestCandidate: Candidate | null = null;
  let bestScore = -Infinity;
  let bestBreakdown: ScoringBreakdown = emptyBreakdown;

  for (const c of candidates) {
    const { score, breakdown } = scoreCandidateDetailed(c, input, perf, context);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
      bestBreakdown = breakdown;
    }
  }

  // Fallback: if no candidate is viable, repeat last session
  if (!bestCandidate || bestScore <= -1000) {
    const completedSets = getCompletedSets(input.lastSession);
    const refSet = getReferenceSet(completedSets);
    return {
      suggestedWeight: refSet?.actualWeight || 0,
      suggestedReps: refSet?.actualReps || 10,
      suggestedSets: completedSets.length || 3,
      reasoning: 'No valid candidates found within constraints. Repeating previous session.',
      scoringBreakdown: emptyBreakdown,
      candidatesEvaluated: candidates.length,
      performanceMetrics: perf,
    };
  }

  // Step 7: Build rich reasoning
  const reasoning = buildReasoning(bestCandidate, input, perf, bestBreakdown, historyTrend);

  return {
    suggestedWeight: bestCandidate.weight,
    suggestedReps: bestCandidate.reps,
    suggestedSets: bestCandidate.sets,
    reasoning,
    scoringBreakdown: bestBreakdown,
    candidatesEvaluated: candidates.length,
    performanceMetrics: perf,
  };
}

// ─── Reasoning Builder ─────────────────────────────────────────────────────────

/**
 * Build a human-readable reasoning string from the scoring breakdown.
 */
function buildReasoning(
  candidate: Candidate,
  input: ProgressionInput,
  perf: PerformanceMetrics,
  breakdown: ScoringBreakdown,
  historyTrend: number,
): string {
  const parts: string[] = [];

  const completedSets = getCompletedSets(input.lastSession);
  const refSet = getReferenceSet(completedSets);
  if (!refSet) return 'Adapted based on available data.';

  // Weight change description
  const weightDelta = Number((candidate.weight - refSet.actualWeight).toFixed(2));
  if (weightDelta > 0) {
    parts.push(`↑ Weight +${weightDelta} lbs`);
  } else if (weightDelta < 0) {
    parts.push(`↓ Weight ${weightDelta} lbs`);
  } else {
    parts.push('→ Weight maintained');
  }

  // Rep change description
  const repDelta = candidate.reps - refSet.actualReps;
  if (repDelta > 0) {
    parts.push(`↑ Reps +${repDelta}`);
  } else if (repDelta < 0) {
    parts.push(`↓ Reps ${repDelta}`);
  }

  // Set change description
  const setDelta = candidate.sets - completedSets.length;
  if (setDelta > 0) {
    parts.push(`↑ Sets +${setDelta}`);
  } else if (setDelta < 0) {
    parts.push(`↓ Sets ${setDelta}`);
  }

  // Performance context
  if (perf.performanceScore > 1.05) {
    parts.push('• Strong past performance');
  } else if (perf.performanceScore < 0.95) {
    parts.push('• Adjusted for past difficulty');
  }

  if (typeof perf.lastSetRir === 'number') {
    if (perf.lastSetRir <= 1) {
      parts.push('• Last set near failure');
    } else if (perf.lastSetRir >= 3) {
      parts.push('• RIR suggests more headroom');
    } else {
      parts.push('• RIR landed on target');
    }
  }

  // History trend context
  if (historyTrend > 1.05) {
    parts.push('• Consistent improvement trend');
  } else if (historyTrend < 0.95) {
    parts.push('• Recent struggle detected');
  }

  // Overload summary
  const overloadPct = ((breakdown.overloadRatio - 1) * 100).toFixed(1);
  parts.push(`(${Number(overloadPct) >= 0 ? '+' : ''}${overloadPct}% load)`);

  return parts.join(' ');
}
