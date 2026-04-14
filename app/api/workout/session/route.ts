import { NextResponse } from 'next/server';
import { getWorkoutData, saveWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { normalizeUsersData } from '@/lib/workout/users';

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

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function generateCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

async function getUsernameByUserId(userId: string): Promise<string> {
  const rawUsersData = await getWorkoutData('users.json', { users: [] } as any);
  const { data: usersData, changed } = normalizeUsersData(rawUsersData);
  if (changed) {
    await saveWorkoutData('users.json', usersData);
  }
  return usersData.users.find((user: any) => user.id === userId)?.username || 'User';
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

export async function GET(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');
  if (!sessionId) return NextResponse.json({ success: false, message: 'Missing session id' }, { status: 400 });

  const store = await getWorkoutData<SessionStore>('workout-sessions.json', { sessions: [] });
  const session = store.sessions.find((entry) => entry.id === sessionId);
  if (!session) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 });

  const participant = session.participants.find((entry) => entry.userId === userId);
  if (!participant) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

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
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Login required for shared mode' }, { status: 401 });

  const body = await request.json();
  const action = body?.action;
  const username = await getUsernameByUserId(userId);
  const store = await getWorkoutData<SessionStore>('workout-sessions.json', { sessions: [] });

  if (action === 'create') {
    const planTemplate = body?.planTemplate;
    if (!planTemplate || !Array.isArray(planTemplate.lifts) || planTemplate.lifts.length === 0) {
      return NextResponse.json({ success: false, message: 'Invalid plan template' }, { status: 400 });
    }

    let code = generateCode();
    let guard = 0;
    while (store.sessions.some((entry) => entry.code === code && entry.status === 'active') && guard < 30) {
      code = generateCode();
      guard += 1;
    }

    const now = new Date().toISOString();
    const session: SharedSession = {
      id: `ws-${randomId()}`,
      code,
      hostUserId: userId,
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'active',
      planTemplate: {
        name: String(planTemplate.name || 'Shared Workout'),
        type: planTemplate.type || {},
        gymId: planTemplate.gymId || '',
        gymName: planTemplate.gymName || '',
        lifts: planTemplate.lifts,
      },
      participants: [
        {
          userId,
          username,
          joinedAt: now,
          progress: body?.progress || defaultProgress(),
        },
      ],
    };

    store.sessions.push(session);
    await saveWorkoutData('workout-sessions.json', store);
    return NextResponse.json({ success: true, sessionId: session.id, code: session.code, session });
  }

  if (action === 'join') {
    const code = String(body?.code || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return NextResponse.json({ success: false, message: 'Join code must be 3 letters' }, { status: 400 });
    }

    const session = store.sessions.find((entry) => entry.code === code && entry.status === 'active');
    if (!session) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 });

    const existing = session.participants.find((entry) => entry.userId === userId);
    if (!existing) {
      session.participants.push({
        userId,
        username,
        joinedAt: new Date().toISOString(),
        progress: defaultProgress(),
      });
      session.version += 1;
      session.updatedAt = new Date().toISOString();
      await saveWorkoutData('workout-sessions.json', store);
    }

    return NextResponse.json({ success: true, sessionId: session.id, session });
  }

  return NextResponse.json({ success: false, message: 'Unsupported action' }, { status: 400 });
}

export async function PATCH(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const sessionId = String(body?.sessionId || '');
  if (!sessionId) return NextResponse.json({ success: false, message: 'Missing session id' }, { status: 400 });

  const store = await getWorkoutData<SessionStore>('workout-sessions.json', { sessions: [] });
  const session = store.sessions.find((entry) => entry.id === sessionId);
  if (!session) return NextResponse.json({ success: false, message: 'Session not found' }, { status: 404 });

  const participant = session.participants.find((entry) => entry.userId === userId);
  if (!participant) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

  const progress = body?.progress || {};
  participant.progress = {
    ...participant.progress,
    activeLiftIndex: Number.isFinite(progress.activeLiftIndex) ? progress.activeLiftIndex : participant.progress.activeLiftIndex,
    currentLiftName: typeof progress.currentLiftName === 'string' ? progress.currentLiftName : participant.progress.currentLiftName,
    completedSets: Number.isFinite(progress.completedSets) ? progress.completedSets : participant.progress.completedSets,
    totalSets: Number.isFinite(progress.totalSets) ? progress.totalSets : participant.progress.totalSets,
    status: ['active', 'paused', 'finished', 'deleted'].includes(progress.status) ? progress.status : participant.progress.status,
    updatedAt: new Date().toISOString(),
  };

  session.updatedAt = new Date().toISOString();
  session.version += 1;
  if (session.participants.some((entry) => entry.progress.status === 'finished')) {
    session.status = 'finished';
  }
  await saveWorkoutData('workout-sessions.json', store);

  return NextResponse.json({ success: true, version: session.version });
}
