import { calcAverage1RM } from './analytics';

// ─── Core Data Types ───────────────────────────────────────────────────────────

export type SetLog = {
  plannedReps: number;
  actualReps: number;
  plannedWeight: number;
  actualWeight: number;
  completed: boolean;
};

export type Session = {
  liftId: string;
  sets: SetLog[];
  timestamp: string;
};

export type PerformanceMetrics = {
  completionRatio: number;
  intensityDeviation: number;
  setDelta: number;
  fatigueSlope: number;
  performanceScore: number;
  weightDropDetected: boolean;   // true if user dropped weight mid-session
  extraSetsDetected: boolean;    // true if user added sets beyond planned
};

export type ScoringBreakdown = {
  totalLoad: number;        // candidate's total load (weight × reps × sets)
  lastLoad: number;         // previous session's total load
  overloadRatio: number;    // totalLoad / lastLoad
  e1RM: number;             // candidate's estimated 1RM
  lastE1RM: number;         // previous session's estimated 1RM
  intensityRatio: number;   // e1RM / lastE1RM
  rawScore: number;         // numeric score before intensity bias
  intensityBias: number;    // score contribution from intensity preference
  performanceAdjustment: string;  // human-readable explanation
};

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

/** Average seconds per set including rest (heuristic for time-limit filtering) */
const AVG_SET_TIME_SECONDS = 90;

/** Base percentage increase target per session */
const BASE_INCREASE = 0.05;

/** Maximum allowed weight jump as fraction of current weight */
const BASE_JUMP_FRACTION = 0.15;

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
  const completedSets = session.sets.filter(s => s.completed);

  // Edge case: no completed sets
  if (completedSets.length === 0) {
    return {
      completionRatio: 0,
      intensityDeviation: 1,
      setDelta: -session.sets.length,
      fatigueSlope: 0,
      performanceScore: 0.8,
      weightDropDetected: false,
      extraSetsDetected: false,
    };
  }

  // ── Completion Ratio ──
  const totalPlannedReps = session.sets.reduce((sum, s) => sum + s.plannedReps, 0);
  const totalActualReps = completedSets.reduce((sum, s) => sum + s.actualReps, 0);
  const completionRatio = totalPlannedReps > 0 ? totalActualReps / totalPlannedReps : 1;

  // ── Intensity Deviation ──
  const avgPlannedWeight = completedSets.reduce((sum, s) => sum + s.plannedWeight, 0) / completedSets.length;
  const avgActualWeight = completedSets.reduce((sum, s) => sum + s.actualWeight, 0) / completedSets.length;
  const intensityDeviation = avgPlannedWeight > 0 ? avgActualWeight / avgPlannedWeight : 1;

  // ── Set Delta ──
  // Positive = user did extra sets, negative = user skipped sets
  const plannedSetCount = session.sets.length;
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
  const weightDropDetected = completedSets.some(s => s.actualWeight < s.plannedWeight);
  const extraSetsDetected = setDelta > 0;

  // ── Performance Score ──
  // Base: weighted combination of completion and intensity
  let performanceScore = (completionRatio * 0.5) + (intensityDeviation * 0.5);

  // Reward extra sets (user felt strong)
  if (extraSetsDetected) {
    performanceScore += setDelta * 0.05;
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

  return {
    completionRatio,
    intensityDeviation,
    setDelta,
    fatigueSlope,
    performanceScore,
    weightDropDetected,
    extraSetsDetected,
  };
}

// ─── History Trend Analysis ────────────────────────────────────────────────────

/**
 * Compute a rolling performance trend from recent history.
 * Returns a multiplier: >1.0 means recent sessions trended strong, <1.0 means struggled.
 * Used to bias the effective intensity up or down.
 */
function computeHistoryTrend(history: Session[]): number {
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
  if (consecutiveOver >= 3) return Math.min(1.15, avgScore);
  if (consecutiveUnder >= 3) return Math.max(0.85, avgScore);

  return Math.max(0.9, Math.min(1.1, avgScore));
}

// ─── Candidate Generation ──────────────────────────────────────────────────────

