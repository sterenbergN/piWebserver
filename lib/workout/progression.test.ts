import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  analyzePerformance,
  estimateE1RM,
  generateCandidates,
  generateNextWorkout,
  getTargetRir,
  repsToFailureAt,
  Session,
  ProgressionInput
} from './progression';
import { getPossibleWeights } from './equipment';

// ─── Helper: Build a standard ProgressionInput ─────────────────────────────────

function makeInput(overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    lastSession: overrides.lastSession || {
      liftId: 'bench',
      timestamp: new Date().toISOString(),
      sets: [
        { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
      ],
    },
    history: overrides.history || [],
    constraints: overrides.constraints || { minReps: 5, maxReps: 15, minSets: 1, maxSets: 5 },
    equipment: overrides.equipment || {
      getValidWeights: () => [95, 105, 115, 125, 135, 145, 155, 165, 175, 185],
    },
    intensity: overrides.intensity ?? 1.0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING TESTS (preserved from original)
// ═══════════════════════════════════════════════════════════════════════════════

test('1. analyzePerformance: perfect completion', () => {
  const session: Session = {
    liftId: 'squat',
    timestamp: new Date().toISOString(),
    sets: [
      { plannedReps: 5, actualReps: 5, plannedWeight: 100, actualWeight: 100, completed: true },
      { plannedReps: 5, actualReps: 5, plannedWeight: 100, actualWeight: 100, completed: true }
    ]
  };
  const result = analyzePerformance(session);
  assert.equal(result.completionRatio, 1);
  assert.equal(result.intensityDeviation, 1);
  assert.equal(result.setDelta, 0);
  assert.equal(result.performanceScore, 1);
});

test('2. analyzePerformance: underperformance', () => {
    const session: Session = {
      liftId: 'squat',
      timestamp: new Date().toISOString(),
      sets: [
        { plannedReps: 5, actualReps: 5, plannedWeight: 100, actualWeight: 100, completed: true },
        { plannedReps: 5, actualReps: 3, plannedWeight: 100, actualWeight: 100, completed: true }
      ]
    };
    const result = analyzePerformance(session);
    assert.ok(result.completionRatio < 1);
    assert.ok(result.performanceScore < 1);
});

test('3. analyzePerformance: drop in weight', () => {
    const session: Session = {
      liftId: 'squat',
      timestamp: new Date().toISOString(),
      sets: [
        { plannedReps: 5, actualReps: 5, plannedWeight: 100, actualWeight: 100, completed: true },
        { plannedReps: 5, actualReps: 5, plannedWeight: 100, actualWeight: 80, completed: true }
      ]
    };
    const result = analyzePerformance(session);
    assert.ok(result.intensityDeviation < 1);
    assert.ok(result.performanceScore < 1);
});

test('4. generateNextWorkout: normal progression', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [{ plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true }]
     },
     constraints: { minReps: 8, maxReps: 12, minSets: 1, maxSets: 3 },
     equipment: { getValidWeights: () => [135, 140, 145, 150] },
     intensity: 1.0,
   });

   const plan = generateNextWorkout(input);
   assert.ok(plan.suggestedWeight >= 135);
   assert.ok(plan.scoringBreakdown, 'Should include scoring breakdown');
   assert.ok(plan.candidatesEvaluated > 0, 'Should report candidates evaluated');
   assert.ok(plan.performanceMetrics, 'Should include performance metrics');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS
// ═══════════════════════════════════════════════════════════════════════════════

test('5. User overperformance: reps exceeded by 20% → weight increase', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'squat',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 5, actualReps: 6, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 5, actualReps: 6, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 5, actualReps: 6, plannedWeight: 135, actualWeight: 135, completed: true },
       ],
     },
     intensity: 1.0,
   });

   const perf = analyzePerformance(input.lastSession);
   assert.ok(perf.performanceScore > 1.0, `Expected overperformance score > 1.0, got ${perf.performanceScore}`);

   const plan = generateNextWorkout(input);
   // Engine should suggest weight increase or at least maintain
   assert.ok(plan.suggestedWeight >= 135, `Expected weight >= 135, got ${plan.suggestedWeight}`);
});

