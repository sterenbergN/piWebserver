import { emitStateUpdate } from '@/lib/party/emitter';

// Shared ("partner") workout sessions: storage shape and the live-update
// channel used by app/api/workout/session and its /stream endpoint.

export type ParticipantProgress = {
  activeLiftIndex: number;
  currentLiftName: string;
  completedSets: number;
  totalSets: number;
  status: 'active' | 'paused' | 'finished' | 'deleted';
  updatedAt: string;
  /** Weight × reps the participant has dialed in for their next set. */
  currentWeight?: number;
  currentReps?: number;
  lastSet?: { weight: number; reps: number; at: number; liftName?: string } | null;
  /** When the participant's current rest started (ms), so the partner can see it. */
  restingSince?: number | null;
};

export type SessionParticipant = {
  userId: string;
  username: string;
  joinedAt: string;
  progress: ParticipantProgress;
};

export type SharedSession = {
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

export type SessionStore = { sessions: SharedSession[] };

export const SESSIONS_FILE = 'workout-sessions.json';

export const sessionChannel = (sessionId: string) => `workout-session-${sessionId}`;

/** Tell open /stream connections that this session changed. */
export function notifySessionChanged(sessionId: string) {
  emitStateUpdate(sessionChannel(sessionId));
}
