import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { findWorkoutUser } from '@/lib/workout/users';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

type ParticipantProgress = {
  activeLiftIndex: number;
  currentLiftName: string;
  completedSets: number;
  totalSets: number;
  status: 'active' | 'paused' | 'finished' | 'deleted';
  updatedAt: string;
};

type SessionParticipant = {
  userId: string;
  username: string;
  joinedAt: string;
  progress: ParticipantProgress;
};

type SharedSession = {
  id: string;
  code: string;
  hostUserId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: 'active' | 'finished';
  planTemplate: {
    name: string;
    type: any;
    gymId?: string;
    gymName?: string;
    lifts: any[];
  };
  participants: SessionParticipant[];
};

type SessionStore = {
  sessions: SharedSession[];
};

const SESSIONS_FILE = 'workout-sessions.json';
const MAX_PARTICIPANTS = 2;
/** Sessions untouched for this long are pruned so the file doesn't grow forever. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PROGRESS_STATUSES = ['active', 'paused', 'finished', 'deleted'] as const;

function generateCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0
  return Array.from({ length: 3 }, () => letters[crypto.randomInt(letters.length)]).join('');
}

function pruneStaleSessions(store: SessionStore) {
  const cutoff = Date.now() - SESSION_TTL_MS;
  store.sessions = (store.sessions || []).filter((entry) => new Date(entry.updatedAt).getTime() >= cutoff);
}

function defaultProgress(): ParticipantProgress {
  return {
    activeLiftIndex: 0,
    currentLiftName: '',
    completedSets: 0,
    totalSets: 0,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
}

function mergeProgress(current: ParticipantProgress, progress: any): ParticipantProgress {
  const nonNegativeInt = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  return {
    activeLiftIndex: nonNegativeInt(progress?.activeLiftIndex, current.activeLiftIndex),
    currentLiftName: typeof progress?.currentLiftName === 'string' ? progress.currentLiftName.slice(0, 200) : current.currentLiftName,
    completedSets: nonNegativeInt(progress?.completedSets, current.completedSets),
    totalSets: nonNegativeInt(progress?.totalSets, current.totalSets),
    status: PROGRESS_STATUSES.includes(progress?.status) ? progress.status : current.status,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const sessionId = new URL(request.url).searchParams.get('id');
    if (!sessionId) throw new ApiError(400, 'Missing session id');

    const store = await getWorkoutData<SessionStore>(SESSIONS_FILE, { sessions: [] });
    const session = (store.sessions || []).find((entry) => entry.id === sessionId);
    if (!session) throw new ApiError(404, 'Session not found');

    const participant = session.participants.find((entry) => entry.userId === userId);
    if (!participant) throw new ApiError(403, 'Forbidden');

    const peer = session.participants.find((entry) => entry.userId !== userId) || null;
    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        code: session.code,
        version: session.version,
        status: session.status,
        updatedAt: session.updatedAt,
        planTemplate: session.planTemplate,
      },
      self: participant,
      peer,
    });
  } catch (error) {
    return handleApiError(error, 'Load shared session failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const user = await findWorkoutUser(userId);
    const username = user?.username || 'User';

    if (body.action === 'create') {
      const planTemplate = body.planTemplate;
      if (!planTemplate || !Array.isArray(planTemplate.lifts) || planTemplate.lifts.length === 0) {
        throw new ApiError(400, 'Invalid plan template');
      }

      const session = await updateWorkoutData(SESSIONS_FILE, { sessions: [] as SharedSession[] }, (store) => {
        pruneStaleSessions(store);

        let code = generateCode();
        for (let guard = 0; guard < 50 && store.sessions.some((entry) => entry.code === code && entry.status === 'active'); guard++) {
          code = generateCode();
        }
        if (store.sessions.some((entry) => entry.code === code && entry.status === 'active')) {
          throw new ApiError(503, 'Too many active sessions, try again shortly');
        }

        const now = new Date().toISOString();
        const created: SharedSession = {
          id: `ws-${generateId()}`,
          code,
          hostUserId: userId,
          createdAt: now,
          updatedAt: now,
          version: 1,
          status: 'active',
          planTemplate: {
            name: String(planTemplate.name || 'Shared Workout').slice(0, 200),
            type: planTemplate.type || {},
            gymId: planTemplate.gymId || '',
            gymName: planTemplate.gymName || '',
            lifts: planTemplate.lifts.slice(0, 50),
          },
          participants: [
            {
              userId,
              username,
              joinedAt: now,
              progress: mergeProgress(defaultProgress(), body.progress),
            },
          ],
        };
        store.sessions.push(created);
        return created;
      });

      return NextResponse.json({ success: true, sessionId: session.id, code: session.code, session });
    }

    if (body.action === 'join') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new ApiError(400, 'Join code must be 3 letters');

      const session = await updateWorkoutData(SESSIONS_FILE, { sessions: [] as SharedSession[] }, (store) => {
        pruneStaleSessions(store);
        const found = store.sessions.find((entry) => entry.code === code && entry.status === 'active');
        if (!found) throw new ApiError(404, 'Session not found');

        if (!found.participants.some((entry) => entry.userId === userId)) {
          if (found.participants.length >= MAX_PARTICIPANTS) throw new ApiError(409, 'Session is full');
          found.participants.push({
            userId,
            username,
            joinedAt: new Date().toISOString(),
            progress: defaultProgress(),
          });
          found.version += 1;
          found.updatedAt = new Date().toISOString();
        }
        return found;
      });

      return NextResponse.json({ success: true, sessionId: session.id, session });
    }

    throw new ApiError(400, 'Unsupported action');
  } catch (error) {
    return handleApiError(error, 'Shared session action failed');
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const sessionId = String(body.sessionId || '');
    if (!sessionId) throw new ApiError(400, 'Missing session id');

    const version = await updateWorkoutData(SESSIONS_FILE, { sessions: [] as SharedSession[] }, (store) => {
      const session = (store.sessions || []).find((entry) => entry.id === sessionId);
      if (!session) throw new ApiError(404, 'Session not found');

      const participant = session.participants.find((entry) => entry.userId === userId);
      if (!participant) throw new ApiError(403, 'Forbidden');

      participant.progress = mergeProgress(participant.progress, body.progress);
      session.updatedAt = new Date().toISOString();
      session.version += 1;
      // The session closes to new joiners once everyone still in it is done.
      const remaining = session.participants.filter((entry) => entry.progress.status !== 'deleted');
      if (remaining.length > 0 && remaining.every((entry) => entry.progress.status === 'finished')) {
        session.status = 'finished';
      }
      return session.version;
    });

    return NextResponse.json({ success: true, version });
  } catch (error) {
    return handleApiError(error, 'Update shared session failed');
  }
}
