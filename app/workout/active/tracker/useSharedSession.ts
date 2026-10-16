'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { vibrate } from '@/lib/workout/device-prefs';

export type PeerProgress = {
  currentLiftName?: string;
  completedSets?: number;
  totalSets?: number;
  status?: 'active' | 'paused' | 'finished' | 'deleted';
  currentWeight?: number;
  currentReps?: number;
  lastSet?: { weight: number; reps: number; at: number; liftName?: string } | null;
  restingSince?: number | null;
};
export type Peer = { username: string; progress: PeerProgress } | null;
export type ProgressUpdate = Omit<PeerProgress, 'status'> & { activeLiftIndex: number; status?: PeerProgress['status'] };

type Options = {
  userId?: string;
  initialSessionId?: string | null;
  initialCode?: string | null;
  /** Shared when creating the session, so the partner can join with the same lifts. */
  planTemplate: () => Record<string, unknown>;
  /** The partner just finished a set (e.g. "your turn" on a shared machine). */
  onPeerSet?: (peer: NonNullable<Peer>) => void;
};

/**
 * Partner mode: invite with a 3-letter code, then each phone streams its
 * progress to the other. Updates arrive live (server-sent events) and fall
 * back to polling if the stream can't stay open.
 */
export function useSharedSession({ userId, initialSessionId, initialCode, planTemplate, onPeerSet }: Options) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [code, setCode] = useState<string | null>(initialCode || null);
  const [peer, setPeer] = useState<Peer>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const lastPeerSetAt = useRef<number | null>(null);
  const onPeerSetRef = useRef(onPeerSet);
  useEffect(() => { onPeerSetRef.current = onPeerSet; });

  useEffect(() => { if (initialSessionId) setSessionId(initialSessionId); }, [initialSessionId]);

  const receive = useCallback((data: any) => {
    if (!data || data.error) return;
    if (data.session?.code) setCode(data.session.code);
    const next: Peer = data.peer ? { username: data.peer.username || 'Partner', progress: data.peer.progress || {} } : null;
    setPeer(next);
    const at = next?.progress.lastSet?.at ?? null;
    if (next && at && lastPeerSetAt.current !== null && at > lastPeerSetAt.current) {
      vibrate([60, 40, 60]);
      onPeerSetRef.current?.(next);
    }
    if (at) lastPeerSetAt.current = at;
    else if (lastPeerSetAt.current === null) lastPeerSetAt.current = 0;
  }, []);

  // Live stream, with polling while it's down.
  useEffect(() => {
    if (!sessionId) return;
    let poller: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const response = await fetch(`/api/workout/session?id=${encodeURIComponent(sessionId)}`);
        const data = await response.json();
        if (data.success) receive({ session: data.session, peer: data.peer });
      } catch { /* offline: try again next tick */ }
    };
    const startPolling = () => { if (!poller) { poll(); poller = setInterval(poll, 5000); } };
    const stopPolling = () => { if (poller) { clearInterval(poller); poller = null; } };

    let source: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(`/api/workout/session/stream?id=${encodeURIComponent(sessionId)}`);
      source.onmessage = (event) => {
        setLive(true);
        stopPolling();
        try { receive(JSON.parse(event.data)); } catch { /* ignore a bad frame */ }
      };
      source.onerror = () => { setLive(false); startPolling(); };
    } else {
      startPolling();
    }
    return () => { source?.close(); stopPolling(); };
  }, [sessionId, receive]);

  const push = useCallback(async (progress: ProgressUpdate) => {
    if (!sessionId) return;
    try {
      await fetch('/api/workout/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, progress }),
      });
    } catch {
      // The next update carries the same state; nothing to retry.
    }
  }, [sessionId]);

  const start = useCallback(async (progress: ProgressUpdate) => {
    if (!userId) { setError('Partner mode needs you to be logged in.'); return; }
    if (sessionId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/workout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', planTemplate: planTemplate(), progress }),
      });
      const data = await response.json();
      if (!data.success || !data.sessionId) throw new Error(data.message || 'Could not start partner mode.');
      setSessionId(data.sessionId);
      setCode(data.code || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start partner mode.');
    } finally {
      setLoading(false);
    }
  }, [userId, sessionId, planTemplate]);

  /** Leave the session (the partner sees you as gone); the workout carries on solo. */
  const leave = useCallback(async (progress: ProgressUpdate) => {
    await push({ ...progress, status: 'deleted' });
    setSessionId(null);
    setCode(null);
    setPeer(null);
  }, [push]);

  const inviteLink = code && typeof window !== 'undefined' ? `${window.location.origin}/workout?join=${code}` : '';

  return { sessionId, code, peer, live, loading, error, push, start, leave, inviteLink };
}