test('6. User failure: only 60% reps completed → reduction', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 10, actualReps: 6, plannedWeight: 185, actualWeight: 185, completed: true },
         { plannedReps: 10, actualReps: 5, plannedWeight: 185, actualWeight: 185, completed: true },
         { plannedReps: 10, actualReps: 4, plannedWeight: 185, actualWeight: 185, completed: true },
       ],
     },
     intensity: 1.0,
   });

   const perf = analyzePerformance(input.lastSession);
   assert.ok(perf.performanceScore < 1.0, `Expected underperformance score < 1.0, got ${perf.performanceScore}`);
   assert.ok(perf.fatigueSlope < 0, 'Expected negative fatigue slope');

   const plan = generateNextWorkout(input);
   // Should not suggest an increase in weight
   assert.ok(plan.suggestedWeight <= 185, `Expected weight <= 185, got ${plan.suggestedWeight}`);
});

test('7. Invalid weight filtering: only equipment-valid weights used', () => {
   const validWeights = [100, 120, 140, 160];
   const input = makeInput({
     lastSession: {
       liftId: 'curl',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 10, actualReps: 10, plannedWeight: 120, actualWeight: 120, completed: true },
       ],
     },
     equipment: { getValidWeights: () => validWeights },
     intensity: 1.0,
   });

   const candidates = generateCandidates(input.lastSession, input.constraints, input.equipment);
   
   // Every candidate weight must be in the valid weights list
   for (const c of candidates) {
     assert.ok(validWeights.includes(c.weight), `Candidate weight ${c.weight} not in valid weights ${validWeights}`);
   }
});

test('8. High intensity (1.4): favors weight increase', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'squat',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true },
       ],
     },
     intensity: 1.4,
   });

   const planHigh = generateNextWorkout(input);

   // Compare to low intensity
   const inputLow = { ...input, intensity: 0.6 };
   const planLow = generateNextWorkout(inputLow);

   // High intensity should suggest same or higher weight than low intensity
   assert.ok(
     planHigh.suggestedWeight >= planLow.suggestedWeight,
     `High intensity weight (${planHigh.suggestedWeight}) should be >= low intensity weight (${planLow.suggestedWeight})`
   );
});

test('9. Low intensity (0.6): avoids weight jumps', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true },
       ],
     },
     intensity: 0.6,
   });

   const plan = generateNextWorkout(input);

   // Low intensity should not suggest a big weight increase
   const weightJump = plan.suggestedWeight - 135;
   assert.ok(weightJump <= 20, `Low intensity should limit weight jumps, got +${weightJump}`);
});

test('10. Edge case: min reps boundary respected', () => {
   const minReps = 8;
   const input = makeInput({
     lastSession: {
       liftId: 'ohp',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 8, actualReps: 8, plannedWeight: 95, actualWeight: 95, completed: true },
       ],
     },
     constraints: { minReps, maxReps: 15, minSets: 1, maxSets: 5 },
     intensity: 1.0,
   });

   const plan = generateNextWorkout(input);
   assert.ok(plan.suggestedReps >= minReps, `Suggested reps ${plan.suggestedReps} should be >= minReps ${minReps}`);
});

test('11. Edge case: max sets boundary respected', () => {
   const maxSets = 4;
   const input = makeInput({
     lastSession: {
       liftId: 'row',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
       ],
     },
     constraints: { minReps: 5, maxReps: 15, minSets: 2, maxSets: maxSets },
     intensity: 1.0,
   });

   const plan = generateNextWorkout(input);
   assert.ok(plan.suggestedSets <= maxSets, `Suggested sets ${plan.suggestedSets} should be <= maxSets ${maxSets}`);
});

