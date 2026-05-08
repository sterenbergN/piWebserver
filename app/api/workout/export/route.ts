import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { removeCardioHistoryEntries } from '@/lib/workout/history';
import { normalizeUsersData, normalizeWorkoutUser } from '@/lib/workout/users';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

function escapeCsv(value: unknown) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export async function GET() {
  const userId = await getAuthenticatedWorkoutUserId();

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const [rawUsersData, rawHistoryData, gymsData] = await Promise.all([
    getWorkoutData('users.json', { users: [] as any[] }),
    getWorkoutData('history.json', { history: [] as any[] }),
    getWorkoutData('gyms.json', { gyms: [] as any[] }),
  ]);

  const { data: usersData, changed: usersChanged } = normalizeUsersData(rawUsersData);
  const { data: historyData, changed: historyChanged } = removeCardioHistoryEntries(rawHistoryData);

  if (usersChanged) {
    await saveWorkoutData('users.json', usersData);
  }
  if (historyChanged) {
    await saveWorkoutData('history.json', historyData);
  }

  const userRecord = usersData.users.find((user) => user.id === userId);
  if (!userRecord) {
    return new Response('User not found', { status: 404 });
  }

  const normalizedUser = normalizeWorkoutUser(userRecord);

  // Build lift metadata map from gym definitions — includes muscle groups
  const liftMetadata = new Map<string, {
    liftName: string;
    stationId: string;
    stationName: string;
    stationType: string;
    primaryMuscle: string;
    secondaryMuscle: string;
  }>();

  gymsData.gyms.forEach((gym: any) => {
    gym.stations?.forEach((station: any) => {
      station.lifts?.forEach((lift: any) => {
        liftMetadata.set(lift.id, {
          liftName: lift.name || '',
          stationId: station.id || '',
          stationName: station.name || '',
          stationType: station.type || '',
          primaryMuscle: lift.primaryMuscle || '',
          secondaryMuscle: lift.secondaryMuscle || '',
        });
      });
    });
  });

  const headers = [
    'userId',
    'username',
    'gender',
    'birthdate',
    'height',
    'weight',
    'intensityFactor',
    'workoutId',
    'planId',
    'workoutName',
    'workoutTypeId',
    'workoutTypeName',
    'workoutTimestamp',
    'duration',
    'calories',
    'volume',
    'isDeload',
    'liftId',
    'liftName',
    'stationId',
    'stationName',
    'stationType',
    'primaryMuscle',
    'secondaryMuscle',
    'supersetId',
    'setIndex',
    'setWeight',
    'setReps',
    'setCompleted',
    'setTimestamp',
    'setRir',
    'setPlannedWeight',
    'setPlannedReps',
    'gymId',
    'gymName',
  ];

  const rows = historyData.history
    .filter((workout: any) => workout.userId === userId)
    .flatMap((workout: any) => {
      const baseRow = {
        userId: normalizedUser.id,
        username: normalizedUser.username,
        gender: normalizedUser.gender ?? '',
        birthdate: normalizedUser.birthdate ?? '',
        height: normalizedUser.height ?? '',
        weight: normalizedUser.weight ?? '',
        intensityFactor: normalizedUser.intensityFactor ?? 1,
        workoutId: workout.id ?? '',
        planId: workout.planId ?? '',
        workoutName: workout.name ?? '',
        workoutTypeId: workout.type?.id ?? '',
        workoutTypeName: workout.type?.name ?? '',
        workoutTimestamp: workout.timestamp ?? '',
        duration: workout.duration ?? '',
        calories: workout.calories ?? '',
        volume: workout.volume ?? '',
        isDeload: workout.isDeload ? 'true' : '',
        gymId: workout.gymId ?? '',
        gymName: workout.gymName ?? '',
      };

      const logEntries = Object.entries(workout.logs ?? {});
      if (logEntries.length === 0) {
        return [
          {
            ...baseRow,
            liftId: '',
            liftName: '',
            stationId: '',
            stationName: '',
            stationType: '',
            primaryMuscle: '',
            secondaryMuscle: '',
            supersetId: '',
            setIndex: '',
            setWeight: '',
            setReps: '',
            setCompleted: '',
            setTimestamp: '',
            setRir: '',
            setPlannedWeight: '',
            setPlannedReps: '',
          },
        ];
      }

      return logEntries.flatMap(([liftId, sets]) => {
        const gymMeta = liftMetadata.get(liftId) ?? {
          liftName: '',
          stationId: '',
          stationName: '',
          stationType: '',
          primaryMuscle: '',
          secondaryMuscle: '',
        };
        // Per-workout liftMeta may override gym-level data (e.g. after a station rename)
        const workoutLiftMeta = (workout.liftMeta ?? {})[liftId] || {};

        return (sets as any[]).map((set, index) => ({
          ...baseRow,
          liftId,
          liftName: workoutLiftMeta.name || gymMeta.liftName,
          stationId: gymMeta.stationId,
          stationName: gymMeta.stationName,
          stationType: workoutLiftMeta.stationType || gymMeta.stationType,
          primaryMuscle: gymMeta.primaryMuscle,
          secondaryMuscle: gymMeta.secondaryMuscle,
          supersetId: workoutLiftMeta.supersetId ?? '',
          setIndex: String(index + 1),
          setWeight: set.weight ?? '',
          setReps: set.reps ?? '',
          setCompleted: set.completed ?? '',
          setTimestamp: set.timestamp ?? '',
          setRir: set.rir ?? '',
          setPlannedWeight: set.plannedWeight ?? '',
          setPlannedReps: set.plannedReps ?? '',
        }));
      });
    });

  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCsv((row as Record<string, unknown>)[header])).join(',')
    ),
  ];

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csvLines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="workout-data-${today}.csv"`,
    },
  });
}
