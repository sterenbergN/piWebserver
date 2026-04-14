export const DEMO_GYMS = [
  {
    id: 'demo-gym-home',
    ownerId: 'demo-user-123',
    name: 'Demo Home Gym',
    emoji: '🏠',
    stations: [
      {
        id: 'demo-station-smith',
        type: 'plates',
        name: 'Smith Machine',
        baseWeight: 25,
        plateSets: [45, 45, 25, 10, 5, 2.5],
        lifts: [
          { id: 'demo-lift-bench', name: 'Bench', primaryMuscle: 'Chest', secondaryMuscle: 'Triceps', singleArmLeg: false },
          { id: 'demo-lift-squat', name: 'Squat', primaryMuscle: 'Quads', secondaryMuscle: 'Glutes', singleArmLeg: false },
          { id: 'demo-lift-rdl', name: 'Romanian Deadlift', primaryMuscle: 'Hamstrings', secondaryMuscle: 'Glutes', singleArmLeg: false },
        ],
      },
      {
        id: 'demo-station-db',
        type: 'dumbbells',
        name: 'Dumbbell Rack',
        dumbbellPairs: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
        lifts: [
          { id: 'demo-lift-press', name: 'Shoulder Press', primaryMuscle: 'Shoulders', secondaryMuscle: 'Triceps', singleArmLeg: true },
          { id: 'demo-lift-curl', name: 'Curls', primaryMuscle: 'Biceps', secondaryMuscle: 'None', singleArmLeg: true },
          { id: 'demo-lift-row', name: 'One Arm Row', primaryMuscle: 'Back', secondaryMuscle: 'Biceps', singleArmLeg: true },
        ],
      },
      {
        id: 'demo-station-cable',
        type: 'cable',
        name: 'Cable Tower',
        minWeight: 10,
        maxWeight: 100,
        increment: 10,
        additionalWeight: 5,
        attachments: ['Rope', 'Handle', 'Bar'],
        lifts: [
          { id: 'demo-lift-fly', name: 'Chest Flys', primaryMuscle: 'Chest', secondaryMuscle: 'Shoulders', singleArmLeg: true, attachment: 'Handle' },
          { id: 'demo-lift-pd', name: 'Lat Pulldown - Inner', primaryMuscle: 'Back', secondaryMuscle: 'Biceps', singleArmLeg: false, attachment: 'Bar' },
          { id: 'demo-lift-pushdown', name: 'Triceps Extension', primaryMuscle: 'Triceps', secondaryMuscle: 'None', singleArmLeg: false, attachment: 'Rope' },
        ],
      },
    ],
  },
  {
    id: 'demo-gym-commercial',
    ownerId: 'demo-user-123',
    name: 'Demo Commercial Gym',
    emoji: '🏢',
    stations: [
      {
        id: 'demo-station-press',
        type: 'stack',
        name: 'Chest Press Machine',
        minWeight: 15,
        maxWeight: 300,
        increment: 15,
        additionalWeight: 5,
        lifts: [
          { id: 'demo-lift-chestpress', name: 'Chest Press', primaryMuscle: 'Chest', secondaryMuscle: 'Triceps', singleArmLeg: false },
        ],
      },
      {
        id: 'demo-station-legext',
        type: 'stack',
        name: 'Leg Extension',
        minWeight: 15,
        maxWeight: 300,
        increment: 15,
        additionalWeight: 5,
        lifts: [
          { id: 'demo-lift-legext', name: 'Leg Extension', primaryMuscle: 'Quads', secondaryMuscle: 'None', singleArmLeg: false },
        ],
      },
      {
        id: 'demo-station-row',
        type: 'stack',
        name: 'Row Machine',
        minWeight: 15,
        maxWeight: 300,
        increment: 15,
        additionalWeight: 5,
        lifts: [
          { id: 'demo-lift-rowmachine', name: 'Row', primaryMuscle: 'Back', secondaryMuscle: 'Biceps', singleArmLeg: false },
        ],
      },
    ],
  },
];

