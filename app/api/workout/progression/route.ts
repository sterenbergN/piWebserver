import { NextResponse } from 'next/server';
import { generateNextWorkout, ProgressionInput, Session, SetLog } from '@/lib/workout/progression';
import { getWorkoutData } from '@/lib/workout/data';
import { cookies } from 'next/headers';

// Equipment validity mapper based on station type
function getPossibleWeightsForStation(station: any): number[] {
    if (!station) return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]; 
    if (station.type === 'stack' || station.type === 'cable') {
       let possible: number[] = [];
       const inc = station.increment || 10;
       for (let w = station.minWeight || 10; w <= (station.maxWeight || 300); w += inc) {
           possible.push(w);
           if (station.additionalWeight) possible.push(w + station.additionalWeight);
       }
       return Array.from(new Set(possible)).sort((a,b) => a-b);
    }
    if (station.type === 'dumbbells') return [...(station.dumbbellPairs || [5,10,15,20,25])].sort((a,b)=>a-b);
    if (station.type === 'plates') {
       if (!station.plateSets || station.plateSets.length === 0) return [station.baseWeight || 45];
       const halfWeights = new Set([0]);
       for (const p of station.plateSets) {
            const currentPossible = Array.from(halfWeights);
            for (const w of currentPossible) {
                 halfWeights.add(w + p);
            }
       }
       return Array.from(halfWeights).map(hw => (station.baseWeight || 45) + (hw * 2)).sort((a,b) => a-b);
    }
    if (station.type === 'bodyweight') {
       if (!station.bodyWeightAdditions || station.bodyWeightAdditions.length === 0) return [0]; 
       const additions = station.bodyWeightAdditions.sort((a:number,b:number)=>a-b);
       return [0, ...additions];
    }
    return [0, 5, 10, 15];
}

/**
 * Convert raw history logs for a specific lift into Session[] format
 * for the progression engine's history trend analysis.
 */
function buildHistorySessions(historyData: any[], liftId: string): Session[] {
    const sessions: Session[] = [];

    for (const workout of historyData) {
        if (!workout.logs || !workout.logs[liftId]) continue;
        if (workout.type?.name === 'Cardio') continue;

        const rawSets = workout.logs[liftId];
        if (!rawSets || rawSets.length === 0) continue;

        const sets: SetLog[] = rawSets.map((log: any) => ({
            plannedReps: log.reps,   // prior system didn't track planned distinctly
            actualReps: log.reps,
            plannedWeight: log.weight,
            actualWeight: log.weight,
            completed: true,
        }));

        sessions.push({
            liftId,
            timestamp: workout.timestamp || new Date().toISOString(),
            sets,
        });
    }

    // Sort chronologically
    sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return sessions;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // Unpack payload
    const { liftId, station, logs, planType, intensity, timeLimitMinutes } = payload;
    
    // Build the last session from the provided logs
    const sets: SetLog[] = logs.map((log: any) => ({
       plannedReps: log.reps,   // fallbacks since prior system didn't track planned distinctly
       actualReps: log.reps,
       plannedWeight: log.weight,
       actualWeight: log.weight,
       completed: true,
    }));

    // Fetch real history for this lift to enable trend analysis
    let historySessions: Session[] = [];
    try {
        const cookieStore = await cookies();
        const userId = cookieStore.get('workout_auth')?.value;
        if (userId) {
            const histData = await getWorkoutData('history.json', { history: [] as any[] });
            const userHistory = histData.history.filter((h: any) => h.userId === userId);
            historySessions = buildHistorySessions(userHistory, liftId);
        }
    } catch {
        // Silently fall back to empty history if fetching fails
    }

    const input: ProgressionInput = {
       lastSession: {
           liftId,
           timestamp: new Date().toISOString(),
           sets
       },
       history: historySessions,
       constraints: {
           minReps: planType?.minReps || 5,
           maxReps: planType?.maxReps || 15,
           minSets: Math.max(1, (planType?.sets || 3) - 1),
           maxSets: (planType?.sets || 3) + 1,
           timeLimit: timeLimitMinutes || undefined,
       },
       equipment: {
           getValidWeights: (id) => getPossibleWeightsForStation(station)
       },
       intensity: intensity || 1.0
    };

    const plan = generateNextWorkout(input);

    return NextResponse.json({ success: true, plan });
  } catch (err) {
    console.error("Progression API Error:", err);
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}
