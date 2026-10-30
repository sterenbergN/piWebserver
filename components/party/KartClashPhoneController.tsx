'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { KartTelemetrySnapshot, KartItemType } from '@/lib/party/kart-physics';

interface Props {
  state: any;
  roomCode: string;
  playerKey: string;
  hostId: string | null;
  sendAction: (action: Record<string, any>) => void;
  sendHostAction: (action: Record<string, any>) => void;
}

const ITEM_META: Record<KartItemType, { emoji: string; label: string; color: string; hint: string }> = {
  mushroom: { emoji: '🍄', label: 'Turbo Mushroom', color: '#ef4444', hint: 'Tap for instant speed burst!' },
  green_shell: { emoji: '🟢', label: 'Green Shell', color: '#22c55e', hint: 'Fires straight & ricochets off walls!' },
  red_shell: { emoji: '🔴', label: 'Homing Red Shell', color: '#f97316', hint: 'Hunts down the racer ahead of you!' },
  banana: { emoji: '🍌', label: 'Banana Peel', color: '#facc15', hint: 'Drops behind your kart to spin tailgaters!' },
  lightning: { emoji: '⚡', label: 'Lightning Bolt', color: '#fde047', hint: 'Zaps & shrinks every rival on the track!' },
  star: { emoji: '⭐', label: 'Super Star', color: '#fbbf24', hint: 'Invincible turbo rampage — ram anyone!' },
};