/**
 * Generate nearby workout candidates by varying weight, reps, and sets.
 *
 * Weight: ±2 discrete steps on the equipment weight ladder
 * Reps: ±2 from base
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
  const completedSets = lastSession.sets.filter(s => s.completed);
  if (completedSets.length === 0) return [];

  // Use the last completed set as the reference point for the user's top effort
  const lastSet = completedSets[completedSets.length - 1];
  const baseWeight = lastSet.actualWeight;
  const baseReps = lastSet.actualReps;
  const baseSets = Math.min(Math.max(completedSets.length, constraints.minSets), constraints.maxSets);

  // Get the sorted list of valid weights for this lift's equipment
  const possibleWeights = equipment.getValidWeights(lastSession.liftId);
  if (possibleWeights.length === 0) return [];

  // Find current position in the weight ladder
  const currentWeightIdx = possibleWeights.findIndex(w => w >= baseWeight);
  const safeIdx = currentWeightIdx === -1 ? possibleWeights.length - 1 : currentWeightIdx;

  // Generate weight candidates: ±2 steps on the ladder
  const weightIndices = [
    Math.max(0, safeIdx - 2),
    Math.max(0, safeIdx - 1),
    safeIdx,
    Math.min(possibleWeights.length - 1, safeIdx + 1),
    Math.min(possibleWeights.length - 1, safeIdx + 2),
  ];
  const uniqueWeights = Array.from(new Set(weightIndices.map(idx => possibleWeights[idx])));

  // Time limit in seconds (if specified)
  const timeLimitSecs = constraints.timeLimit ? constraints.timeLimit * 60 : Infinity;

  const candidates: Candidate[] = [];

  for (const w of uniqueWeights) {
    if (w === undefined) continue;
    for (let rOffset = -2; rOffset <= 2; rOffset++) {
      const r = baseReps + rOffset;
      if (r < constraints.minReps || r > constraints.maxReps) continue;

      for (let sOffset = -1; sOffset <= 1; sOffset++) {
        const s = baseSets + sOffset;
        if (s < constraints.minSets || s > constraints.maxSets) continue;

        // Time limit filter: reject if estimated time exceeds limit
        if (s * AVG_SET_TIME_SECONDS > timeLimitSecs) continue;

        candidates.push({ weight: w, reps: r, sets: s });
      }
    }
  }

  return candidates;
}

// ─── Candidate Scoring ─────────────────────────────────────────────────────────

/**
 * Score a workout candidate with a full breakdown of contributing factors.
 *
 * Scoring considers:
 * 1. How close the candidate's overload ratio is to the target
 * 2. Intensity bias (high intensity favors weight, low intensity favors volume)
 * 3. Fatigue awareness (steep fatigue → reward fewer sets)
 * 4. Rep scheme continuity (reward staying at current reps if performance was appropriate)
 * 5. Allowed jump limits (penalize unrealistic weight increases)
 */
