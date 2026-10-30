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
  green_shell: { emoji: '🟢', label: 'Green Shell', color: '#22c55e', hint: 'Fires straight & ricochets!' },
  red_shell: { emoji: '🔴', label: 'Homing Red Shell', color: '#f97316', hint: 'Hunts down the racer ahead!' },
  banana: { emoji: '🍌', label: 'Banana Peel', color: '#facc15', hint: 'Drops behind your kart!' },
  lightning: { emoji: '⚡', label: 'Lightning Bolt', color: '#fde047', hint: 'Zaps & shrinks every rival!' },
  star: { emoji: '⭐', label: 'Super Star', color: '#fbbf24', hint: 'Invincible turbo rampage!' },
  spiny_shell: { emoji: '👑', label: 'Spiny Blue Shell', color: '#0284c7', hint: 'Tracks 1st place with blastwave!' },
  golden_mushroom: { emoji: '🏆', label: 'Golden Shroom', color: '#eab308', hint: 'Spam tap for continuous turbo!' },
  super_horn: { emoji: '📢', label: 'Super Horn', color: '#a855f7', hint: 'Shatters nearby karts & shells!' },
  fake_box: { emoji: '❓', label: 'Fake Item Box', color: '#ef4444', hint: 'Drops an explosive decoy box!' },
};

