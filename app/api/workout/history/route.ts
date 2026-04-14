import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { removeCardioHistoryEntries, isCardioHistoryItem } from '@/lib/workout/history';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { getCalibrationStore, inferScaleFactor, upsertCalibrationEntry } from '@/lib/workout/calibration';
import { normalizeLiftKey } from '@/lib/workout/calibration-utils';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';

export async function GET() {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const rawData = await getWorkoutData('history.json', { history: [] as any[] });
  const { data, changed } = removeCardioHistoryEntries(rawData);
  if (changed) {
    await saveWorkoutData('history.json', data);
  }
  const userHistory = data.history.filter(h => h.userId === userId);

  return NextResponse.json({ success: true, history: userHistory });
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) {
     // Handle demo users smoothly by returning success without saving
     const payload = await request.json();
     if (payload.isDemo) {
        return NextResponse.json({ success: true });
     }
     return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    if (isCardioHistoryItem(payload)) {
      return NextResponse.json({ success: false, message: "Cardio history is no longer supported" }, { status: 400 });
    }

    const data = await getWorkoutData('history.json', { history: [] as any[] });
    const calibrationStore = await getCalibrationStore();

    data.history.push({
      ...payload,
      id: Math.random().toString(36).substring(2, 10),
      userId
    });

    // Auto-infer calibration for stack/cable on first session in a new gym
    try {
      const gymId = payload.gymId;
      const liftMeta = payload.liftMeta || {};
      if (gymId && payload.logs && typeof payload.logs === 'object') {
        for (const liftId of Object.keys(payload.logs)) {
          const meta = liftMeta[liftId];
          const liftName = meta?.name;
          const stationType = meta?.stationType;
          if (!liftName || (stationType !== 'stack' && stationType !== 'cable')) continue;

          const liftKey = normalizeLiftKey(liftName);
          const existing = calibrationStore.calibrations.find(c => c.userId === userId && c.gymId === gymId && c.liftKey === liftKey);
          if (existing) continue;

          const currentSets = payload.logs[liftId] || [];
          const currentLastSet = currentSets[currentSets.length - 1];
          if (!currentLastSet) continue;
          const currentE1RM = calcAverage1RM(currentLastSet.weight, currentLastSet.reps);

          const otherHistory = data.history
            .filter((h: any) => h.userId === userId && h.gymId && h.gymId !== gymId && h.liftMeta)
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          let reference: any = null;
          for (const entry of otherHistory) {
            const metaMap = entry.liftMeta || {};
            const matchedLiftId = Object.keys(metaMap).find(key => normalizeLiftKey(metaMap[key]?.name || '') === liftKey);
            if (!matchedLiftId) continue;
            const sets = entry.logs?.[matchedLiftId] || [];
            const lastSet = sets[sets.length - 1];
            if (!lastSet) continue;
            reference = {
              gymId: entry.gymId,
              gymName: entry.gymName,
              liftId: matchedLiftId,
              weight: lastSet.weight,
              reps: lastSet.reps,
              e1rm: calcAverage1RM(lastSet.weight, lastSet.reps)
            };
            break;
          }

          if (!reference) continue;

          const prevCalibration = calibrationStore.calibrations.find(c => c.userId === userId && c.gymId === reference.gymId && c.liftKey === liftKey);
          const prevScale = prevCalibration?.scaleFactor || 1;
          const prevE1RMNormalized = reference.e1rm * prevScale;
          const scaleFactor = inferScaleFactor(prevE1RMNormalized, currentE1RM);
          if (!scaleFactor) continue;

          await upsertCalibrationEntry({
            userId,
            gymId,
            liftKey,
            stationType,
            scaleFactor,
            confidence: 0.35,
            updatedAt: new Date().toISOString(),
            reference: {
              fromGymId: reference.gymId,
              fromGymName: reference.gymName,
              fromLiftId: reference.liftId,
              fromWeight: reference.weight,
              fromReps: reference.reps,
              fromE1RM: reference.e1rm,
              currentWeight: currentLastSet.weight,
              currentReps: currentLastSet.reps,
              currentE1RM
            }
          });
        }
      }
    } catch {
      // silent calibration failure
    }

    await saveWorkoutData('history.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    const rawData = await getWorkoutData('history.json', { history: [] as any[] });
    const { data } = removeCardioHistoryEntries(rawData);
    const log = data.history.find(h => h.id === id);
    if (!log || log.userId !== userId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

    data.history = data.history.filter(h => h.id !== id);
    await saveWorkoutData('history.json', data);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: "Server error" }, { status: 500 });
  }
}