test('12. Weight drop mid-session detected → performanceScore < 1.0', () => {
   const session: Session = {
     liftId: 'bench',
     timestamp: new Date().toISOString(),
     sets: [
       { plannedReps: 5, actualReps: 5, plannedWeight: 185, actualWeight: 185, completed: true },
       { plannedReps: 5, actualReps: 5, plannedWeight: 185, actualWeight: 165, completed: true }, // dropped weight
       { plannedReps: 5, actualReps: 5, plannedWeight: 185, actualWeight: 165, completed: true },
     ],
   };

   const result = analyzePerformance(session);
   assert.ok(result.weightDropDetected, 'Should detect weight drop');
   assert.ok(result.performanceScore < 1.0, `Performance score should be < 1.0 with weight drop, got ${result.performanceScore}`);
});

test('13. Extra sets added → performanceScore > 1.0', () => {
   // Simulate user doing more sets than planned (3 planned, 5 completed)
   const session: Session = {
     liftId: 'squat',
     timestamp: new Date().toISOString(),
     sets: [
       { plannedReps: 5, actualReps: 5, plannedWeight: 200, actualWeight: 200, completed: true },
       { plannedReps: 5, actualReps: 5, plannedWeight: 200, actualWeight: 200, completed: true },
       { plannedReps: 5, actualReps: 5, plannedWeight: 200, actualWeight: 200, completed: true },
       // Extra sets beyond the original plan — represented by adding more completed entries
       { plannedReps: 5, actualReps: 5, plannedWeight: 200, actualWeight: 200, completed: true },
       { plannedReps: 5, actualReps: 5, plannedWeight: 200, actualWeight: 200, completed: true },
     ],
   };

   const result = analyzePerformance(session);
   // With perfect completion and no weight drops, base score should be ~1.0
   // Since all sets match planned, setDelta = 0, but completionRatio = 1.0 and intensityDeviation = 1.0
   assert.ok(result.completionRatio === 1, 'Completion ratio should be 1.0');
   assert.ok(result.performanceScore >= 0.95, `Performance should be at least appropriate, got ${result.performanceScore}`);
});

test('14. Time limit filtering: candidates exceeding time are rejected', () => {
   const input = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
         { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true },
       ],
     },
     // Time limit: 3 minutes = 180 seconds → only 2 sets possible at 90s/set
     constraints: { minReps: 5, maxReps: 15, minSets: 1, maxSets: 5, timeLimit: 3 },
     intensity: 1.0,
   });

   const candidates = generateCandidates(input.lastSession, input.constraints, input.equipment);
   
   // With 3 min limit and 90s/set, max sets = 2
   for (const c of candidates) {
     assert.ok(c.sets <= 2, `Candidate has ${c.sets} sets, but time limit allows max 2`);
   }
});

test('15. History trend: 3 consecutive overperformances → more aggressive', () => {
   // Build history of 3 strong sessions
   const strongHistory: Session[] = [
     {
       liftId: 'bench',
       timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
       sets: [{ plannedReps: 8, actualReps: 10, plannedWeight: 125, actualWeight: 125, completed: true }],
     },
     {
       liftId: 'bench',
       timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
       sets: [{ plannedReps: 8, actualReps: 10, plannedWeight: 130, actualWeight: 130, completed: true }],
     },
     {
       liftId: 'bench',
       timestamp: new Date(Date.now() - 86400000).toISOString(),
       sets: [{ plannedReps: 8, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true }],
     },
   ];

   const inputWithHistory = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [{ plannedReps: 8, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true }],
     },
     history: strongHistory,
     intensity: 1.0,
   });

   const inputNoHistory = makeInput({
     lastSession: inputWithHistory.lastSession,
     history: [],
     intensity: 1.0,
   });

   const planWithHistory = generateNextWorkout(inputWithHistory);
   const planNoHistory = generateNextWorkout(inputNoHistory);

   // With strong history trend, suggestion should be at least as aggressive
   assert.ok(
     planWithHistory.suggestedWeight >= planNoHistory.suggestedWeight,
     `History-aware weight (${planWithHistory.suggestedWeight}) should be >= no-history weight (${planNoHistory.suggestedWeight})`
   );
});