export function scoreCandidateDetailed(
  candidate: Candidate,
  input: ProgressionInput,
  performanceMetrics: PerformanceMetrics,
  historyTrend: number
): { score: number; breakdown: ScoringBreakdown } {
  const completedSets = input.lastSession.sets.filter(s => s.completed);
  if (completedSets.length === 0) {
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

  const lastSet = completedSets[completedSets.length - 1];

  // ── Load & 1RM calculations ──
  const lastLoad = lastSet.actualWeight * lastSet.actualReps * completedSets.length;
  const totalLoad = candidate.weight * candidate.reps * candidate.sets;
  const lastE1RM = calcAverage1RM(lastSet.actualWeight, lastSet.actualReps);
  const e1RM = calcAverage1RM(candidate.weight, candidate.reps);

  const overloadRatio = lastLoad > 0 ? totalLoad / lastLoad : 1;
  const intensityRatio = lastE1RM > 0 ? e1RM / lastE1RM : 1;

  // ── Target overload ──
  // Scale by intensity, performance score, AND history trend
  const effectiveIntensity = input.intensity * historyTrend;
  const targetOverload = BASE_INCREASE * effectiveIntensity * performanceMetrics.performanceScore;
  const targetOverloadRatio = 1 + targetOverload;

  // ── Allowed jump enforcement ──
  const allowedJump = lastSet.actualWeight * BASE_JUMP_FRACTION * (0.75 + input.intensity);
  if ((candidate.weight - lastSet.actualWeight) > allowedJump) {
    return {
      score: -1000,
      breakdown: {
        totalLoad, lastLoad, overloadRatio, e1RM, lastE1RM, intensityRatio,
        rawScore: -1000, intensityBias: 0,
        performanceAdjustment: `Weight jump of ${candidate.weight - lastSet.actualWeight} lbs exceeds allowed ${Math.round(allowedJump)} lbs.`,
      },
    };
  }

  // ── Intensity bias scoring ──
  let intensityBias = 0;
  let biasExplanation = '';

  if (input.intensity >= 1.2) {
    // High intensity: favor weight increases, allow rep drops
    intensityBias = (candidate.weight > lastSet.actualWeight) ? 10 : 0;
    if (candidate.reps < lastSet.actualReps) intensityBias += 5;
    biasExplanation = 'High intensity: favoring weight over volume.';
  } else if (input.intensity <= 0.8) {
    // Low intensity: favor reps/sets, avoid weight jumps
    intensityBias = (candidate.reps > lastSet.actualReps || candidate.sets > completedSets.length) ? 10 : 0;
    if (candidate.weight > lastSet.actualWeight) intensityBias -= 15;
    biasExplanation = 'Low intensity: favoring volume, limiting weight.';
  } else {
    // Neutral: balanced scoring
    intensityBias = ((intensityRatio + overloadRatio) / 2) * 5;
    biasExplanation = 'Balanced progression targeting moderate overload.';
  }

  // ── Fatigue-aware set adjustment ──
  // If user showed steep fatigue (reps dropped significantly across sets),
  // reward candidates that reduce sets to prevent overtraining
  if (performanceMetrics.fatigueSlope < -0.5 && candidate.sets < completedSets.length) {
    intensityBias += 5;
    biasExplanation += ' Fatigue detected: fewer sets preferred.';
  }

  // ── Core score: closeness to target overload ──
  const ratioUsed = (input.intensity >= 1.2) ? intensityRatio : overloadRatio;
  const diffFromTarget = Math.abs(ratioUsed - targetOverloadRatio);
  let rawScore = 100 - (diffFromTarget * 100);

  // ── Rep scheme continuity bonus ──
  // If performance was appropriate (0.95–1.05), reward staying at current reps
  // unless high intensity mode where rep drops are acceptable
  if (performanceMetrics.performanceScore >= 0.95 &&
      performanceMetrics.performanceScore <= 1.05 &&
      input.intensity < 1.2) {
    if (candidate.reps === lastSet.actualReps) rawScore += 5;
  }

  const score = rawScore + intensityBias;

  // ── Build performance adjustment explanation ──
  let performanceAdjustment = biasExplanation;
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
  return scoreCandidateDetailed(candidate, input, performanceMetrics, 1.0).score;
}

// ─── Workout Generation ────────────────────────────────────────────────────────

/**
 * Generate the optimal next workout plan.
 *
 * Pipeline:
 * 1. Analyze performance from last session
 * 2. Compute history trend (if history available)
 * 3. Calculate effective intensity (user intensity × performance × trend)
 * 4. Generate all valid candidates (weight/rep/set combinations)
 * 5. Score each candidate against the target overload profile
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

  // Step 1: Analyze last session
  const perf = analyzePerformance(input.lastSession);

  // Step 2: Compute history trend
  const historyTrend = computeHistoryTrend(input.history);

  // Step 3: Effective intensity = user setting × clamped performance × trend
  const clampedPerf = Math.max(0.9, Math.min(1.1, perf.performanceScore));
  const effectiveIntensity = Math.max(0.5, Math.min(1.5, input.intensity * clampedPerf * historyTrend));

  // Step 4: Generate candidates
  const candidates = generateCandidates(input.lastSession, input.constraints, input.equipment);

  // Step 5 & 6: Score and select best
  let bestCandidate: Candidate | null = null;
  let bestScore = -Infinity;
  let bestBreakdown: ScoringBreakdown = emptyBreakdown;

  const adjustedInput = { ...input, intensity: effectiveIntensity };

  for (const c of candidates) {
    const { score, breakdown } = scoreCandidateDetailed(c, adjustedInput, perf, historyTrend);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
      bestBreakdown = breakdown;
    }
  }

  // Fallback: if no candidate scored well, repeat last session
  if (!bestCandidate) {
    const completedSets = input.lastSession.sets.filter(s => s.completed);
    const lastSet = completedSets[completedSets.length - 1];
    return {
      suggestedWeight: lastSet?.actualWeight || 0,
      suggestedReps: lastSet?.actualReps || 10,
      suggestedSets: completedSets.length || 3,
      reasoning: 'No valid candidates found within constraints. Repeating previous session.',
      scoringBreakdown: emptyBreakdown,
      candidatesEvaluated: candidates.length,
      performanceMetrics: perf,
    };
  }

  // Step 7: Build rich reasoning
  const reasoning = buildReasoning(bestCandidate, input, perf, bestBreakdown, historyTrend, candidates.length);

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
  candidateCount: number
): string {
  const parts: string[] = [];

  const completedSets = input.lastSession.sets.filter(s => s.completed);
  const lastSet = completedSets[completedSets.length - 1];
  if (!lastSet) return 'Adapted based on available data.';

  // Weight change description
  const weightDelta = candidate.weight - lastSet.actualWeight;
  if (weightDelta > 0) {
    parts.push(`↑ Weight +${weightDelta} lbs`);
  } else if (weightDelta < 0) {
    parts.push(`↓ Weight ${weightDelta} lbs`);
  } else {
    parts.push('→ Weight maintained');
  }

  // Rep change description
  const repDelta = candidate.reps - lastSet.actualReps;
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
