// Local test data for the workout tracker: a login, a gym built from the
// commercial template, two workout types and a few weeks of history.
//
//   npm run seed:workout            (refuses to touch existing data)
//   npm run seed:workout -- --force (replaces .data/workouts/*.json)
//
// Dev login: username "tester", password "tester-pass". Never run this on the Pi.

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

async function main() {
  const files = ['users.json', 'gyms.json', 'workout_types.json', 'history.json'];
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
    }],
  };
  const gyms = {
    gyms: [{ id: GYM_ID, ownerId: USER_ID, name: 'Dev Commercial Gym', emoji: '🏢', isPublic: false, stations, createdAt: new Date().toISOString() }],
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

  const write = (file: string, data: unknown) => fs.writeFile(path.join(dir, file), JSON.stringify(data, null, 2));
  await Promise.all([write('users.json', users), write('gyms.json', gyms), write('workout_types.json', types), write('history.json', { history })]);
  console.log(`Seeded ${path.relative(process.cwd(), dir)}: user "tester" / "tester-pass", ${stations.length} stations, ${history.length} workouts.`);
}

function liftMetaFor(lift: Lift, station: Station) {
  return { name: lift.name, stationType: station.type, stationId: station.id, primaryMuscle: lift.primaryMuscle, secondaryMuscle: lift.secondaryMuscle, supersetId: null, plannedSets: 3 };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