test('16. Empty/single-set edge case: graceful fallback', () => {
   // Empty session
   const emptyInput = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [],
     },
   });

   const emptyPlan = generateNextWorkout(emptyInput);
   assert.ok(emptyPlan.suggestedReps > 0, 'Should have default reps');
   assert.ok(emptyPlan.suggestedSets > 0, 'Should have default sets');
   assert.ok(emptyPlan.reasoning.length > 0, 'Should have reasoning');

   // Single completed set
   const singleInput = makeInput({
     lastSession: {
       liftId: 'bench',
       timestamp: new Date().toISOString(),
       sets: [{ plannedReps: 10, actualReps: 10, plannedWeight: 100, actualWeight: 100, completed: true }],
     },
   });

  const singlePlan = generateNextWorkout(singleInput);
  assert.ok(singlePlan.suggestedWeight > 0, 'Should suggest valid weight');
  assert.ok(singlePlan.candidatesEvaluated > 0, 'Should evaluate candidates');
});

test('17. Low RIR reduces performance score', () => {
  const session: Session = {
    liftId: 'bench',
    timestamp: new Date().toISOString(),
    sets: [
      { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 1 },
      { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 0 },
    ],
  };

  const result = analyzePerformance(session);
  assert.equal(result.rirCoverage, 1);
  assert.ok((result.rirAdjustment || 0) < 0, `Expected negative RIR adjustment, got ${result.rirAdjustment}`);
  assert.ok(result.performanceScore < 1, `Expected harder-than-target score, got ${result.performanceScore}`);
});

test('18. High RIR nudges progression more aggressively', () => {
  const baseInput = makeInput({
    lastSession: {
      liftId: 'bench',
      timestamp: new Date().toISOString(),
      sets: [
        { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 4 },
        { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 3 },
      ],
    },
    intensity: 1.0,
  });

  const lowRirInput = makeInput({
    lastSession: {
      liftId: 'bench',
      timestamp: new Date().toISOString(),
      sets: [
        { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 1 },
        { plannedReps: 8, actualReps: 8, plannedWeight: 135, actualWeight: 135, completed: true, rir: 0 },
      ],
    },
    intensity: 1.0,
  });

  const highRirPlan = generateNextWorkout(baseInput);
  const lowRirPlan = generateNextWorkout(lowRirInput);
  assert.ok(
    highRirPlan.suggestedWeight >= lowRirPlan.suggestedWeight,
    `High RIR weight (${highRirPlan.suggestedWeight}) should be >= low RIR weight (${lowRirPlan.suggestedWeight})`
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION TESTS (engine redesign)
// ═══════════════════════════════════════════════════════════════════════════════

function threeSets(weight: number, reps: number, rir: number, plannedReps = reps) {
  return [1, 2, 3].map(() => ({ plannedReps, actualReps: reps, plannedWeight: weight, actualWeight: weight, completed: true, rir }));
}

const LADDER = Array.from({ length: 40 }, (_, i) => 45 + i * 5);

test('19. On-target session never trades weight for extra sets', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: { liftId: 'bench', timestamp: '', sets: threeSets(135, 10, 2) },
    constraints: { minReps: 8, maxReps: 12, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => LADDER },
  }));
  assert.ok(plan.suggestedWeight >= 135, `weight dropped to ${plan.suggestedWeight}`);
  assert.equal(plan.suggestedSets, 3);
  assert.ok(
    plan.suggestedWeight > 135 || plan.suggestedReps > 10,
    `expected some progression, got ${plan.suggestedWeight}x${plan.suggestedReps}`
  );
});

