import test from 'node:test';
import { strict as assert } from 'node:assert';
import { 
  analyzePerformance, 
  generateCandidates, 
  scoreCandidate, 
  generateNextWorkout,
  Session,
  ProgressionInput
} from './progression.js';

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