export const DEMO_TYPES = [
  {
    id: 'demo-type-upper',
    ownerId: 'demo-user-123',
    name: 'Demo Upper Hypertrophy',
    muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'],
    intensity: 75,
    minReps: 8,
    maxReps: 12,
    sets: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'demo-type-lower',
    ownerId: 'demo-user-123',
    name: 'Demo Lower Hypertrophy',
    muscles: ['Quads', 'Hamstrings', 'Glutes'],
    intensity: 75,
    minReps: 8,
    maxReps: 12,
    sets: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - (days * 24 * 60 * 60 * 1000)).toISOString();

export const DEMO_HISTORY = [
  {
    id: 'demo-hist-1',
    userId: 'demo-user-123',
    planId: 'demo-plan-1',
    name: 'Demo Upper Hypertrophy @ Demo Home Gym',
    type: DEMO_TYPES[0],
    duration: '38:10',
    timestamp: daysAgo(8),
    calories: 382,
    volume: 9680,
    gymId: 'demo-gym-home',
    gymName: 'Demo Home Gym',
    liftMeta: {
      'demo-lift-bench': { name: 'Bench', stationType: 'plates', stationId: 'demo-station-smith', supersetId: null },
      'demo-lift-row': { name: 'One Arm Row', stationType: 'dumbbells', stationId: 'demo-station-db', supersetId: null },
    },
    logs: {
      'demo-lift-bench': [
        { weight: 95, reps: 10, plannedWeight: 95, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 1000 },
        { weight: 95, reps: 9, plannedWeight: 95, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 2000 },
        { weight: 95, reps: 8, plannedWeight: 95, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 3000 },
        { weight: 90, reps: 10, plannedWeight: 95, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 4000 },
      ],
      'demo-lift-row': [
        { weight: 45, reps: 12, plannedWeight: 45, plannedReps: 12, rir: 2, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 5000 },
        { weight: 45, reps: 11, plannedWeight: 45, plannedReps: 12, rir: 1, completed: true, timestamp: NOW - 8 * 24 * 60 * 60 * 1000 + 6000 },
      ],
    },
  },
  {
    id: 'demo-hist-2',
    userId: 'demo-user-123',
    planId: 'demo-plan-2',
    name: 'Demo Upper Hypertrophy @ Demo Home Gym',
    type: DEMO_TYPES[0],
    duration: '40:05',
    timestamp: daysAgo(4),
    calories: 401,
    volume: 10420,
    gymId: 'demo-gym-home',
    gymName: 'Demo Home Gym',
    liftMeta: {
      'demo-lift-bench': { name: 'Bench', stationType: 'plates', stationId: 'demo-station-smith', supersetId: null },
      'demo-lift-row': { name: 'One Arm Row', stationType: 'dumbbells', stationId: 'demo-station-db', supersetId: null },
      'demo-lift-press': { name: 'Shoulder Press', stationType: 'dumbbells', stationId: 'demo-station-db', supersetId: null },
    },
    logs: {
      'demo-lift-bench': [
        { weight: 100, reps: 10, plannedWeight: 100, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 1000 },
        { weight: 100, reps: 9, plannedWeight: 100, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 2000 },
        { weight: 95, reps: 10, plannedWeight: 100, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 3000 },
      ],
      'demo-lift-row': [
        { weight: 50, reps: 10, plannedWeight: 50, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 4000 },
        { weight: 50, reps: 9, plannedWeight: 50, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 5000 },
      ],
      'demo-lift-press': [
        { weight: 35, reps: 11, plannedWeight: 35, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 6000 },
        { weight: 35, reps: 10, plannedWeight: 35, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 4 * 24 * 60 * 60 * 1000 + 7000 },
      ],
    },
  },
  {
    id: 'demo-hist-3',
    userId: 'demo-user-123',
    planId: 'demo-plan-3',
    name: 'Demo Lower Hypertrophy @ Demo Home Gym',
    type: DEMO_TYPES[1],
    duration: '42:22',
    timestamp: daysAgo(2),
    calories: 436,
    volume: 12350,
    gymId: 'demo-gym-home',
    gymName: 'Demo Home Gym',
    liftMeta: {
      'demo-lift-squat': { name: 'Squat', stationType: 'plates', stationId: 'demo-station-smith', supersetId: null },
      'demo-lift-rdl': { name: 'Romanian Deadlift', stationType: 'plates', stationId: 'demo-station-smith', supersetId: null },
    },
    logs: {
      'demo-lift-squat': [
        { weight: 135, reps: 8, plannedWeight: 135, plannedReps: 8, rir: 2, completed: true, timestamp: NOW - 2 * 24 * 60 * 60 * 1000 + 1000 },
        { weight: 135, reps: 8, plannedWeight: 135, plannedReps: 8, rir: 2, completed: true, timestamp: NOW - 2 * 24 * 60 * 60 * 1000 + 2000 },
        { weight: 145, reps: 7, plannedWeight: 140, plannedReps: 8, rir: 1, completed: true, timestamp: NOW - 2 * 24 * 60 * 60 * 1000 + 3000 },
      ],
      'demo-lift-rdl': [
        { weight: 115, reps: 10, plannedWeight: 115, plannedReps: 10, rir: 2, completed: true, timestamp: NOW - 2 * 24 * 60 * 60 * 1000 + 4000 },
        { weight: 115, reps: 9, plannedWeight: 115, plannedReps: 10, rir: 1, completed: true, timestamp: NOW - 2 * 24 * 60 * 60 * 1000 + 5000 },
      ],
    },
  },
];