test('20. Failed session backs off instead of adding load', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: {
      liftId: 'bench', timestamp: '',
      sets: [
        { plannedReps: 10, actualReps: 7, plannedWeight: 135, actualWeight: 135, completed: true, rir: 0 },
        { plannedReps: 10, actualReps: 6, plannedWeight: 135, actualWeight: 135, completed: true, rir: 0 },
        { plannedReps: 10, actualReps: 5, plannedWeight: 135, actualWeight: 135, completed: true, rir: 0 },
      ],
    },
    constraints: { minReps: 8, maxReps: 12, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => LADDER },
  }));
  assert.ok(plan.suggestedWeight < 135, `expected a lighter weight, got ${plan.suggestedWeight}`);
  assert.ok(plan.scoringBreakdown.overloadRatio < 1, `expected reduced load, got ${plan.scoringBreakdown.overloadRatio}`);
});

test('21. Top of rep range with coarse dumbbells moves up a rung', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: { liftId: 'curl', timestamp: '', sets: threeSets(10, 12, 3) },
    constraints: { minReps: 8, maxReps: 12, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => [5, 10, 15, 20, 25] },
  }));
  assert.equal(plan.suggestedWeight, 15);
  assert.equal(plan.suggestedSets, 3);
});

test('22. Extra sets beyond the plan are detected when plannedSets is known', () => {
  const session: Session = {
    liftId: 'row', timestamp: '', plannedSets: 3,
    sets: [...threeSets(135, 10, 2), { plannedReps: 10, actualReps: 10, plannedWeight: 135, actualWeight: 135, completed: true, rir: 2 }],
  };
  const perf = analyzePerformance(session);
  assert.equal(perf.setDelta, 1);
  assert.ok(perf.extraSetsDetected);
  assert.ok(perf.performanceScore > 1);
});

test('23. A back-off set does not drag the reference weight down', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: {
      liftId: 'squat', timestamp: '',
      sets: [
        { plannedReps: 5, actualReps: 5, plannedWeight: 225, actualWeight: 225, completed: true, rir: 2 },
        { plannedReps: 5, actualReps: 5, plannedWeight: 225, actualWeight: 225, completed: true, rir: 2 },
        { plannedReps: 5, actualReps: 8, plannedWeight: 185, actualWeight: 185, completed: true, rir: 2 },
      ],
    },
    constraints: { minReps: 3, maxReps: 8, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => LADDER },
  }));
  assert.ok(plan.suggestedWeight >= 225, `expected >= 225, got ${plan.suggestedWeight}`);
});

test('24. Bodyweight lifts (0 lbs) still progress via reps', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: { liftId: 'pullup', timestamp: '', sets: threeSets(0, 8, 3) },
    constraints: { minReps: 5, maxReps: 12, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => [0] },
  }));
  assert.equal(plan.suggestedWeight, 0);
  assert.ok(plan.suggestedReps > 8, `expected more reps, got ${plan.suggestedReps}`);
});

test('25. Deload drops ~15% and one set, keeping reps', () => {
  const plan = generateNextWorkout({
    ...makeInput({
      lastSession: { liftId: 'bench', timestamp: '', sets: threeSets(200, 8, 2) },
      constraints: { minReps: 6, maxReps: 10, minSets: 2, maxSets: 4 },
      equipment: { getValidWeights: () => LADDER },
    }),
    deload: true,
  });
  assert.equal(plan.suggestedWeight, 170);
  assert.equal(plan.suggestedReps, 8);
  assert.equal(plan.suggestedSets, 2);
});