const ROULETTE_EMOJIS = ['🍄', '🟢', '🔴', '🍌', '⚡', '⭐', '👑', '🏆', '📢', '❓'];

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

  // Gyro & controller state
  const [gyroStatus, setGyroStatus] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [steerValue, setSteerValue] = useState<number>(0);
  const [isDrifting, setIsDrifting] = useState<boolean>(false);
  const [isBraking, setIsBraking] = useState<boolean>(false);
  const [itemPressed, setItemPressed] = useState<boolean>(false);
  const [isDraggingTouch, setIsDraggingTouch] = useState<boolean>(false);
  const [rouletteIdx, setRouletteIdx] = useState<number>(0);
  const [landscapeSide, setLandscapeSide] = useState<'left' | 'right'>('left');
  const [viewport, setViewport] = useState<{ top: number; left: number; w: number; h: number }>({
    top: 0,
    left: 0,
    w: 800,
    h: 450,
  });

  // Selected racer for VIP host heat swapping on phone
  const [selectedRacerId, setSelectedRacerId] = useState<string | null>(null);

  // Live 10Hz snapshot from /api/party/stream/kart
  const [snapshot, setSnapshot] = useState<KartTelemetrySnapshot | null>(hd?.initialSnapshot || null);

  // Refs for high-frequency gyro & network loop
  const steerRef = useRef<number>(0);
  const smoothedSteerRef = useRef<number>(0);
  const driftRef = useRef<boolean>(false);
  const brakeRef = useRef<boolean>(false);
  const useItemRef = useRef<boolean>(false);
  const rawAngleRef = useRef<number>(0);
  const neutralOffsetRef = useRef<number>(0);
  const landscapeSignRef = useRef<number>(1);
  const draggingTouchRef = useRef<boolean>(false);
  const wheelBoxRef = useRef<HTMLDivElement | null>(null);
  const prevSpinRef = useRef<number>(0);
  const prevBoostRef = useRef<number>(0);

  // Try locking the OS screen orientation to horizontal landscape
  const tryLockLandscape = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const ori = window.screen?.orientation as unknown as {
        lock?: (mode: string) => Promise<void>;
      };
      if (ori && typeof ori.lock === 'function') {
        ori.lock('landscape').catch(() => {});
      }
    } catch {}
  }, []);

  // Track visualViewport (exact unobstructed area below iOS Safari landscape tab bars)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateSize = () => {
      const vv = window.visualViewport;
      if (vv) {
        setViewport({
          top: Math.max(0, Math.round(vv.offsetTop)),
          left: Math.max(0, Math.round(vv.offsetLeft)),
          w: Math.max(240, Math.round(vv.width)),
          h: Math.max(180, Math.round(vv.height)),
        });
      } else {
        setViewport({
          top: 0,
          left: 0,
          w: window.innerWidth,
          h: window.innerHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', updateSize);
    window.visualViewport?.addEventListener('resize', updateSize);
    window.visualViewport?.addEventListener('scroll', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', updateSize);
      window.visualViewport?.removeEventListener('resize', updateSize);
      window.visualViewport?.removeEventListener('scroll', updateSize);
    };
  }, []);

  // Lock screen orientation to landscape and prevent iPhone Safari multi-touch pinch/scroll while racing
  useEffect(() => {
    if (phase === 'RACING' && pd?.isRacing) {
      tryLockLandscape();
      try {
        window.scrollTo(0, 0);
      } catch {}
      const prevOverflow = document.body.style.overflow;
      const prevTouchAction = document.documentElement.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.touchAction = 'none';
      const blockGesture = (event: Event) => event.preventDefault();
      const blockPinch = (event: TouchEvent) => {
        if (event.touches.length > 1) event.preventDefault();
      };
      document.addEventListener('gesturestart', blockGesture, { passive: false });
      document.addEventListener('gesturechange', blockGesture, { passive: false });
      document.addEventListener('touchmove', blockPinch, { passive: false });
      return () => {
        document.body.style.overflow = prevOverflow;
        document.documentElement.style.touchAction = prevTouchAction;
        document.removeEventListener('gesturestart', blockGesture);
        document.removeEventListener('gesturechange', blockGesture);
        document.removeEventListener('touchmove', blockPinch);
        try {
          const ori = window.screen?.orientation as unknown as { unlock?: () => void };
          ori?.unlock?.();
        } catch {}
      };
    }
  }, [phase, pd?.isRacing, tryLockLandscape]);

  const isDeviceHorizontal =
    viewport.w > viewport.h ||
    (typeof window !== 'undefined' &&
      Math.abs(window.screen?.orientation?.angle ?? (window as any).orientation ?? 0) === 90);

  // Send input packet to zero-disk-I/O endpoint (/api/party/kart-input)
  const transmitInput = useCallback(
    (override?: Partial<{ steer: number; drift: boolean; useItem: boolean; brake: boolean; isHorizontal: boolean }>) => {
      const isHorizontal =
        override?.isHorizontal !== undefined
          ? override.isHorizontal
          : (viewport.w > viewport.h || (typeof window !== 'undefined' && Math.abs(window.screen?.orientation?.angle ?? (window as any).orientation ?? 0) === 90));
      const input = {
        steer: override?.steer !== undefined ? override.steer : steerRef.current,
        drift: override?.drift !== undefined ? override.drift : driftRef.current,
        useItem: override?.useItem !== undefined ? override.useItem : useItemRef.current,
        brake: override?.brake !== undefined ? override.brake : brakeRef.current,
        isHorizontal,
      };
      const payload = {
        roomCode,
        playerId: playerKey,
        playerKey,
        input,
        ...input,
      };
      fetch('/api/party/kart-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    },
    [roomCode, playerKey, viewport.w, viewport.h],
  );

  // Immediately broadcast orientation whenever device rotates between portrait & landscape
  useEffect(() => {
    transmitInput({ isHorizontal: isDeviceHorizontal });
  }, [isDeviceHorizontal, transmitInput]);

  // Request iOS 13+ DeviceOrientation permission or verify support
  const enableGyro = useCallback(async () => {
    tryLockLandscape();
    getPhoneAudioCtx();
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
  }, [tryLockLandscape]);

  // Attach DeviceOrientation listener
  // Note: Per W3C DeviceOrientation spec, e.beta is ALWAYS rotation around the physical short X-axis of the phone.
  // When holding the phone horizontally like a steering wheel, steering left/right is ALWAYS e.beta,
  // even if the phone OS tries to flip the browser viewport to portrait!
  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof doe.requestPermission !== 'function' && gyroStatus === 'unknown') {
      setGyroStatus('granted');
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (draggingTouchRef.current) return;

      const screenAngle =
        typeof window.screen?.orientation?.angle === 'number'
          ? window.screen.orientation.angle
          : typeof (window as any).orientation === 'number'
            ? (window as any).orientation
            : 0;

      // During RACING (or when phone is held horizontally), always use e.beta (physical landscape steering wheel axis)
      // so OS portrait/landscape flips never break steering!
      const isHorizonLocked = phase === 'RACING' || Math.abs(screenAngle) === 90 || Math.abs(e.gamma ?? 0) > 22;

      let tiltDeg = 0;
      if (isHorizonLocked) {
        if (screenAngle === -90 || screenAngle === 270) {
          landscapeSignRef.current = -1;
        } else if (screenAngle === 90) {
          landscapeSignRef.current = 1;
        }
        tiltDeg = (e.beta ?? 0) * landscapeSignRef.current;
      } else {
        // Pre-race portrait preview fallback if holding phone upright in TRACK_VOTE
        tiltDeg = e.gamma ?? 0;
      }

      rawAngleRef.current = tiltDeg;
      const calibrated = tiltDeg - neutralOffsetRef.current;
      const deadzone = 3.5;
      const maxAngle = 28;
      let rawNorm = 0;
      if (Math.abs(calibrated) > deadzone) {
        const sign = Math.sign(calibrated);
        const linear = Math.min(1, (Math.abs(calibrated) - deadzone) / (maxAngle - deadzone));
        // Gentle non-linear curve for fine center control and confident full lock
        rawNorm = sign * Math.pow(linear, 1.28);
      }
      // Exponential low-pass filter to eliminate hand jitter
      const smoothed = smoothedSteerRef.current * 0.6 + rawNorm * 0.4;
      const clamped = Math.abs(smoothed) < 0.015 ? 0 : Math.max(-1, Math.min(1, smoothed));
      smoothedSteerRef.current = clamped;
      steerRef.current = clamped;
      setSteerValue(clamped);
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleOrientation, true);
  }, [gyroStatus, phase]);

  // Recenter steering wheel neutral angle
  const recenterGyro = useCallback(() => {
    tryLockLandscape();
    neutralOffsetRef.current = rawAngleRef.current;
    smoothedSteerRef.current = 0;
    steerRef.current = 0;
    setSteerValue(0);
    transmitInput({ steer: 0 });
    try {
      navigator.vibrate?.(20);
    } catch {}
  }, [transmitInput, tryLockLandscape]);

  // Flip horizontal orientation side (+90deg vs -90deg & invert beta sign)
  const flipLandscapeSide = useCallback(() => {
    tryLockLandscape();
    landscapeSignRef.current = -landscapeSignRef.current;
    neutralOffsetRef.current = -neutralOffsetRef.current;
    setLandscapeSide((prev) => (prev === 'left' ? 'right' : 'left'));
    try {
      navigator.vibrate?.(20);
    } catch {}
  }, [tryLockLandscape]);

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

  // Continuous 20Hz steering transmitter while racing (with periodic keepalive so server never misses steering)
  useEffect(() => {
    if (phase !== 'RACING' || !pd?.isRacing) return;
    let lastSentSteer = 0;
    let ticksSinceSend = 0;
    const interval = setInterval(() => {
      ticksSinceSend++;
      const diff = Math.abs(steerRef.current - lastSentSteer);
      if (
        diff >= 0.01 ||
        ticksSinceSend >= 5 ||
        driftRef.current ||
        brakeRef.current ||
        useItemRef.current
      ) {
        lastSentSteer = steerRef.current;
        ticksSinceSend = 0;
        transmitInput();
        if (useItemRef.current) {
          useItemRef.current = false;
          setItemPressed(false);
        }
      }
    }, 50);
    return () => clearInterval(interval);
  }, [phase, pd?.isRacing, transmitInput]);

  // Spin roulette emoji animation & haptic feedback on spinout / boost / drift tiers / incoming shell
  const myKart = snapshot?.karts?.find((k) => k.id === meId) || null;
  const prevDriftTierRef = useRef<number>(0);
  const prevIncomingShellRef = useRef<boolean>(false);
  const phoneAudioCtxRef = useRef<AudioContext | null>(null);

  const getPhoneAudioCtx = useCallback(() => {
    if (!phoneAudioCtxRef.current) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          phoneAudioCtxRef.current = new AudioCtx();
        }
      } catch {}
    }
    if (phoneAudioCtxRef.current && phoneAudioCtxRef.current.state === 'suspended') {
      phoneAudioCtxRef.current.resume().catch(() => {});
    }
    return phoneAudioCtxRef.current;
  }, []);

  // Synthesize pleasant two-tone horn on phone
  const playPhoneHorn = useCallback(() => {
    try {
      const ctx = getPhoneAudioCtx();
      if (!ctx) return;
      for (const freq of [440, 554]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        g.gain.setValueAtTime(0.12, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {}
  }, [getPhoneAudioCtx]);

  const triggerHonk = useCallback(() => {
    tryLockLandscape();
    playPhoneHorn();
    sendAction({ type: 'HONK_HORN' });
    try {
      navigator.vibrate?.(30);
    } catch {}
  }, [playPhoneHorn, sendAction, tryLockLandscape]);

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

    // 3-Tier Drift Vibration Alerts
    const currentTier = myKart.driftLevel ?? 0;
    if (currentTier !== prevDriftTierRef.current) {
      try {
        if (currentTier === 3) navigator.vibrate?.([40, 30, 80]);
        else if (currentTier === 2) navigator.vibrate?.(55);
        else if (currentTier === 1) navigator.vibrate?.(35);
      } catch {}
      prevDriftTierRef.current = currentTier;
    }

    // Incoming Shell Warning Radar Haptic
    if (myKart.hasIncomingShell && !prevIncomingShellRef.current) {
      try {
        navigator.vibrate?.([120, 60, 120, 60, 200]);
      } catch {}
    }
    prevIncomingShellRef.current = Boolean(myKart.hasIncomingShell);
  }, [myKart]);

  useEffect(() => {
    if (!myKart || !myKart.itemRoulette) return;
    const id = setInterval(() => {
      setRouletteIdx((prev) => (prev + 1) % ROULETTE_EMOJIS.length);
    }, 90);
    return () => clearInterval(id);
  }, [myKart?.itemRoulette]);

  // Touch-drag steering on the steering wheel (supports both native landscape and CSS-rotated portrait lock)
  const updateTouchSteer = (clientX: number, clientY: number, isRotatedPortrait: boolean) => {
    const box = wheelBoxRef.current?.getBoundingClientRect();
    if (!box) return;
    let norm = 0;
    if (isRotatedPortrait) {
      const center = box.top + box.height / 2;
      const halfSpan = Math.max(55, box.height * 0.42);
      const dir = landscapeSide === 'left' ? 1 : -1;
      norm = (((clientY - center) * dir) / halfSpan);
    } else {
      const center = box.left + box.width / 2;
      const halfSpan = Math.max(55, box.width * 0.42);
      norm = (clientX - center) / halfSpan;
    }
    const clamped = Math.max(-1, Math.min(1, norm));
    steerRef.current = clamped;
    setSteerValue(clamped);
    transmitInput({ steer: clamped });
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
        sendHostAction({
          type: 'ASSIGN_HEAT_PLAYER',
          targetPlayerId: selectedRacerId,
          targetHeatId: heatId,
          swapWithPlayerId: pid,
        });
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

        {/* Gyro Pre-Check Button (Prompts only when phone is held horizontally) */}
        {isDeviceHorizontal ? (
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
        ) : (
          <div
            style={{
              background: 'rgba(56,189,248,0.08)',
              border: '1.5px dashed rgba(56,189,248,0.3)',
              borderRadius: '14px',
              padding: '0.65rem 0.9rem',
              textAlign: 'center',
              fontSize: '0.8rem',
              color: '#94a3b8',
            }}
          >
            📱 <strong>Horizontal Steering:</strong> You will hold your phone sideways like a steering wheel to race.
          </div>
        )}

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

        {/* Gyro Calibration Banner for Active Racers (shown when phone is held horizontally) */}
        {isRacing && (
          isDeviceHorizontal ? (
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
                Tilt steering is calibrated for horizontal orientation!
              </span>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(56,189,248,0.08)',
                border: '1.5px dashed rgba(56,189,248,0.3)',
                borderRadius: '14px',
                padding: '0.65rem 0.9rem',
                textAlign: 'center',
                fontSize: '0.8rem',
                color: '#94a3b8',
              }}
            >
              📱 Turn your phone sideways to test & calibrate your steering wheel.
            </div>
          )
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
                  onClick={() => {
                    tryLockLandscape();
                    sendAction({ type: 'SUBMIT_TRACK_VOTE', trackId: t.id });
                  }}
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
            onClick={() => {
              tryLockLandscape();
              sendHostAction({ type: 'LOCK_TRACK_VOTE' });
            }}
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
  // PHASE 3: RACING (Horizontal-Locked Gyro Steering Wheel OR Pit Crew Console)
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

          {/* Pit Crew Floating Emoji Cannon */}
          <div
            style={{
              background: 'rgba(15,23,42,0.88)',
              border: '1.5px solid rgba(6,182,212,0.4)',
              borderRadius: '16px',
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--party-cyan, #06b6d4)', textTransform: 'uppercase' }}>
              🎉 Pit Crew Emoji Cannon (Tap to Send to Host TV)
            </span>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {['🎉', '🔥', '💀', '💩', '⚡', '🏎️', '💨', '👏'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    sendAction({ type: 'SEND_EMOJI', emoji });
                    try {
                      navigator.vibrate?.(25);
                    } catch {}
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: '12px',
                    padding: '0.4rem 0.6rem',
                    fontSize: '1.4rem',
                    cursor: 'pointer',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // ACTIVE RACER HORIZONTAL-LOCKED GYRO STEERING WHEEL COCKPIT
    // If the phone is held vertically in portrait, guide the user to turn sideways.
    // Never prompt to calibrate or enable gyro until the phone is physically horizontal!
    const isPortraitViewport = viewport.h > viewport.w;
    if (isPortraitViewport) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#070b14',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem 1.5rem',
            textAlign: 'center',
            color: '#f8fafc',
            zIndex: 99,
          }}
        >
          <div
            style={{
              fontSize: '4.5rem',
              animation: 'pulse 1.5s ease-in-out infinite alternate',
              marginBottom: '1rem',
            }}
          >
            📱🔄
          </div>
          <h2
            style={{
              fontFamily: 'var(--party-font-display)',
              fontSize: '1.8rem',
              fontWeight: 900,
              margin: '0 0 0.5rem',
              color: '#38bdf8',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Rotate Phone to Horizontal
          </h2>
          <p
            style={{
              fontSize: '1rem',
              color: '#94a3b8',
              maxWidth: '340px',
              margin: '0 0 1.5rem',
              lineHeight: 1.4,
            }}
          >
            Turn your phone sideways like a steering wheel to drive your kart!
          </p>
          <div
            style={{
              background: 'rgba(56,189,248,0.12)',
              border: '1.5px solid rgba(56,189,248,0.4)',
              borderRadius: '999px',
              padding: '0.45rem 1.2rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              color: '#38bdf8',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>📱</span>
            <span>Waiting for landscape orientation...</span>
          </div>
          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '12px',
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              color: '#cbd5e1',
            }}
          >
            <span>{myKart?.avatar || '🏎️'}</span>
            <span style={{ fontWeight: 800, color: myKart?.color || '#38bdf8' }}>
              {myKart?.name || state?.players?.[meId]?.name || 'Racer'}
            </span>
            <span>• {pd?.trackName || 'Circuit'}</span>
          </div>
        </div>
      );
    }

    const isCountdown = (snapshot?.countdownMs || 0) > 0;
    const countdownSec = isCountdown ? Math.ceil((snapshot?.countdownMs || 0) / 1000) : 0;
    const rank = myKart?.rank || 1;
    const lap = Math.min(snapshot?.totalLaps || 3, Math.max(1, myKart?.lap || 1));
    const speedKmh = Math.round((myKart?.speed || 0) * 2.2);
    const heldItem: KartItemType | null = myKart?.heldItem || null;
    const isRoulette = Boolean(myKart?.itemRoulette);
    const driftCharge = myKart?.driftLevel || 0;
    const driftPct = myKart?.driftCharge ?? (driftCharge === 2 ? 100 : driftCharge === 1 ? 55 : isDrifting ? 18 : 0);
    const isSpunOut = (myKart?.spinOutTimer || 0) > 0;
    const isStar = (myKart?.starTimer || 0) > 0;
    const isBoost = (myKart?.boostTimer || 0) > 0;

    const startDriftHold = () => {
      tryLockLandscape();
      if (!driftRef.current) {
        driftRef.current = false || true;
        setIsDrifting(true);
        transmitInput({ drift: true });
        try {
          navigator.vibrate?.(25);
        } catch {}
      }
    };

    const endDriftHold = () => {
      if (driftRef.current) {
        driftRef.current = false;
        setIsDrifting(false);
        transmitInput({ drift: false });
      }
    };

    const startBrakeHold = () => {
      tryLockLandscape();
      if (!brakeRef.current) {
        brakeRef.current = true;
        setIsBraking(true);
        transmitInput({ brake: true });
      }
    };

    const endBrakeHold = () => {
      if (brakeRef.current) {
        brakeRef.current = false;
        setIsBraking(false);
        transmitInput({ brake: false });
      }
    };

    const cockpitContainerStyle: React.CSSProperties = {
      position: 'fixed',
      top: `${viewport.top}px`,
      left: `${viewport.left}px`,
      width: `${viewport.w}px`,
      height: `${viewport.h}px`,
      zIndex: 90,
      background: '#070b14',
      paddingTop: 'max(0.4rem, env(safe-area-inset-top))',
      paddingBottom: 'max(0.4rem, env(safe-area-inset-bottom))',
      paddingLeft: 'max(0.6rem, env(safe-area-inset-left))',
      paddingRight: 'max(0.6rem, env(safe-area-inset-right))',
      display: 'grid',
      gridTemplateColumns: '1fr 1.38fr 1fr',
      gap: '0.5rem',
      alignItems: 'stretch',
      boxSizing: 'border-box',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
    };

    return (
      <div style={cockpitContainerStyle}>
        {/* LEFT COLUMN: LEFT THUMB ITEM BUTTON */}
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            tryLockLandscape();
            useItemRef.current = true;
            setItemPressed(true);
            transmitInput({ useItem: true });
            try {
              navigator.vibrate?.(35);
            } catch {}
          }}
          style={{
            height: '100%',
            minHeight: 0,
            borderRadius: '18px',
            border: heldItem
              ? `3px solid ${ITEM_META[heldItem].color}`
              : isRoulette
                ? '3px solid #facc15'
                : '2px dashed rgba(255,255,255,0.2)',
            background: itemPressed
              ? 'rgba(250,204,21,0.35)'
              : heldItem
                ? 'linear-gradient(145deg, rgba(250,204,21,0.22), rgba(15,23,42,0.95))'
                : 'rgba(15,23,42,0.88)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.25rem',
            padding: '0.45rem',
            cursor: 'pointer',
            overflow: 'hidden',
            boxShadow: heldItem ? `0 0 24px ${ITEM_META[heldItem].color}44` : 'none',
          }}
        >
          <span style={{ fontSize: 'clamp(2rem, 10vh, 3rem)', lineHeight: 1 }}>
            {isRoulette ? ROULETTE_EMOJIS[rouletteIdx] : heldItem ? ITEM_META[heldItem].emoji : '🎁'}
          </span>
          <span style={{ fontWeight: 900, fontSize: 'clamp(0.78rem, 3.4vh, 0.96rem)', textAlign: 'center', lineHeight: 1.1 }}>
            {isRoulette ? 'ROLLING...' : heldItem ? ITEM_META[heldItem].label : 'USE ITEM'}
          </span>
          <span style={{ fontSize: 'clamp(0.62rem, 2.5vh, 0.72rem)', color: '#94a3b8', textAlign: 'center', lineHeight: 1.1 }}>
            {heldItem ? ITEM_META[heldItem].hint : 'Hit rainbow boxes!'}
          </span>
        </button>

        {/* Incoming Shell Hazard Radar Alert */}
        {myKart?.hasIncomingShell && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(239, 68, 68, 0.95)',
              border: '2.5px solid #fff',
              borderRadius: '999px',
              padding: '0.22rem 1.1rem',
              color: '#fff',
              fontWeight: 900,
              fontSize: '0.78rem',
              letterSpacing: '0.04em',
              boxShadow: '0 0 25px rgba(239,68,68,0.9)',
              zIndex: 99,
              animation: 'pulse 0.5s infinite alternate',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            ⚠️ INCOMING SHELL DETECTED!
          </div>
        )}

        {/* CENTER COLUMN: TELEMETRY BAR + F1 TACHOMETER + ROTATING STEERING WHEEL */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {/* F1 Rev-Counter Shift LED Lights */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '4px',
              padding: '1px 0',
              flexShrink: 0,
            }}
          >
            {Array.from({ length: 9 }).map((_, i) => {
              const speedRatio = Math.min(1, speedKmh / 75);
              const lit = i / 9 <= speedRatio;
              const ledColor =
                i < 3 ? '#22c55e' : i < 6 ? '#facc15' : i < 8 ? '#ef4444' : '#d946ef';
              const isPulsing = driftCharge > 0 && lit;
              return (
                <div
                  key={i}
                  style={{
                    width: 'clamp(6px, 1.8vw, 10px)',
                    height: 'clamp(6px, 1.8vw, 10px)',
                    borderRadius: '50%',
                    background: lit ? ledColor : 'rgba(255,255,255,0.12)',
                    boxShadow: lit ? `0 0 8px ${ledColor}` : 'none',
                    transition: 'background 50ms, box-shadow 50ms',
                    opacity: isPulsing ? 0.85 : 1,
                  }}
                />
              );
            })}
          </div>

          {/* Top Telemetry Strip */}
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.35rem',
              background: isStar
                ? 'linear-gradient(90deg, rgba(250,204,21,0.3), rgba(236,72,153,0.3), rgba(56,189,248,0.3))'
                : isSpunOut
                  ? 'rgba(239,68,68,0.28)'
                  : 'rgba(15,23,42,0.95)',
              border: isStar
                ? '2px solid #facc15'
                : isBoost
                  ? '2px solid #38bdf8'
                  : '1.5px solid rgba(255,255,255,0.14)',
              borderRadius: '12px',
              padding: '0.28rem 0.5rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.52rem', fontWeight: 800, color: '#94a3b8', lineHeight: 1 }}>POS</div>
              <div
                style={{
                  fontSize: 'clamp(1.05rem, 4.5vh, 1.3rem)',
                  fontWeight: 900,
                  color: rank === 1 ? '#facc15' : rank === 2 ? '#e2e8f0' : rank === 3 ? '#fb923c' : '#38bdf8',
                  lineHeight: 1,
                }}
              >
                {ordinal(rank)}
              </div>
            </div>

            <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
              {isCountdown ? (
                <div style={{ fontSize: 'clamp(0.82rem, 3.6vh, 1rem)', fontWeight: 900, color: countdownSec <= 2 ? '#facc15' : '#f8fafc', whiteSpace: 'nowrap' }}>
                  🚦 {countdownSec > 0 ? `READY: ${countdownSec}` : 'GO!!'}
                </div>
              ) : myKart?.finished ? (
                <div style={{ fontSize: '0.88rem', fontWeight: 900, color: '#4ade80' }}>🏁 FINISHED!</div>
              ) : isSpunOut ? (
                <div style={{ fontSize: '0.85rem', fontWeight: 900, color: '#fca5a5' }}>💫 SPUN OUT!</div>
              ) : (
                <div style={{ fontSize: 'clamp(0.72rem, 3.1vh, 0.84rem)', fontWeight: 900, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                  LAP {lap}/{snapshot?.totalLaps || 3} • {speedKmh} km/h
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={gyroStatus === 'granted' ? recenterGyro : enableGyro}
                style={{
                  padding: '0.25rem 0.42rem',
                  borderRadius: '7px',
                  border: '1px solid rgba(56,189,248,0.45)',
                  background: 'rgba(56,189,248,0.16)',
                  color: '#38bdf8',
                  fontWeight: 800,
                  fontSize: '0.62rem',
                  cursor: 'pointer',
                }}
              >
                {gyroStatus === 'granted' ? '🎯 Center' : '🛞 Gyro'}
              </button>
              <button
                type="button"
                onClick={flipLandscapeSide}
                title="Flip horizontal screen & tilt direction 180°"
                style={{
                  padding: '0.25rem 0.4rem',
                  borderRadius: '7px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#cbd5e1',
                  fontWeight: 800,
                  fontSize: '0.62rem',
                  cursor: 'pointer',
                }}
              >
                🔄 Flip
              </button>
              {hostId && (
                <button
                  type="button"
                  onClick={() => sendHostAction({ type: 'FINISH_KART_RACE' })}
                  title="End Race Now (VIP Host)"
                  style={{
                    padding: '0.25rem 0.4rem',
                    borderRadius: '7px',
                    border: '1px solid rgba(250,204,21,0.45)',
                    background: 'rgba(250,204,21,0.14)',
                    color: '#fde047',
                    fontWeight: 800,
                    fontSize: '0.62rem',
                    cursor: 'pointer',
                  }}
                >
                  ⏭️ End
                </button>
              )}
            </div>
          </div>

          {/* Interactive Rotating Steering Wheel + Touch Slider */}
          <div
            ref={wheelBoxRef}
            onPointerDown={(e) => {
              tryLockLandscape();
              draggingTouchRef.current = true;
              setIsDraggingTouch(true);
              e.currentTarget.setPointerCapture(e.pointerId);
              updateTouchSteer(e.clientX, e.clientY, false);
            }}
            onPointerMove={(e) => {
              if (!draggingTouchRef.current) return;
              updateTouchSteer(e.clientX, e.clientY, false);
            }}
            onPointerUp={() => {
              draggingTouchRef.current = false;
              setIsDraggingTouch(false);
              smoothedSteerRef.current = 0;
              steerRef.current = 0;
              setSteerValue(0);
              transmitInput({ steer: 0 });
            }}
            onPointerCancel={() => {
              draggingTouchRef.current = false;
              setIsDraggingTouch(false);
              smoothedSteerRef.current = 0;
              steerRef.current = 0;
              setSteerValue(0);
            }}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              background: 'radial-gradient(circle at center, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
              border:
                driftCharge === 3
                  ? '2.5px solid #d946ef'
                  : driftCharge === 2
                    ? '2.5px solid #f97316'
                    : driftCharge === 1
                      ? '2.5px solid #38bdf8'
                      : '1.5px solid rgba(255,255,255,0.14)',
              borderRadius: '16px',
              padding: '0.35rem 0.55rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              overflow: 'hidden',
              cursor: 'grab',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.58rem', color: '#94a3b8', fontWeight: 800, flexShrink: 0 }}>
              <span>◀ LEFT</span>
              <span>{gyroStatus === 'granted' ? 'SMART STEER + TILT' : 'DRAG WHEEL'}</span>
              <span>RIGHT ▶</span>
            </div>

            {/* SVG Racing Steering Wheel */}
            <div
              style={{
                position: 'relative',
                width: 'clamp(62px, 28vh, 102px)',
                height: 'clamp(62px, 28vh, 102px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 1,
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  transform: `rotate(${steerValue * 68}deg)`,
                  transition: isDraggingTouch ? 'none' : 'transform 45ms linear',
                }}
              >
                <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%' }}>
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke={driftCharge === 3 ? '#d946ef' : driftCharge === 2 ? '#f97316' : driftCharge === 1 ? '#38bdf8' : '#334155'}
                    strokeWidth="14"
                  />
                  <path d="M 54 10 L 66 10 L 64 24 L 56 24 Z" fill="#ef4444" />
                  <line x1="16" y1="60" x2="104" y2="60" stroke="#475569" strokeWidth="9" strokeLinecap="round" />
                  <line x1="60" y1="60" x2="60" y2="104" stroke="#475569" strokeWidth="9" strokeLinecap="round" />
                  <circle cx="60" cy="60" r="18" fill="#0f172a" stroke="#38bdf8" strokeWidth="3" />
                  <text x="60" y="66" textAnchor="middle" fontSize="16">
                    {state?.me?.avatar || '🏎️'}
                  </text>
                </svg>
              </div>

              {/* Center Horn Button */}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  triggerHonk();
                }}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '38px',
                  height: '38px',
                  borderRadius: '999px',
                  border: '2px solid #facc15',
                  background: 'rgba(250,204,21,0.25)',
                  color: '#fde047',
                  fontSize: '1.05rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
                title="Tap to Honk Horn!"
              >
                📣
              </button>
            </div>

            {/* Horizontal Steer Bar Indicator */}
            <div
              style={{
                width: '100%',
                height: '6px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.08)',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '24px',
                  borderRadius: '999px',
                  background: driftCharge === 3 ? '#d946ef' : driftCharge === 2 ? '#f97316' : '#38bdf8',
                  left: `calc(${50 + steerValue * 44}% - 12px)`,
                }}
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: DRIFT / ROCKET START + BRAKE */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', height: '100%', minHeight: 0 }}>
          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              startDriftHold();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (e.targetTouches.length === 0) {
                endDriftHold();
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              if (e.targetTouches.length === 0) {
                endDriftHold();
              }
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              startDriftHold();
            }}
            onMouseUp={() => endDriftHold()}
            onMouseLeave={() => endDriftHold()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: '18px',
              border:
                driftCharge === 3
                  ? '3.5px solid #d946ef'
                  : driftCharge === 2
                    ? '3px solid #f97316'
                    : driftCharge === 1
                      ? '3px solid #38bdf8'
                      : isDrifting
                        ? '2.5px solid #facc15'
                        : '2px solid rgba(56,189,248,0.45)',
              background:
                driftCharge === 3
                  ? 'linear-gradient(135deg, rgba(217,70,239,0.5), rgba(168,85,247,0.4))'
                  : driftCharge === 2
                    ? 'linear-gradient(135deg, rgba(249,115,22,0.45), rgba(239,68,68,0.35))'
                    : driftCharge === 1
                      ? 'linear-gradient(135deg, rgba(56,189,248,0.42), rgba(37,99,235,0.35))'
                      : isCountdown
                        ? 'linear-gradient(135deg, rgba(250,204,21,0.3), rgba(245,158,11,0.2))'
                        : isDrifting
                          ? 'linear-gradient(135deg, rgba(250,204,21,0.28), rgba(56,189,248,0.25))'
                          : 'rgba(15,23,42,0.9)',
              color: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.18rem',
              padding: '0.4rem 0.5rem',
              overflow: 'hidden',
              cursor: 'pointer',
              WebkitTouchCallout: 'none',
              boxShadow: driftCharge === 3 ? '0 0 25px rgba(217,70,239,0.6)' : undefined,
            }}
          >
            <span style={{ fontSize: 'clamp(1.45rem, 7.2vh, 2.05rem)', lineHeight: 1 }}>
              {isCountdown ? '🚀' : driftCharge === 3 ? '⚡' : driftCharge === 2 ? '🔥' : driftCharge === 1 ? '💨' : isDrifting ? '〰️' : '💨'}
            </span>
            <span style={{ fontWeight: 900, fontSize: 'clamp(0.74rem, 3.1vh, 0.9rem)', textAlign: 'center', lineHeight: 1.1 }}>
              {isCountdown
                ? 'ROCKET START'
                : driftCharge === 3
                  ? 'ULTRA TURBO READY!'
                  : driftCharge === 2
                    ? 'RELEASE FOR SUPER!'
                    : driftCharge === 1
                      ? 'MINI-TURBO READY!'
                      : isDrifting
                        ? 'DRIFTING...'
                        : 'HOLD DRIFT'}
            </span>
            <span style={{ fontSize: 'clamp(0.56rem, 2.3vh, 0.65rem)', color: '#cbd5e1', textAlign: 'center', lineHeight: 1.1 }}>
              {isCountdown ? 'Hold on "1" for boost!' : 'Hold in turns • Release to boost'}
            </span>
            {/* Live Drift Spark Charge Meter */}
            {!isCountdown && (
              <div
                style={{
                  width: '88%',
                  height: '6px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.12)',
                  overflow: 'hidden',
                  marginTop: '0.15rem',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: `${driftPct}%`,
                    height: '100%',
                    borderRadius: '999px',
                    background:
                      driftCharge === 3
                        ? '#d946ef'
                        : driftCharge === 2
                          ? '#f97316'
                          : driftCharge === 1
                            ? '#38bdf8'
                            : '#facc15',
                    transition: 'width 80ms linear',
                  }}
                />
              </div>
            )}
          </button>

          <button
            type="button"
            onTouchStart={(e) => {
              e.preventDefault();
              startBrakeHold();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (e.targetTouches.length === 0) {
                endBrakeHold();
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              if (e.targetTouches.length === 0) {
                endBrakeHold();
              }
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              startBrakeHold();
            }}
            onMouseUp={() => endBrakeHold()}
            onMouseLeave={() => endBrakeHold()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              height: 'clamp(36px, 14vh, 48px)',
              flexShrink: 0,
              borderRadius: '12px',
              border: isBraking ? '2px solid #ef4444' : '1.5px solid rgba(239,68,68,0.38)',
              background: isBraking ? 'rgba(239,68,68,0.32)' : 'rgba(239,68,68,0.12)',
              color: '#fca5a5',
              fontWeight: 900,
              fontSize: 'clamp(0.68rem, 2.8vh, 0.78rem)',
              cursor: 'pointer',
              WebkitTouchCallout: 'none',
            }}
          >
            🛑 BRAKE / REV
          </button>
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
              {pd?.fastestLap && (
                <div
                  style={{
                    marginTop: '0.65rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '10px',
                    background: 'rgba(217,70,239,0.18)',
                    border: '1px solid #d946ef',
                    color: '#f0abfc',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                  }}
                >
                  ⚡ Fastest Lap: {pd.fastestLap.racerName || (pd.fastestLap as any).playerName} (
                  {(((pd.fastestLap.timeMs ?? (pd.fastestLap as any).lapTimeMs) || 0) / 1000).toFixed(2)}s)
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
