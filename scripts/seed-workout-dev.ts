// Local test data for the workout tracker: a login, a commercial gym and a
// home gym, two workout types and a few weeks of history. The home gym's bench
// lift is named "Flat Bench" (not linked to "Bench Press") so exercise linking
// can be tried out.
//
//   npm run seed:workout            (refuses to touch existing data)
//   npm run seed:workout -- --force (replaces .data/workouts/*.json)
//
// Dev logins: "tester" / "tester-pass", and "partner" / "partner-pass" for
// trying partner mode from a second browser. Never run this on the Pi.

import fs from 'node:fs/promises';
import path from 'node:path';
import { hashPassword } from '../lib/workout/passwords';
import { stationsFromTemplate } from '../lib/workout/catalog';
import { getPossibleWeights, snapToPossibleWeight } from '../lib/workout/equipment';
import type { Lift, Station } from '../lib/workout/types';

const dir = path.join(process.cwd(), '.data', 'workouts');
const force = process.argv.includes('--force');
const USER_ID = 'dev-tester';
const GYM_ID = 'dev-gym';
const HOME_ID = 'dev-home';

async function main() {
  const files = ['users.json', 'gyms.json', 'workout_types.json', 'history.json', 'programs.json', 'goals.json'];
  await fs.mkdir(dir, { recursive: true });
  if (!force) {
    for (const file of files) {
      const exists = await fs.access(path.join(dir, file)).then(() => true, () => false);
      if (exists) {
        console.error(`.data/workouts/${file} already exists — re-run with --force to replace the workout data.`);
        process.exit(1);
      }
    }
  }

  const stations = stationsFromTemplate('commercial');
  const homeStations = stationsFromTemplate('home');
  const homeBench = homeStations.flatMap((s) => s.lifts).find((l) => l.name === 'Bench Press')!;
  homeBench.name = 'Flat Bench';
  const users = {
    users: [{
      id: USER_ID,
      username: 'tester',
      password: hashPassword('tester-pass'),
      birthdate: '1995-06-15',
      height: 70,
      gender: 'male',
      weight: 180,
      intensityFactor: 1,
      createdAt: new Date().toISOString(),
    }, {
      id: 'dev-partner',
      username: 'partner',
      password: hashPassword('partner-pass'),
      birthdate: '1996-02-01',
      height: 66,
      gender: 'female',
      weight: 140,
      intensityFactor: 1,
      createdAt: new Date().toISOString(),
    }],
  };
  const gyms = {
    gyms: [
      { id: GYM_ID, ownerId: USER_ID, name: 'Dev Commercial Gym', emoji: '🏢', isPublic: false, stations, createdAt: new Date().toISOString() },
      { id: HOME_ID, ownerId: USER_ID, name: 'Dev Home Gym', emoji: '🏠', isPublic: false, stations: homeStations, createdAt: new Date().toISOString() },
    ],
  };
  const types = {
    types: [
      { id: 'dev-type-push', ownerId: USER_ID, name: 'Push', muscles: ['Chest', 'Shoulders', 'Triceps'], intensity: 75, minReps: 8, maxReps: 12, sets: 3, isPublic: false, fixedLifts: [] },
      { id: 'dev-type-legs', ownerId: USER_ID, name: 'Legs', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'], intensity: 80, minReps: 6, maxReps: 10, sets: 3, isPublic: false, fixedLifts: [] },
    ],
  };

  const find = (liftName: string) => {
    for (const station of stations) {
      const lift = station.lifts.find((l) => l.name === liftName);
      if (lift) return { lift, station };
    }
    throw new Error(`Seed lift not found: ${liftName}`);
  };

  // Eight sessions over four weeks with a small, steady progression.
  const plans: { type: typeof types.types[number]; lifts: [string, number][] }[] = [
    { type: types.types[0], lifts: [['Bench Press', 135], ['Chest Press', 90], ['Tricep Pushdown', 40], ['Cable Lateral Raise', 10]] },
    { type: types.types[1], lifts: [['Back Squat', 185], ['Leg Press', 230], ['Seated Leg Curl', 70], ['Leg Extension', 80]] },
  ];
  const history: any[] = [];
  for (let session = 0; session < 8; session++) {
    const plan = plans[session % 2];
    const week = Math.floor(session / 2);
    const when = new Date(Date.now() - (28 - session * 3.5) * 86_400_000);
    when.setHours(18, 0, 0, 0);
    const logs: Record<string, any[]> = {};
    const liftMeta: Record<string, any> = {};
    let volume = 0;
    plan.lifts.forEach(([name, start], order) => {
      const { lift, station } = find(name);
      const weight = snapToPossibleWeight(start + week * 5, getPossibleWeights(station));
      logs[lift.id] = [10, 9, 8].map((reps, i) => {
        volume += weight * reps;
        return { weight, reps, plannedWeight: weight, plannedReps: 10, rir: 1 + (i === 0 ? 1 : 0), completed: true, timestamp: when.getTime() + (order * 4 + i) * 120_000 };
      });
      liftMeta[lift.id] = liftMetaFor(lift, station);
    });
    history.push({
      id: `dev-history-${session}`,
      userId: USER_ID,
      clientId: `dev-client-${session}`,
      planId: `dev-plan-${session}`,
      name: `${plan.type.name} @ Dev Commercial Gym`,
      type: { id: plan.type.id, name: plan.type.name, muscles: plan.type.muscles, intensity: plan.type.intensity, minReps: plan.type.minReps, maxReps: plan.type.maxReps, sets: plan.type.sets },
      duration: '42:00',
      durationSecs: 2520,
      timestamp: when.toISOString(),
      logs,
      liftMeta,
      calories: 230,
      volume,
      gymId: GYM_ID,
      gymName: 'Dev Commercial Gym',
      isDeload: false,
      intensitySlider: 1,
    });
  }

  // One session at home, a week ago, on the differently named bench lift.
  const homeRack = homeStations.find((s) => s.lifts.some((l) => l.id === homeBench.id))!;
  const homeWhen = new Date(Date.now() - 7 * 86_400_000);
  history.push({
    id: 'dev-history-home', userId: USER_ID, clientId: 'dev-client-home', planId: 'dev-plan-home',
    name: 'Push @ Dev Home Gym', type: history[0].type, duration: '30:00', durationSecs: 1800,
    timestamp: homeWhen.toISOString(),
    logs: { [homeBench.id]: [8, 8, 7].map((reps, i) => ({ weight: 155, reps, plannedWeight: 155, plannedReps: 8, rir: 1, completed: true, timestamp: homeWhen.getTime() + i * 150_000 })) },
    liftMeta: { [homeBench.id]: liftMetaFor(homeBench, homeRack) },
    calories: 150, volume: 155 * 23, gymId: HOME_ID, gymName: 'Dev Home Gym', isDeload: false, intensitySlider: 1,
  });

  const programs = {
    programs: [{ id: 'dev-program', ownerId: USER_ID, name: 'Push / Legs', days: [{ typeId: 'dev-type-push', lifts: 4 }, { typeId: 'dev-type-legs', lifts: 4 }], deloadEveryWeeks: 4, gymId: GYM_ID, isPublic: false }],
  };
  const goals = {
    goals: [{ id: 'dev-goal', ownerId: USER_ID, exercise: 'Bench Press', targetWeight: 185, targetReps: 5, isPublic: false, createdAt: new Date().toISOString() }],
  };

  const write = (file: string, data: unknown) => fs.writeFile(path.join(dir, file), JSON.stringify(data, null, 2));
  await Promise.all([write('users.json', users), write('gyms.json', gyms), write('workout_types.json', types), write('history.json', { history }), write('programs.json', programs), write('goals.json', goals)]);
  console.log(`Seeded ${path.relative(process.cwd(), dir)}: user "tester" / "tester-pass", ${stations.length + homeStations.length} stations in 2 gyms, ${history.length} workouts.`);
}

function liftMetaFor(lift: Lift, station: Station) {
  return { name: lift.name, stationType: station.type, stationId: station.id, primaryMuscle: lift.primaryMuscle, secondaryMuscle: lift.secondaryMuscle, supersetId: null, plannedSets: 3 };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