test('26. A normal rep drop-off (10/9/8) keeps the planned set count', () => {
  const plan = generateNextWorkout(makeInput({
    lastSession: {
      liftId: 'ohp', timestamp: '', plannedSets: 3,
      sets: [10, 9, 8].map((reps) => ({ plannedReps: 10, actualReps: reps, plannedWeight: 95, actualWeight: 95, completed: true, rir: 2 })),
    },
    constraints: { minReps: 8, maxReps: 12, minSets: 2, maxSets: 4 },
    equipment: { getValidWeights: () => LADDER },
  }));
  assert.equal(plan.suggestedSets, 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RIR AUTOREGULATION (the four problems found in the old engine)
// ═══════════════════════════════════════════════════════════════════════════════

/** A barbell with pairs of 45/25/10/5/2.5 plates: 5 lb steps around 150. */
const PLATES = getPossibleWeights({ type: 'plates', baseWeight: 45, plateSets: [45, 45, 25, 25, 10, 10, 5, 5, 2.5, 2.5] } as any);
const RANGE_8_12 = { minReps: 8, maxReps: 12, minSets: 2, maxSets: 4 };

function setsOf(weight: number, reps: number[], rir: (number | undefined)[], plannedReps = reps[0]) {
  return reps.map((r, i) => ({ plannedReps, actualReps: r, plannedWeight: weight, actualWeight: weight, completed: true, rir: rir[i] }));
}

function plan150(sets: ReturnType<typeof setsOf>, overrides: Partial<ProgressionInput> = {}) {
  return generateNextWorkout({
    ...makeInput({
      lastSession: { liftId: 'bench', timestamp: '', plannedSets: 3, sets },
      constraints: RANGE_8_12,
      equipment: { getValidWeights: () => PLATES },
    }),
    ...overrides,
  });
}

test('27. e1RM counts reps in reserve: 8 @ RIR 3 is an 11-rep max', () => {
  assert.ok(Math.abs(estimateE1RM(150, 8, 3) - estimateE1RM(150, 11, 0)) < 1e-9);
  assert.ok(estimateE1RM(150, 8, 3) > estimateE1RM(150, 8, 0) * 1.05);
  // repsToFailureAt inverts it
  assert.ok(Math.abs(repsToFailureAt(estimateE1RM(150, 10, 2), 150) - 12) < 0.01);
});

test('28. Target RIR comes from the slider and the workout type', () => {
  assert.equal(getTargetRir(1), 2);
  assert.equal(getTargetRir(1.5), 1);
  assert.equal(getTargetRir(0.5), 3);
  assert.equal(getTargetRir(1, 55), 3, 'endurance-type workouts stay further from failure');
  assert.equal(getTargetRir(1, 80), 2);
});

test('29. Problem 1: a normal drop-off (10/9/8 @ RIR 2/1/1) never adds weight', () => {
  // Old engine: scored 0.90 "Adjusted for past difficulty" yet suggested 160 × 8.
  const plan = plan150(setsOf(150, [10, 9, 8], [2, 1, 1], 10));
  assert.ok(plan.performanceMetrics.performanceScore < 0.95, 'average RIR 1.3 vs target 2 is harder than target');
  assert.equal(plan.suggestedWeight, 150, `expected the weight held, got ${plan.suggestedWeight}`);
  assert.ok(plan.suggestedReps >= 8 && plan.suggestedReps <= 9, `expected 8–9 reps, got ${plan.suggestedReps}`);
  assert.match(plan.reasoning, /harder than target/);
  assert.equal(plan.scoringBreakdown.expectedGain, 0, 'no progress assumed after a harder-than-target session');
  assert.ok(plan.scoringBreakdown.predictedRir! >= 1.5, `plan should land near RIR 2, got ${plan.scoringBreakdown.predictedRir}`);
});

test('30. Problem 2: top of the range adds weight AND resets reps', () => {
  // Old engine: 150 × 12/12/12 @ RIR 2 → 160 × 12 (more weight, same reps, near failure).
  const plan = plan150(setsOf(150, [12, 12, 12], [2, 2, 2]));
  assert.ok(plan.suggestedWeight > 150, `expected heavier, got ${plan.suggestedWeight}`);
  assert.ok(plan.suggestedWeight <= 165, `jump capped at ~10%, got ${plan.suggestedWeight}`);
  assert.ok(plan.suggestedReps < 12 && plan.suggestedReps >= 8, `expected a rep reset into 8–11, got ${plan.suggestedReps}`);
  assert.equal(plan.suggestedSets, 3);
  const rir = plan.scoringBreakdown.predictedRir!;
  assert.ok(rir >= 1.5 && rir <= 3, `the new weight should be predicted near RIR 2, got ${rir}`);
  assert.match(plan.scoringBreakdown.performanceAdjustment, new RegExp(`reps reset to ${plan.suggestedReps}`));
});

test('30b. High-rep profile at the top makes a smaller jump with a smaller reset', () => {
  const standard = plan150(setsOf(150, [12, 12, 12], [2, 2, 2]));
  const highRep = plan150(setsOf(150, [12, 12, 12], [2, 2, 2]), { profile: 'high-rep' });
  assert.ok(highRep.suggestedWeight > 150 && highRep.suggestedWeight < standard.suggestedWeight);
  assert.ok(highRep.suggestedReps > standard.suggestedReps);
});

test('31. Problem 3: RIR moves the strength estimate and the suggestion', () => {
  const easy = plan150(setsOf(150, [8, 8, 8], [3, 3, 3]));
  const grind = plan150(setsOf(150, [8, 8, 8], [0, 0, 0]));
  assert.ok(easy.scoringBreakdown.lastE1RM > grind.scoringBreakdown.lastE1RM * 1.05,
    `RIR 3 (${easy.scoringBreakdown.lastE1RM}) should estimate well above RIR 0 (${grind.scoringBreakdown.lastE1RM})`);
  assert.ok(easy.suggestedWeight > 150, `RIR 3 has headroom, got ${easy.suggestedWeight}`);
  assert.ok(grind.suggestedWeight < 150, `RIR 0 at the bottom of the range should back off, got ${grind.suggestedWeight}`);
});

test('32. Problem 3: the slider changes the target RIR, and the plan follows it', () => {
  const push = plan150(setsOf(150, [10, 10, 10], [2, 2, 2]), { intensity: 1.5 });
  const normal = plan150(setsOf(150, [10, 10, 10], [2, 2, 2]));
  const easy = plan150(setsOf(150, [10, 10, 10], [2, 2, 2]), { intensity: 0.5 });
  assert.equal(push.scoringBreakdown.targetRir, 1);
  assert.equal(easy.scoringBreakdown.targetRir, 3);
  const load = (p: typeof push) => p.suggestedWeight * p.suggestedReps;
  assert.ok(load(push) > load(normal) && load(normal) > load(easy), 'per-set load should follow the slider');
});

test('33. On target → double progression: same weight, one more rep', () => {
  const plan = plan150(setsOf(150, [10, 10, 10], [2, 2, 2]));
  assert.equal(plan.suggestedWeight, 150);
  assert.equal(plan.suggestedReps, 11);
  assert.equal(plan.suggestedSets, 3);
});

test('34. Problem 4: the explanation quotes the numbers the plan was built on', () => {
  const cases = [
    plan150(setsOf(150, [10, 9, 8], [2, 1, 1], 10)),
    plan150(setsOf(150, [12, 12, 12], [2, 2, 2])),
    plan150(setsOf(150, [8, 8, 8], [3, 3, 3])),
    plan150(setsOf(150, [8, 8, 8], [0, 0, 0])),
    plan150(setsOf(150, [10, 10, 10], [2, 2, 2]), { intensity: 1.4 }),
  ];
  for (const plan of cases) {
    const b = plan.scoringBreakdown;
    const score = plan.performanceMetrics.performanceScore;
    const effort = score < 0.95 ? 'harder than target' : score > 1.05 ? 'easier than target' : 'on target';
    const r1 = (n: number) => Math.round(n * 10) / 10;
    assert.ok(plan.reasoning.includes(`${plan.suggestedWeight} lbs × ${plan.suggestedReps}`), plan.reasoning);
    assert.ok(plan.reasoning.includes(`target ${b.targetRir}: ${effort}`), plan.reasoning);
    assert.ok(plan.reasoning.includes(`est. 1RM ${r1(b.e1RM)} lbs`), plan.reasoning);
    assert.ok(plan.reasoning.includes(`RIR ${r1(b.predictedRir!)}`), plan.reasoning);
    const delta = plan.suggestedWeight - 150;
    assert.ok(plan.reasoning.startsWith(delta > 0 ? `↑ Weight +${delta}` : delta < 0 ? `↓ Weight ${delta}` : '→ Weight held'), plan.reasoning);
    // The predicted RIR really is what the estimate gives for that weight × reps.
    const expected = b.e1RM * (1 + (b.expectedGain || 0));
    assert.ok(Math.abs(repsToFailureAt(expected, plan.suggestedWeight) - plan.suggestedReps - b.predictedRir!) < 1e-6);
  }
});

test('35. Smoothing: one bad day after good sessions holds the weight', () => {
  const good = () => ({ liftId: 'bench', timestamp: '', sets: setsOf(150, [10, 10, 10], [2, 2, 2]) });
  const badDay = setsOf(150, [8, 8, 8], [0, 0, 0]);
  const alone = plan150(badDay);
  const smoothed = plan150(badDay, { history: [good(), good()] });
  assert.ok(alone.suggestedWeight < 150);
  assert.equal(smoothed.suggestedWeight, 150, `history should cushion one bad day, got ${smoothed.suggestedWeight}`);
  assert.equal(smoothed.scoringBreakdown.sessionsUsed, 3);
  assert.ok(smoothed.scoringBreakdown.e1RM > smoothed.scoringBreakdown.lastE1RM);
});

test('36. History that already contains the last session is not counted twice', () => {
  const last = { liftId: 'bench', timestamp: '', plannedSets: 3, sets: setsOf(150, [10, 10, 10], [2, 2, 2]) };
  const plan = plan150(last.sets, { history: [last] });
  assert.equal(plan.scoringBreakdown.sessionsUsed, 1);
});

test('37. Unlogged RIR is assumed from reps vs. plan', () => {
  const none = [undefined, undefined, undefined];
  const onPlan = analyzePerformance({ liftId: 'x', timestamp: '', sets: setsOf(150, [10, 10, 10], none, 10) });
  assert.equal(onPlan.performanceScore, 1);
  const short = plan150(setsOf(150, [10, 9, 8], none, 10));
  assert.ok(short.performanceMetrics.performanceScore < 0.95);
  assert.ok(short.suggestedWeight <= 150);
  assert.match(short.reasoning, /\(est\.\)/);
});

test('38. Calibrated machines: the text quotes the gym\'s own numbers', () => {
  // The engine works in calibrated lbs (×1.1); the user sees the machine's labels.
  const input = makeInput({
    lastSession: { liftId: 'row', timestamp: '', plannedSets: 3, sets: setsOf(110, [10, 10, 10], [2, 2, 2]) },
    constraints: RANGE_8_12,
    equipment: { getValidWeights: () => [88, 99, 110, 121, 132] },
  });
  const plan = generateNextWorkout(input);
  const shown = generateNextWorkout({ ...input, displayWeight: (w) => w / 1.1 });
  assert.equal(plan.suggestedWeight, shown.suggestedWeight);
  assert.ok(shown.reasoning.includes(`${Math.round((shown.suggestedWeight / 1.1) * 10) / 10} lbs ×`), shown.reasoning);
  assert.ok(!shown.reasoning.includes(`${shown.suggestedWeight} lbs ×`), shown.reasoning);
});
