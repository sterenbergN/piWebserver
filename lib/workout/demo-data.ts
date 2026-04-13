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