const ROULETTE_EMOJIS = ['🍄', '🟢', '🔴', '🍌', '⚡', '⭐'];

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export default function KartClashPhoneController({
  state,
  roomCode,
  playerKey,
  hostId,
  sendAction,
  sendHostAction,
}: Props) {
  const phase: string = state?.phase || '';
  const pd = state?.data || {};
  const hd = state?.hostData || {};
  const meId: string = state?.me?.id || '';

  // Gyro state
  const [gyroStatus, setGyroStatus] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [steerValue, setSteerValue] = useState<number>(0);
  const [isDrifting, setIsDrifting] = useState<boolean>(false);
  const [isBraking, setIsBraking] = useState<boolean>(false);
  const [itemPressed, setItemPressed] = useState<boolean>(false);
  const [rouletteIdx, setRouletteIdx] = useState<number>(0);

  // Selected racer for VIP host heat swapping on phone
  const [selectedRacerId, setSelectedRacerId] = useState<string | null>(null);

  // Live 10Hz snapshot from /api/party/stream/kart
  const [snapshot, setSnapshot] = useState<KartTelemetrySnapshot | null>(hd?.initialSnapshot || null);

  // Refs for high-frequency gyro & network loop
  const steerRef = useRef<number>(0);
  const driftRef = useRef<boolean>(false);
  const brakeRef = useRef<boolean>(false);
  const useItemRef = useRef<boolean>(false);
  const rawAngleRef = useRef<number>(0);
  const neutralOffsetRef = useRef<number>(0);
  const draggingTouchRef = useRef<boolean>(false);
  const wheelBoxRef = useRef<HTMLDivElement | null>(null);
  const prevSpinRef = useRef<number>(0);
  const prevBoostRef = useRef<number>(0);

  // Send input packet to zero-disk-I/O endpoint
  const transmitInput = useCallback(
    (override?: Partial<{ steer: number; drift: boolean; useItem: boolean; brake: boolean }>) => {
      const payload = {
        roomCode,
        playerKey,
        steer: override?.steer !== undefined ? override.steer : steerRef.current,
        drift: override?.drift !== undefined ? override.drift : driftRef.current,
        useItem: override?.useItem !== undefined ? override.useItem : useItemRef.current,
        brake: override?.brake !== undefined ? override.brake : brakeRef.current,
      };
      fetch('/api/party/kart-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    },
    [roomCode, playerKey],
  );

  // Request iOS 13+ DeviceOrientation permission or verify support
  const enableGyro = useCallback(async () => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setGyroStatus('unsupported');
      return;
    }
    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof doe.requestPermission === 'function') {
      try {
        const res = await doe.requestPermission();
        if (res === 'granted') {
          setGyroStatus('granted');
          neutralOffsetRef.current = rawAngleRef.current;
        } else {
          setGyroStatus('denied');
        }
      } catch {
        setGyroStatus('denied');
      }
    } else {
      setGyroStatus('granted');
      neutralOffsetRef.current = rawAngleRef.current;
    }
  }, []);

  // Attach DeviceOrientation listener whenever granted or on non-iOS browsers
  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof doe.requestPermission !== 'function' && gyroStatus === 'unknown') {
      setGyroStatus('granted');
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (draggingTouchRef.current) return;
      // Detect whether phone is held in landscape or portrait
      const screenAngle =
        typeof window.screen?.orientation?.angle === 'number'
          ? window.screen.orientation.angle
          : typeof (window as any).orientation === 'number'
            ? (window as any).orientation
            : window.innerWidth > window.innerHeight
              ? 90
              : 0;

      let tiltDeg = 0;
      if (screenAngle === 90) {
        // Landscape primary: beta tilts left/right like a steering wheel
        tiltDeg = e.beta ?? 0;
      } else if (screenAngle === -90 || screenAngle === 270) {
        // Landscape secondary: inverted beta
        tiltDeg = -(e.beta ?? 0);
      } else {
        // Portrait mode: gamma tilts left/right
        tiltDeg = e.gamma ?? 0;
      }

      rawAngleRef.current = tiltDeg;
      const calibrated = tiltDeg - neutralOffsetRef.current;
      const deadzone = 2.5;
      const maxAngle = 28;
      let norm = 0;
      if (Math.abs(calibrated) > deadzone) {
        const sign = Math.sign(calibrated);
        norm = (sign * (Math.abs(calibrated) - deadzone)) / (maxAngle - deadzone);
      }
      const clamped = Math.max(-1, Math.min(1, norm));
      steerRef.current = clamped;
      setSteerValue(clamped);
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleOrientation, true);
  }, [gyroStatus]);

  // Recenter steering wheel neutral angle
  const recenterGyro = useCallback(() => {
    neutralOffsetRef.current = rawAngleRef.current;
    steerRef.current = 0;
    setSteerValue(0);
    transmitInput({ steer: 0 });
    try {
      navigator.vibrate?.(20);
    } catch {}
  }, [transmitInput]);

  // Subscribe to 10Hz telemetry stream during RACING
  useEffect(() => {
    if (phase !== 'RACING') return;
    const es = new EventSource(`/api/party/stream/kart?roomCode=${roomCode}&role=player`);
    es.onmessage = (evt) => {
      try {
        const snap: KartTelemetrySnapshot = JSON.parse(evt.data);
        setSnapshot(snap);
      } catch {}
    };
    return () => es.close();
  }, [phase, roomCode]);

  // Continuous 18Hz steering transmitter while racing
  useEffect(() => {
    if (phase !== 'RACING' || !pd?.isRacing) return;
    let lastSentSteer = 0;
    const interval = setInterval(() => {
      const diff = Math.abs(steerRef.current - lastSentSteer);
      if (diff >= 0.02 || driftRef.current || brakeRef.current || useItemRef.current) {
        lastSentSteer = steerRef.current;
        transmitInput();
        if (useItemRef.current) {
          useItemRef.current = false;
          setItemPressed(false);
        }
      }
    }, 55);
    return () => clearInterval(interval);
  }, [phase, pd?.isRacing, transmitInput]);

  // Spin roulette emoji animation & haptic feedback on spinout / boost
  const myKart = snapshot?.karts?.find((k) => k.id === meId) || null;
  useEffect(() => {
    if (!myKart) return;
    if (myKart.spinOutTimer > 0 && prevSpinRef.current === 0) {
      try {
        navigator.vibrate?.([90, 40, 110]);
      } catch {}
    }
    if (myKart.boostTimer > prevBoostRef.current + 0.25) {
      try {
        navigator.vibrate?.(45);
      } catch {}
    }
    prevSpinRef.current = myKart.spinOutTimer;
    prevBoostRef.current = myKart.boostTimer;
  }, [myKart]);

  useEffect(() => {
    if (!myKart || !myKart.itemRoulette) return;
    const id = setInterval(() => {
      setRouletteIdx((prev) => (prev + 1) % ROULETTE_EMOJIS.length);
    }, 90);
    return () => clearInterval(id);
  }, [myKart?.itemRoulette]);

  // Touch-drag steering on the steering wheel (fallback or hybrid control)
  const updateTouchSteer = (clientX: number) => {
    const box = wheelBoxRef.current?.getBoundingClientRect();
    if (!box) return;
    const center = box.left + box.width / 2;
    const halfWidth = Math.max(60, box.width * 0.44);
    const norm = Math.max(-1, Math.min(1, (clientX - center) / halfWidth));
    steerRef.current = norm;
    setSteerValue(norm);
  };

  // ============================================================================
  // PHASE 1: HEAT_SETUP (Tournament Bracket & Heat Manager)
  // ============================================================================
  if (phase === 'HEAT_SETUP') {
    const heats: any[] = hd?.heats || [];
    const nextHeatId: string | null = hd?.nextHeatId || pd?.nextHeatId || null;
    const myHeatName: string | null = pd?.myHeatName || null;

    const handleRacerTap = (pid: string, heatId: string) => {
      if (!hostId) return;
      if (!selectedRacerId) {
        setSelectedRacerId(pid);
      } else if (selectedRacerId === pid) {
        setSelectedRacerId(null);
      } else {
        // Assign first selected racer into this racer's heat (swapping them)
        sendHostAction({ type: 'ASSIGN_HEAT_PLAYER', targetPlayerId: selectedRacerId, targetHeatId: heatId });
        setSelectedRacerId(null);
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
        {/* Player's Assigned Heat Banner */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(59,130,246,0.12))',
            border: '2px solid rgba(56,189,248,0.45)',
            borderRadius: '18px',
            padding: '1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            🔥 Tournament Heats Lineup
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f8fafc', marginTop: '0.2rem' }}>
            {myHeatName ? `You are in ${myHeatName}` : 'Waiting for Heat Assignment'}
          </div>
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: '0.3rem 0 0' }}>
            Top finishers in each Qualifying Heat advance to the 🏆 Championship Final!
          </p>
        </div>

        {/* Gyro Pre-Check Button */}
        <button
          onClick={enableGyro}
          style={{
            width: '100%',
            padding: '0.8rem 1rem',
            borderRadius: '14px',
            border: gyroStatus === 'granted' ? '1.5px solid rgba(34,197,94,0.5)' : '1.5px solid rgba(250,204,21,0.5)',
            background: gyroStatus === 'granted' ? 'rgba(34,197,94,0.14)' : 'rgba(250,204,21,0.14)',
            color: gyroStatus === 'granted' ? '#4ade80' : '#fde047',
            fontWeight: 800,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          {gyroStatus === 'granted'
            ? '✅ Tilt Steering Calibrated & Ready (Tap to Recenter)'
            : '🛞 Tap to Enable Gyro Tilt Steering'}
        </button>

        {/* VIP Host Tournament Controls on Phone */}
        {hostId && (
          <div
            style={{
              background: 'rgba(15,23,42,0.85)',
              border: '1.5px solid rgba(56,189,248,0.35)',
              borderRadius: '16px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                👑 Host Heat Controls
              </span>
              {selectedRacerId && (
                <span style={{ fontSize: '0.72rem', color: '#facc15', fontWeight: 700 }}>
                  Tap another racer or heat to move!
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => sendHostAction({ type: 'RANDOMIZE_HEATS' })}
                style={{
                  flex: 1,
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(56,189,248,0.45)',
                  background: 'rgba(56,189,248,0.16)',
                  color: '#38bdf8',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                🎲 Randomize
              </button>
              {[2, 4, 8].map((sz) => (
                <button
                  key={sz}
                  onClick={() => sendHostAction({ type: 'SET_KART_CONFIG', heatSize: sz })}
                  style={{
                    padding: '0.55rem 0.65rem',
                    borderRadius: '10px',
                    border: hd?.heatSize === sz ? '1.5px solid #facc15' : '1px solid rgba(255,255,255,0.14)',
                    background: hd?.heatSize === sz ? 'rgba(250,204,21,0.18)' : 'rgba(255,255,255,0.05)',
                    color: hd?.heatSize === sz ? '#fde047' : '#cbd5e1',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  {sz}/Heat
                </button>
              ))}
              <button
                onClick={() => sendHostAction({ type: 'SET_KART_CONFIG', aiBots: !hd?.aiBots })}
                style={{
                  padding: '0.55rem 0.65rem',
                  borderRadius: '10px',
                  border: hd?.aiBots ? '1.5px solid rgba(34,197,94,0.45)' : '1px solid rgba(255,255,255,0.14)',
                  background: hd?.aiBots ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                  color: hd?.aiBots ? '#4ade80' : '#94a3b8',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                🤖 Bots: {hd?.aiBots ? 'ON' : 'OFF'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.45rem' }}>
              <button
                onClick={() => sendHostAction({ type: 'ADD_CUSTOM_HEAT' })}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#e2e8f0',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                ➕ Add Heat
              </button>
              {hd?.canBuildFinals && (
                <button
                  onClick={() => sendHostAction({ type: 'BUILD_FINALS_HEAT', includeConsolation: true })}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(250,204,21,0.5)',
                    background: 'rgba(250,204,21,0.18)',
                    color: '#fde047',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  🏆 Seed Finals
                </button>
              )}
            </div>
          </div>
        )}

        {/* Heats List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {heats.map((heat: any) => {
            const isNext = heat.id === nextHeatId;
            return (
              <div
                key={heat.id}
                onClick={() => {
                  if (hostId && selectedRacerId && heat.status === 'pending') {
                    sendHostAction({ type: 'ASSIGN_HEAT_PLAYER', targetPlayerId: selectedRacerId, targetHeatId: heat.id });
                    setSelectedRacerId(null);
                  }
                }}
                style={{
                  background: isNext ? 'rgba(6,182,212,0.12)' : 'rgba(15,23,42,0.75)',
                  border: isNext ? '2px solid #06b6d4' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '14px',
                  padding: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <span style={{ fontWeight: 900, fontSize: '0.92rem', color: '#f8fafc' }}>
                    {heat.stage === 'final' ? '🏆 ' : '🏁 '}
                    {heat.name}
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      background: heat.status === 'completed' ? 'rgba(34,197,94,0.2)' : isNext ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.08)',
                      color: heat.status === 'completed' ? '#4ade80' : isNext ? '#22d3ee' : '#94a3b8',
                    }}
                  >
                    {heat.status === 'completed' ? 'DONE' : isNext ? 'UP NEXT' : 'PENDING'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {(heat.playerIds || []).map((pid: string) => {
                    const p = state.players?.[pid];
                    if (!p) return null;
                    const isSelected = selectedRacerId === pid;
                    const isMe = pid === meId;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (heat.status === 'pending') handleRacerTap(pid, heat.id);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '999px',
                          border: isSelected
                            ? '2px solid #facc15'
                            : isMe
                              ? '1.5px solid #38bdf8'
                              : '1px solid rgba(255,255,255,0.12)',
                          background: isSelected
                            ? 'rgba(250,204,21,0.22)'
                            : isMe
                              ? 'rgba(56,189,248,0.2)'
                              : 'rgba(255,255,255,0.06)',
                          color: '#f8fafc',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: hostId && heat.status === 'pending' ? 'pointer' : 'default',
                        }}
                      >
                        <span>{p.avatar || '🏎️'}</span>
                        <span>{p.name}</span>
                      </button>
                    );
                  })}
                </div>

                {hostId && heat.status === 'pending' && (heat.playerIds?.length || 0) > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendHostAction({ type: 'START_NEXT_HEAT', heatId: heat.id });
                    }}
                    style={{
                      marginTop: '0.6rem',
                      width: '100%',
                      padding: '0.6rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
                      color: '#fff',
                      fontWeight: 900,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    🚦 Launch {heat.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ============================================================================
  // PHASE 2: TRACK_VOTE (Course Selection + Gyro Calibration OR Pit Crew Bet)
  // ============================================================================
  if (phase === 'TRACK_VOTE') {
    const isRacing = Boolean(pd?.isRacing);
    const tracks: any[] = pd?.tracks || hd?.tracks || [];
    const votedTrackId: string | null = pd?.votedTrackId || null;
    const predictedWinnerId: string | null = pd?.predictedWinnerId || null;
    const activeRacers: any[] = pd?.activeRacers || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', width: '100%' }}>
        {/* Header */}
        <div
          style={{
            background: 'rgba(15,23,42,0.85)',
            border: '1.5px solid rgba(56,189,248,0.35)',
            borderRadius: '16px',
            padding: '0.9rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {pd?.heatName || hd?.heatName || 'Grand Prix'}
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#f8fafc', marginTop: '0.2rem' }}>
            {isRacing ? '🗳️ Vote for the Track!' : '🔮 Pit Crew Prediction'}
          </div>
          {!isRacing && pd?.myUpcomingHeatName && (
            <div style={{ fontSize: '0.78rem', color: '#facc15', fontWeight: 700, marginTop: '0.25rem' }}>
              You race soon in {pd.myUpcomingHeatName}!
            </div>
          )}
        </div>

        {/* Gyro Calibration Banner for Active Racers */}
        {isRacing && (
          <div
            style={{
              background: 'rgba(15,23,42,0.9)',
              border: gyroStatus === 'granted' ? '1.5px solid rgba(34,197,94,0.45)' : '2px solid #facc15',
              borderRadius: '16px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#e2e8f0' }}>
                🛞 Gyro Steering Check
              </span>
              <button
                type="button"
                onClick={gyroStatus === 'granted' ? recenterGyro : enableGyro}
                style={{
                  padding: '0.38rem 0.75rem',
                  borderRadius: '999px',
                  border: 'none',
                  background: gyroStatus === 'granted' ? 'rgba(56,189,248,0.22)' : '#facc15',
                  color: gyroStatus === 'granted' ? '#38bdf8' : '#0f172a',
                  fontWeight: 900,
                  fontSize: '0.76rem',
                  cursor: 'pointer',
                }}
              >
                {gyroStatus === 'granted' ? '🎯 Recenter Wheel' : '🔓 Enable Tilt Steering'}
              </button>
            </div>

            {/* Live tilt gauge */}
            <div
              style={{
                width: '100%',
                height: '12px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: '999px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: 'rgba(255,255,255,0.35)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '1px',
                  bottom: '1px',
                  width: '22px',
                  borderRadius: '999px',
                  background: '#38bdf8',
                  left: `calc(${50 + steerValue * 44}% - 11px)`,
                  transition: 'left 60ms linear',
                }}
              />
            </div>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              Tilt your phone like a steering wheel (or drag the wheel during the race)
            </span>
          </div>
        )}

        {/* Track Voting Cards (for Active Racers) */}
        {isRacing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            {tracks.map((t: any) => {
              const selected = votedTrackId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => sendAction({ type: 'VOTE_TRACK', trackId: t.id })}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.9rem 0.65rem',
                    borderRadius: '16px',
                    border: selected ? '2.5px solid #38bdf8' : '1.5px solid rgba(255,255,255,0.12)',
                    background: selected
                      ? 'linear-gradient(135deg, rgba(6,182,212,0.28), rgba(37,99,235,0.22))'
                      : 'rgba(15,23,42,0.8)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: '2rem' }}>{t.emoji}</span>
                  <span style={{ fontWeight: 900, fontSize: '0.92rem' }}>{t.name}</span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.25 }}>{t.tagline}</span>
                  <span
                    style={{
                      marginTop: '0.2rem',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      background: selected ? '#38bdf8' : 'rgba(255,255,255,0.08)',
                      color: selected ? '#0f172a' : '#cbd5e1',
                    }}
                  >
                    {selected ? '✓ VOTED' : t.difficulty}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          /* Pit Crew Winner Prediction Cards (for Non-Racing Tournament Players) */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', textAlign: 'center' }}>
              Call the winner of this heat for a <strong>+300 pt Pit Crew Bonus</strong>!
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem' }}>
              {activeRacers.map((r: any) => {
                const picked = predictedWinnerId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => sendAction({ type: 'SUBMIT_HEAT_PREDICTION', racerId: r.id })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.75rem',
                      borderRadius: '14px',
                      border: picked ? '2px solid #facc15' : '1.5px solid rgba(255,255,255,0.12)',
                      background: picked ? 'rgba(250,204,21,0.2)' : 'rgba(15,23,42,0.8)',
                      color: '#f8fafc',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '1.4rem' }}>{r.avatar || '🏎️'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {hostId && (
          <button
            type="button"
            onClick={() => sendHostAction({ type: 'LOCK_TRACK_VOTE' })}
            style={{
              padding: '0.7rem',
              borderRadius: '12px',
              border: '1px solid rgba(56,189,248,0.45)',
              background: 'rgba(56,189,248,0.15)',
              color: '#38bdf8',
              fontWeight: 800,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            👑 Lock Track Vote & Start Engines
          </button>
        )}
      </div>
    );
  }

  // ============================================================================
  // PHASE 3: RACING (Gyro Steering Wheel Controller OR Pit Crew Chaos Console)
  // ============================================================================
  if (phase === 'RACING') {
    const isRacing = Boolean(pd?.isRacing);

    // PIT CREW CONSOLE (for players waiting in Tournament Heats)
    if (!isRacing) {
      const predictedWinnerId: string | null = pd?.predictedWinnerId || null;
      const chaosVote: string | null = pd?.chaosVote || null;
      const chaosTriggered = Boolean(pd?.chaosTriggered || hd?.chaosTriggered || snapshot?.announcement);
      const activeRacers: any[] = pd?.activeRacers || [];
      const sortedKarts = [...(snapshot?.karts || [])].sort((a, b) => a.rank - b.rank);

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(15,23,42,0.9))',
              border: '1.5px solid rgba(250,204,21,0.4)',
              borderRadius: '16px',
              padding: '0.85rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#facc15', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              🎧 Pit Crew Telemetry • {pd?.heatName || 'Live Heat'}
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc', marginTop: '0.2rem' }}>
              {pd?.trackName || 'Track Live'}
            </div>
            {pd?.myUpcomingHeatName && (
              <div style={{ fontSize: '0.76rem', color: '#38bdf8', fontWeight: 700, marginTop: '0.2rem' }}>
                Get ready — you race in {pd.myUpcomingHeatName}!
              </div>
            )}
          </div>

          {/* Mid-Race Chaos Drop Vote */}
          <div
            style={{
              background: 'rgba(15,23,42,0.88)',
              border: '1.5px solid rgba(168,85,247,0.45)',
              borderRadius: '16px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 900, color: '#d8b4fe', textAlign: 'center' }}>
              {chaosTriggered
                ? `💥 Chaos Drop Unleashed: ${snapshot?.announcement || 'Active!'}`
                : '🎁 Vote on the Mid-Race Chaos Drop!'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.45rem' }}>
              {[
                { id: 'bananas', emoji: '🍌', label: 'Banana Shower' },
                { id: 'item-boxes', emoji: '📦', label: 'Mystery Boxes' },
                { id: 'boost-pack', emoji: '⚡', label: 'Pack Turbo' },
              ].map((opt) => {
                const picked = chaosVote === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={chaosTriggered}
                    onClick={() => sendAction({ type: 'SUBMIT_CHAOS_VOTE', choice: opt.id })}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.65rem 0.4rem',
                      borderRadius: '12px',
                      border: picked ? '2px solid #c084fc' : '1px solid rgba(255,255,255,0.12)',
                      background: picked ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)',
                      color: '#f8fafc',
                      fontWeight: 800,
                      fontSize: '0.74rem',
                      cursor: chaosTriggered ? 'default' : 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '1.4rem' }}>{opt.emoji}</span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Winner Prediction (if not yet locked in) */}
          <div
            style={{
              background: 'rgba(15,23,42,0.85)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '16px',
              padding: '0.8rem',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fde047', marginBottom: '0.5rem', textAlign: 'center' }}>
              🔮 Pit Crew Winner Pick (+300 pts)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
              {activeRacers.map((r: any) => {
                const picked = predictedWinnerId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => sendAction({ type: 'SUBMIT_HEAT_PREDICTION', racerId: r.id })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.55rem 0.65rem',
                      borderRadius: '10px',
                      border: picked ? '2px solid #facc15' : '1px solid rgba(255,255,255,0.12)',
                      background: picked ? 'rgba(250,204,21,0.2)' : 'rgba(255,255,255,0.05)',
                      color: '#f8fafc',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{r.avatar || '🏎️'}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Live Race Standings Feed */}
          {sortedKarts.length > 0 && (
            <div
              style={{
                background: 'rgba(15,23,42,0.85)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '14px',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
              }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                Live Track Standings
              </div>
              {sortedKarts.map((k) => (
                <div
                  key={k.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.35rem 0.5rem',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.04)',
                    fontSize: '0.82rem',
                  }}
                >
                  <span style={{ fontWeight: 800, color: k.rank === 1 ? '#facc15' : '#e2e8f0' }}>
                    {ordinal(k.rank)} • {k.avatar} {k.name}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700 }}>
                    {k.finished ? '🏁 FINISHED' : `Lap ${Math.min(3, Math.max(1, k.lap))}/3`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ACTIVE RACER GYRO STEERING WHEEL COCKPIT
    const isCountdown = (snapshot?.countdownMs || 0) > 0;
    const countdownSec = isCountdown ? Math.ceil((snapshot?.countdownMs || 0) / 1000) : 0;
    const rank = myKart?.rank || 1;
    const lap = Math.min(snapshot?.totalLaps || 3, Math.max(1, myKart?.lap || 1));
    const speedKmh = Math.round((myKart?.speed || 0) * 2.2);
    const heldItem: KartItemType | null = myKart?.heldItem || null;
    const isRoulette = Boolean(myKart?.itemRoulette);
    const driftCharge = myKart?.driftLevel || 0;
    const isSpunOut = (myKart?.spinOutTimer || 0) > 0;
    const isStar = (myKart?.starTimer || 0) > 0;
    const isBoost = (myKart?.boostTimer || 0) > 0;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem',
          width: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Top Cockpit Telemetry Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            background: isStar
              ? 'linear-gradient(90deg, rgba(250,204,21,0.3), rgba(236,72,153,0.3), rgba(56,189,248,0.3))'
              : isSpunOut
                ? 'rgba(239,68,68,0.28)'
                : 'rgba(15,23,42,0.92)',
            border: isStar
              ? '2px solid #facc15'
              : isBoost
                ? '2px solid #38bdf8'
                : '1.5px solid rgba(255,255,255,0.14)',
            borderRadius: '16px',
            padding: '0.55rem 0.85rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
              POSITION
            </div>
            <div
              style={{
                fontSize: '1.55rem',
                fontWeight: 900,
                color: rank === 1 ? '#facc15' : rank === 2 ? '#e2e8f0' : rank === 3 ? '#fb923c' : '#38bdf8',
                lineHeight: 1.05,
              }}
            >
              {ordinal(rank)}
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            {isCountdown ? (
              <div
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 900,
                  color: countdownSec <= 2 ? '#facc15' : '#f8fafc',
                }}
              >
                🚦 {countdownSec > 0 ? `READY: ${countdownSec}` : 'GO!!'}
              </div>
            ) : myKart?.finished ? (
              <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#4ade80' }}>🏁 FINISHED!</div>
            ) : isSpunOut ? (
              <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#fca5a5' }}>💫 SPUN OUT!</div>
            ) : (
              <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#f8fafc' }}>
                LAP {lap}/{snapshot?.totalLaps || 3}
              </div>
            )}
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: isBoost ? '#38bdf8' : '#94a3b8' }}>
              {speedKmh} km/h {isBoost ? '🔥 BOOST' : ''}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <button
              type="button"
              onClick={gyroStatus === 'granted' ? recenterGyro : enableGyro}
              style={{
                padding: '0.35rem 0.6rem',
                borderRadius: '10px',
                border: '1px solid rgba(56,189,248,0.45)',
                background: 'rgba(56,189,248,0.16)',
                color: '#38bdf8',
                fontWeight: 800,
                fontSize: '0.7rem',
                cursor: 'pointer',
              }}
            >
              {gyroStatus === 'granted' ? '🎯 Center' : '🛞 Enable Gyro'}
            </button>
          </div>
        </div>

        {/* Interactive Rotating Steering Wheel + Touch Slider */}
        <div
          ref={wheelBoxRef}
          onPointerDown={(e) => {
            draggingTouchRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            updateTouchSteer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (!draggingTouchRef.current) return;
            updateTouchSteer(e.clientX);
          }}
          onPointerUp={() => {
            draggingTouchRef.current = false;
            steerRef.current = 0;
            setSteerValue(0);
            transmitInput({ steer: 0 });
          }}
          onPointerCancel={() => {
            draggingTouchRef.current = false;
            steerRef.current = 0;
            setSteerValue(0);
          }}
          style={{
            position: 'relative',
            background: 'radial-gradient(circle at center, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
            border:
              driftCharge === 2
                ? '2.5px solid #f97316'
                : driftCharge === 1
                  ? '2.5px solid #38bdf8'
                  : '1.5px solid rgba(255,255,255,0.14)',
            borderRadius: '20px',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.4rem',
            cursor: 'grab',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700 }}>
            <span>◀ LEFT</span>
            <span>{gyroStatus === 'granted' ? 'TILT PHONE OR DRAG WHEEL' : 'DRAG WHEEL TO STEER'}</span>
            <span>RIGHT ▶</span>
          </div>

          {/* SVG Racing Steering Wheel that rotates with steerValue */}
          <div
            style={{
              width: '126px',
              height: '126px',
              transform: `rotate(${steerValue * 68}deg)`,
              transition: draggingTouchRef.current ? 'none' : 'transform 55ms linear',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 120 120" width="122" height="122">
              {/* Outer Grip Ring */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke={driftCharge === 2 ? '#f97316' : driftCharge === 1 ? '#38bdf8' : '#334155'}
                strokeWidth="14"
              />
              {/* Top Center Stripe */}
              <path d="M 54 10 L 66 10 L 64 24 L 56 24 Z" fill="#ef4444" />
              {/* Wheel Spokes */}
              <line x1="16" y1="60" x2="104" y2="60" stroke="#475569" strokeWidth="9" strokeLinecap="round" />
              <line x1="60" y1="60" x2="60" y2="104" stroke="#475569" strokeWidth="9" strokeLinecap="round" />
              {/* Center Hub */}
              <circle cx="60" cy="60" r="18" fill="#0f172a" stroke="#38bdf8" strokeWidth="3" />
              <text x="60" y="66" textAnchor="middle" fontSize="16">
                {state?.me?.avatar || '🏎️'}
              </text>
            </svg>
          </div>

          {/* Horizontal Steer Bar Indicator */}
          <div
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.08)',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                width: '26px',
                borderRadius: '999px',
                background: driftCharge === 2 ? '#f97316' : '#38bdf8',
                left: `calc(${50 + steerValue * 44}% - 13px)`,
              }}
            />
          </div>
        </div>

        {/* Left & Right Thumb Arcade Action Pads */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
          {/* LEFT THUMB: ITEM BUTTON */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              useItemRef.current = true;
              setItemPressed(true);
              transmitInput({ useItem: true });
              try {
                navigator.vibrate?.(35);
              } catch {}
            }}
            style={{
              minHeight: '148px',
              borderRadius: '22px',
              border: heldItem
                ? `3px solid ${ITEM_META[heldItem].color}`
                : isRoulette
                  ? '3px solid #facc15'
                  : '2px dashed rgba(255,255,255,0.18)',
              background: itemPressed
                ? 'rgba(250,204,21,0.35)'
                : heldItem
                  ? 'linear-gradient(145deg, rgba(250,204,21,0.22), rgba(15,23,42,0.95))'
                  : 'rgba(15,23,42,0.85)',
              color: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.3rem',
              padding: '0.75rem',
              cursor: 'pointer',
              boxShadow: heldItem ? `0 0 24px ${ITEM_META[heldItem].color}44` : 'none',
            }}
          >
            <span style={{ fontSize: '2.7rem', lineHeight: 1 }}>
              {isRoulette ? ROULETTE_EMOJIS[rouletteIdx] : heldItem ? ITEM_META[heldItem].emoji : '🎁'}
            </span>
            <span style={{ fontWeight: 900, fontSize: '0.92rem' }}>
              {isRoulette ? 'ROLLING...' : heldItem ? ITEM_META[heldItem].label : 'NO ITEM'}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center' }}>
              {heldItem ? ITEM_META[heldItem].hint : 'Drive through rainbow boxes!'}
            </span>
          </button>

          {/* RIGHT THUMB: DRIFT / HOP / ROCKET START + BRAKE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                driftRef.current = true;
                setIsDrifting(true);
                transmitInput({ drift: true });
                try {
                  navigator.vibrate?.(25);
                } catch {}
              }}
              onPointerUp={() => {
                driftRef.current = false;
                setIsDrifting(false);
                transmitInput({ drift: false });
              }}
              onPointerCancel={() => {
                driftRef.current = false;
                setIsDrifting(false);
                transmitInput({ drift: false });
              }}
              style={{
                flex: 1,
                minHeight: '96px',
                borderRadius: '20px',
                border:
                  driftCharge === 2
                    ? '3px solid #f97316'
                    : driftCharge === 1
                      ? '3px solid #38bdf8'
                      : isDrifting
                        ? '2.5px solid #facc15'
                        : '2px solid rgba(56,189,248,0.45)',
                background:
                  driftCharge === 2
                    ? 'linear-gradient(135deg, rgba(249,115,22,0.42), rgba(239,68,68,0.32))'
                    : driftCharge === 1
                      ? 'linear-gradient(135deg, rgba(56,189,248,0.38), rgba(37,99,235,0.32))'
                      : isCountdown
                        ? 'linear-gradient(135deg, rgba(250,204,21,0.3), rgba(245,158,11,0.2))'
                        : isDrifting
                          ? 'rgba(56,189,248,0.28)'
                          : 'rgba(15,23,42,0.9)',
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.2rem',
                padding: '0.5rem',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>
                {isCountdown ? '🚀' : driftCharge === 2 ? '🔥' : driftCharge === 1 ? '⚡' : '💨'}
              </span>
              <span style={{ fontWeight: 900, fontSize: '0.9rem' }}>
                {isCountdown
                  ? 'ROCKET START'
                  : driftCharge === 2
                    ? 'SUPER TURBO READY!'
                    : driftCharge === 1
                      ? 'MINI-TURBO READY!'
                      : 'HOLD TO DRIFT'}
              </span>
              <span style={{ fontSize: '0.66rem', color: '#cbd5e1' }}>
                {isCountdown ? 'Hold on 2 for boost!' : 'Release after sparks for boost'}
              </span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                brakeRef.current = true;
                setIsBraking(true);
                transmitInput({ brake: true });
              }}
              onPointerUp={() => {
                brakeRef.current = false;
                setIsBraking(false);
                transmitInput({ brake: false });
              }}
              onPointerCancel={() => {
                brakeRef.current = false;
                setIsBraking(false);
                transmitInput({ brake: false });
              }}
              style={{
                height: '44px',
                borderRadius: '14px',
                border: isBraking ? '2px solid #ef4444' : '1.5px solid rgba(239,68,68,0.38)',
                background: isBraking ? 'rgba(239,68,68,0.32)' : 'rgba(239,68,68,0.12)',
                color: '#fca5a5',
                fontWeight: 900,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              🛑 BRAKE / REVERSE
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // PHASE 4: RACE_RESULTS (Post-Race Podium & Heat Advancement Summary)
  // ============================================================================
  if (phase === 'RACE_RESULTS') {
    const myRank: number | null = pd?.myRank || null;
    const myPoints: number = pd?.myPoints || 0;
    const qualified = Boolean(pd?.qualified);
    const wonPrediction = Boolean(pd?.wonPrediction);
    const topHumanName: string = pd?.topHumanName || 'Winner';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(15,23,42,0.92))',
            border: '2px solid rgba(56,189,248,0.45)',
            borderRadius: '18px',
            padding: '1.1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            🏁 {pd?.heatName || hd?.heatName || 'Race Complete'}
          </div>

          {myRank ? (
            <>
              <div style={{ fontSize: '2.3rem', fontWeight: 900, color: myRank === 1 ? '#facc15' : '#f8fafc', marginTop: '0.2rem' }}>
                {ordinal(myRank)} Place!
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4ade80', marginTop: '0.2rem' }}>
                +{myPoints} Cup Points
              </div>
              {qualified && (
                <div
                  style={{
                    marginTop: '0.55rem',
                    display: 'inline-block',
                    padding: '0.3rem 0.8rem',
                    borderRadius: '999px',
                    background: 'rgba(250,204,21,0.22)',
                    border: '1.5px solid #facc15',
                    color: '#fde047',
                    fontWeight: 900,
                    fontSize: '0.8rem',
                  }}
                >
                  🏆 QUALIFIED FOR THE CHAMPIONSHIP FINAL!
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f8fafc', marginTop: '0.3rem' }}>
                🏆 {topHumanName} took 1st Place!
              </div>
              {wonPrediction ? (
                <div style={{ fontSize: '1rem', fontWeight: 900, color: '#facc15', marginTop: '0.35rem' }}>
                  🔮 Pit Crew Prophet! +300 Bonus Points!
                </div>
              ) : (
                <div style={{ fontSize: '0.84rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                  Next heat coming right up!
                </div>
              )}
            </>
          )}
        </div>

        {hostId && (
          <button
            type="button"
            onClick={() => sendHostAction({ type: 'NEXT_KART_STEP' })}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '14px',
              border: 'none',
              background: 'linear-gradient(135deg, #06b6d4, #2563eb)',
              color: '#fff',
              fontWeight: 900,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            👑 Continue to Next Race / Heat →
          </button>
        )}
      </div>
    );
  }

  return null;
}
