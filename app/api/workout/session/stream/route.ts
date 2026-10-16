import { getWorkoutData } from '@/lib/workout/data';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { roomEventStream } from '@/lib/party/sse';
import { sessionChannel, SESSIONS_FILE, type SessionStore } from '@/lib/workout/shared-session';

export const dynamic = 'force-dynamic';

/**
 * Live view of a shared workout for one participant (server-sent events):
 * re-sent whenever either partner's progress changes, so the other phone
 * updates straight away instead of polling.
 */
export async function GET(request: Request) {
  const userId = await getAuthenticatedWorkoutUserId();
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const sessionId = new URL(request.url).searchParams.get('id');
  if (!sessionId) return new Response('Missing session id', { status: 400 });

  return roomEventStream(request, sessionChannel(sessionId), async () => {
    const store = await getWorkoutData<SessionStore>(SESSIONS_FILE, { sessions: [] });
    const session = (store.sessions || []).find((entry) => entry.id === sessionId);
    if (!session) return { payload: { error: 'Session not found' }, close: true };
    if (!session.participants.some((entry) => entry.userId === userId)) return { payload: { error: 'Forbidden' }, close: true };
    const peer = session.participants.find((entry) => entry.userId !== userId) || null;
    return {
      payload: {
        session: { id: session.id, code: session.code, status: session.status, version: session.version },
        peer: peer ? { username: peer.username, progress: peer.progress } : null,
      },
    };
  });
}
