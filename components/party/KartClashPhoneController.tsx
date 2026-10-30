'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DRIFT_TIER_COLORS, ITEM_META, KartItemType, RANK_COLORS, ROULETTE_EMOJIS, formatRaceTime, ordinal } from '@/lib/party/kart-shared';
import { REACTIONS } from '@/lib/party/avatars';
import type { KartTelemetrySnapshot } from '@/lib/party/kart-physics';
import type { TrackId } from '@/lib/party/kart-tracks';
import TrackMinimap from '@/components/party/kart/TrackMinimap';

interface Props {
  state: any;
  roomCode: string;
  playerKey: string;
  hostId: string | null;
  sendAction: (action: Record<string, any>) => void;
  sendHostAction: (action: Record<string, any>) => void;
}

const TILT_DEADZONE_DEG = 2.5;
const TILT_FULL_LOCK_DEG = 30;
const INPUT_INTERVAL_MS = 40;
const INPUT_KEEPALIVE_MS = 250;
const PIT_EMOJIS = REACTIONS.slice(0, 6);

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every browser allows vibration
  }
};

function screenAngle(): number {
  if (typeof window === 'undefined') return 0;
  const a = window.screen?.orientation?.angle;
  if (typeof a === 'number') return a;
  return ((window as unknown as { orientation?: number }).orientation ?? 0) as number;
}

/** A press-and-hold control that works with several fingers on the screen at once. */
function HoldButton({
  onDown,
  onUp,
  style,
  children,
}: {
  onDown: () => void;
  onUp?: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Capture can fail if the pointer already lifted
        }
        onDown();
      }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onLostPointerCapture={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent', userSelect: 'none', WebkitUserSelect: 'none', cursor: 'pointer', ...style }}
    >
      {children}
    </button>
  );
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
  const raceId: string = pd?.raceId || hd?.raceId || '';

  // Tilt: `tiltLive` means real sensor events are arriving, not just that permission was given
  const [gyroStatus, setGyroStatus] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [tiltLive, setTiltLive] = useState(false);
  const [noSensor, setNoSensor] = useState(false);
  const [preferTouch, setPreferTouch] = useState(false);
  const [hasFinePointer, setHasFinePointer] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [screenShortSide, setScreenShortSide] = useState(0);
  const [barsHintDismissed, setBarsHintDismissed] = useState(false);
  const [flash, setFlash] = useState<{ key: number; color: string } | null>(null);
  const [physicallySideways, setPhysicallySideways] = useState<0 | 1 | -1>(0);
  const [forceSideways, setForceSideways] = useState(false);
  const [isDrifting, setIsDrifting] = useState(false);
  const [isBraking, setIsBraking] = useState(false);
  const [rouletteIdx, setRouletteIdx] = useState(0);
  const [viewport, setViewport] = useState<{ top: number; left: number; w: number; h: number }>({ top: 0, left: 0, w: 800, h: 450 });
  const [selectedRacerId, setSelectedRacerId] = useState<string | null>(null);

  // Live 10Hz snapshot from /api/party/stream/kart
  const [snapshot, setSnapshot] = useState<KartTelemetrySnapshot | null>(null);

  // High-frequency steering stays in refs so the sensor doesn't re-render the whole screen
  const steerRef = useRef(0);
  const tiltSteerRef = useRef(0);
  const padSteerRef = useRef<number | null>(null);
  const keySteerRef = useRef(0);
  const keysRef = useRef({ left: false, right: false });
  const driftRef = useRef(false);
  const brakeRef = useRef(false);
  const rawTiltRef = useRef(0);
  const neutralRef = useRef(0);
  const invertRef = useRef(1);
  const sideRef = useRef(1);
  const seqRef = useRef(1);
  const inFlightRef = useRef(false);
  const lastSentRef = useRef({ steer: 99, drift: false, brake: false, horizontal: false, at: 0 });
  const horizontalRef = useRef(false);
  const tiltLiveRef = useRef(false);
  const cockpitGaugeRef = useRef<HTMLDivElement | null>(null);
  const steerBarRef = useRef<HTMLDivElement | null>(null);
  const gaugeRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastEventIdRef = useRef(0);

  const tryLockLandscape = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const ori = window.screen?.orientation as unknown as { lock?: (mode: string) => Promise<void> };
      if (ori && typeof ori.lock === 'function') ori.lock('landscape').catch(() => {});
    } catch {
      // Orientation lock isn't available on most browsers outside fullscreen
    }
  }, []);

  // Track visualViewport (exact unobstructed area below iOS Safari landscape tab bars)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHasFinePointer(window.matchMedia?.('(pointer: fine)').matches ?? false);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
    setIsIosSafari(/iP(hone|od)/.test(navigator.userAgent) && !standalone);
    setScreenShortSide(Math.min(window.screen?.width || 0, window.screen?.height || 0));
    try {
      setBarsHintDismissed(localStorage.getItem('kartBarsHintDismissed') === '1');
    } catch {
      // Storage unavailable: the hint just shows again
    }
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
        setViewport({ top: 0, left: 0, w: window.innerWidth, h: window.innerHeight });
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

  const inRace = phase === 'RACING' && Boolean(pd?.isRacing);

  // Stop the page scrolling or pinch-zooming under your thumbs while racing
  useEffect(() => {
    if (!inRace) return;
    tryLockLandscape();
    try {
      window.scrollTo(0, 0);
    } catch {
      // Harmless
    }
    const prevOverflow = document.body.style.overflow;
    const prevMinHeight = document.body.style.minHeight;
    const prevTouchAction = document.documentElement.style.touchAction;
    if (isIosSafari) {
      // Safari only collapses its tab bar when the page itself scrolls, and brings it back when
      // the page returns to the top. So keep a scrollable page behind the fixed cockpit for the
      // whole race; the cockpit decides when a swipe may reach it.
      document.body.style.minHeight = '220vh';
      document.documentElement.style.touchAction = 'pan-y';
    } else {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.touchAction = 'none';
    }
    const blockGesture = (event: Event) => event.preventDefault();
    const blockPinch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('touchmove', blockPinch, { passive: false });
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.minHeight = prevMinHeight;
      document.documentElement.style.touchAction = prevTouchAction;
      try {
        window.scrollTo(0, 0);
      } catch {
        // Harmless
      }
      document.removeEventListener('gesturestart', blockGesture);
      document.removeEventListener('gesturechange', blockGesture);
      document.removeEventListener('touchmove', blockPinch);
      try {
        (window.screen?.orientation as unknown as { unlock?: () => void })?.unlock?.();
      } catch {
        // Harmless
      }
    };
  }, [inRace, isIosSafari, tryLockLandscape]);

  const landscapeViewport = viewport.w > viewport.h;
  // Safari's bars take well over 15% of a sideways iPhone; collapsed they take much less
  const safariBarsShowing = inRace && isIosSafari && landscapeViewport && screenShortSide > 0 && viewport.h < screenShortSide * 0.84;
  const isDeviceHorizontal = landscapeViewport || physicallySideways !== 0 || forceSideways;
  // With rotation lock on, the phone is sideways but the page isn't. Turn the cockpit to match.
  const rotateCockpit = !landscapeViewport && (physicallySideways !== 0 || forceSideways);
  const rotateDir = physicallySideways === -1 ? -1 : 1;

  const postInput = useCallback((input: Record<string, unknown>, onDone?: () => void) => {
    const finish = () => onDone?.();
    fetch('/api/party/kart-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerKey, input }),
    }).then(finish, finish);
  }, [roomCode, playerKey]);

  const currentInput = useCallback(() => {
    const steer = padSteerRef.current ?? (keySteerRef.current !== 0 ? keySteerRef.current : tiltSteerRef.current);
    steerRef.current = steer;
    return {
      steer: Math.round(steer * 100) / 100,
      drift: driftRef.current,
      brake: brakeRef.current,
      isHorizontal: horizontalRef.current,
      isReady: horizontalRef.current,
      seq: seqRef.current++,
    };
  }, []);

  /** Send held state now, after any press. Tap flags (item, horn) go in the same packet. */
  const flushInput = useCallback((extra?: { useItem?: boolean; honk?: boolean }) => {
    const input = { ...currentInput(), ...extra };
    lastSentRef.current = { steer: input.steer, drift: input.drift, brake: input.brake, horizontal: input.isHorizontal, at: performance.now() };
    postInput(input);
  }, [currentInput, postInput]);

  // Steady steering stream. Only one request at a time, so a slow network can't queue up
  // old steering: whichever value is current goes out when the last request returns.
  useEffect(() => {
    if (!inRace) return;
    const interval = setInterval(() => {
      // Keyboard steering eases in and out rather than snapping to full lock
      const keys = keysRef.current;
      const keyTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      keySteerRef.current += (keyTarget - keySteerRef.current) * 0.35;
      if (Math.abs(keySteerRef.current) < 0.02 && keyTarget === 0) keySteerRef.current = 0;

      const now = performance.now();
      const last = lastSentRef.current;
      const steerNow = padSteerRef.current ?? (keySteerRef.current !== 0 ? keySteerRef.current : tiltSteerRef.current);
      const changed = Math.abs(steerNow - last.steer) >= 0.012 || driftRef.current !== last.drift || brakeRef.current !== last.brake || horizontalRef.current !== last.horizontal;
      if (inFlightRef.current || (!changed && now - last.at < INPUT_KEEPALIVE_MS)) return;
      inFlightRef.current = true;
      const input = currentInput();
      lastSentRef.current = { steer: input.steer, drift: input.drift, brake: input.brake, horizontal: input.isHorizontal, at: now };
      postInput(input, () => {
        inFlightRef.current = false;
      });
    }, INPUT_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      inFlightRef.current = false;
    };
  }, [inRace, currentInput, postInput]);

  // Tell the race straight away when the phone turns, so the countdown can start
  useEffect(() => {
    horizontalRef.current = isDeviceHorizontal;
    if (inRace) flushInput();
  }, [isDeviceHorizontal, inRace, flushInput]);

  // Never carry a held button or stale telemetry from one race into the next
  useEffect(() => {
    driftRef.current = false;
    brakeRef.current = false;
    padSteerRef.current = null;
    setIsDrifting(false);
    setIsBraking(false);
    setSnapshot(null);
    lastEventIdRef.current = 0;
  }, [raceId]);

  const enableGyro = useCallback(async () => {
    tryLockLandscape();
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setGyroStatus('unsupported');
      return;
    }
    setPreferTouch(false);
    const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof doe.requestPermission === 'function') {
      try {
        const res = await doe.requestPermission();
        setGyroStatus(res === 'granted' ? 'granted' : 'denied');
      } catch {
        // A rejection isn't the player saying no: iOS refuses anything but a completed tap, and
        // needs HTTPS. Only an answer of "denied" should stop us offering this again.
        setGyroStatus(window.isSecureContext ? 'unknown' : 'unsupported');
      }
    } else {
      setGyroStatus('granted');
    }
  }, [tryLockLandscape]);

  // Read the wheel angle from gravity. Raw `beta` swings wildly when a phone is held near
  // upright like a real steering wheel; the gravity vector stays steady at any hold angle.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof doe.requestPermission !== 'function') {
      setGyroStatus((s) => (s === 'unknown' ? 'granted' : s));
    }
    let smoothed = 0;
    let sawEvent = false;
    let lastSideways: 0 | 1 | -1 = 0;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      if (!sawEvent) {
        sawEvent = true;
        tiltLiveRef.current = true;
        setTiltLive(true);
        setNoSensor(false);
        setGyroStatus('granted');
      }
      const b = (e.beta * Math.PI) / 180;
      const g = (e.gamma * Math.PI) / 180;
      const gx = Math.cos(b) * Math.sin(g);
      const gy = -Math.sin(b);
      const inPlane = Math.hypot(gx, gy);

      const angle = screenAngle();
      if (angle === 90) sideRef.current = 1;
      else if (angle === 270 || angle === -90) sideRef.current = -1;
      else if (Math.abs(gx) > 0.55) sideRef.current = gx < 0 ? 1 : -1;

      // Sideways detection works even with the OS rotation lock on
      const sideways: 0 | 1 | -1 = Math.abs(gx) > 0.6 && Math.abs(gx) > Math.abs(gy) ? (gx < 0 ? 1 : -1) : Math.abs(gy) > 0.75 ? 0 : lastSideways;
      if (sideways !== lastSideways) {
        lastSideways = sideways;
        setPhysicallySideways(sideways);
      }

      // Lying flat there's no gravity to steer by, so let the wheel settle back to centre
      const side = sideRef.current;
      const tiltDeg = inPlane > 0.2 ? (Math.atan2(-side * gy, -side * gx) * 180) / Math.PI : 0;
      rawTiltRef.current = tiltDeg;
      const calibrated = (tiltDeg - neutralRef.current) * invertRef.current;
      let target = 0;
      if (Math.abs(calibrated) > TILT_DEADZONE_DEG) {
        const linear = Math.min(1, (Math.abs(calibrated) - TILT_DEADZONE_DEG) / (TILT_FULL_LOCK_DEG - TILT_DEADZONE_DEG));
        target = Math.sign(calibrated) * Math.pow(linear, 1.2);
      }
      smoothed += (target - smoothed) * 0.45;
      tiltSteerRef.current = Math.abs(smoothed) < 0.012 ? 0 : Math.max(-1, Math.min(1, smoothed));
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    // Allowed but silent means this device really has nothing to offer
    const silence = gyroStatus === 'granted'
      ? setTimeout(() => {
          if (!tiltLiveRef.current) setNoSensor(true);
        }, 2000)
      : undefined;
    return () => {
      if (silence) clearTimeout(silence);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [gyroStatus]);

  // Move the on-screen wheel on the animation frame, not on every sensor event
  useEffect(() => {
    if (phase !== 'RACING' && phase !== 'TRACK_VOTE' && phase !== 'HEAT_SETUP') return;
    let id = 0;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const steer = padSteerRef.current ?? (keySteerRef.current !== 0 ? keySteerRef.current : tiltSteerRef.current);
      if (cockpitGaugeRef.current) cockpitGaugeRef.current.style.left = `calc(${50 + steer * 46}% - 9px)`;
      if (steerBarRef.current) steerBarRef.current.style.left = `calc(${50 + steer * 46}% - 12px)`;
      if (gaugeRef.current) gaugeRef.current.style.left = `calc(${50 + steer * 44}% - 11px)`;
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const recenterGyro = useCallback(() => {
    tryLockLandscape();
    neutralRef.current = rawTiltRef.current;
    tiltSteerRef.current = 0;
    buzz(20);
  }, [tryLockLandscape]);

  const flipTilt = useCallback(() => {
    invertRef.current = -invertRef.current;
    neutralRef.current = -neutralRef.current;
    buzz(20);
  }, []);

  // 10Hz telemetry during the race
  useEffect(() => {
    if (phase !== 'RACING') return;
    const es = new EventSource(`/api/party/stream/kart?roomCode=${encodeURIComponent(roomCode)}&role=player`);
    es.onmessage = (evt) => {
      try {
        const snap: KartTelemetrySnapshot = JSON.parse(evt.data);
        if (!raceId || snap.raceId === raceId) setSnapshot(snap);
      } catch {
        // Skip a malformed tick
      }
    };
    return () => es.close();
  }, [phase, roomCode, raceId]);

  const myKart = snapshot?.karts?.find((k) => k.id === meId) || null;

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audioRef.current = new Ctx();
      } catch {
        // No audio on this device
      }
    }
    if (audioRef.current?.state === 'suspended') audioRef.current.resume().catch(() => {});
    return audioRef.current;
  }, []);

  useEffect(() => () => {
    audioRef.current?.close().catch(() => {});
    audioRef.current = null;
  }, []);

  const triggerHonk = useCallback(() => {
    tryLockLandscape();
    const ctx = getAudio();
    if (ctx) {
      for (const freq of [440, 554]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        g.gain.setValueAtTime(0.1, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    }
    flushInput({ honk: true });
    buzz(30);
  }, [getAudio, flushInput, tryLockLandscape]);

  // Your kart talks back through your hands
  useEffect(() => {
    if (!snapshot || !myKart) return;
    for (const e of snapshot.events || []) {
      if (e.id <= lastEventIdRef.current) continue;
      lastEventIdRef.current = e.id;
      if (e.kartId && e.kartId !== myKart.id) continue;
      const flashColor = e.type === 'hit' ? '#ef4444' : e.type === 'box' && e.value ? '#facc15' : e.type === 'miniturbo' || e.type === 'boost' || e.type === 'pad' || e.type === 'rocket' ? '#22d3ee' : null;
      if (flashColor) setFlash({ key: e.id, color: flashColor });
      switch (e.type) {
        case 'hit': buzz([90, 40, 110]); break;
        case 'wall': if (e.kartId) buzz(35); break;
        case 'bump': buzz(25); break;
        case 'box': if (e.value) buzz(20); break;
        case 'miniturbo': buzz(e.value === 3 ? [40, 30, 80] : 45); break;
        case 'boost':
        case 'pad':
        case 'rocket': buzz(45); break;
        case 'land': buzz(30); break;
        case 'trick': buzz([20, 20, 20]); break;
        case 'final_lap': buzz([40, 40, 40]); break;
        case 'finish': buzz([80, 50, 80, 50, 160]); break;
        default: break;
      }
    }
  }, [snapshot, myKart]);

  const incoming = Boolean(myKart?.hasIncomingShell);
  useEffect(() => {
    if (incoming) buzz([120, 60, 120, 60, 200]);
  }, [incoming]);

  const roulette = Boolean(myKart?.itemRoulette);
  useEffect(() => {
    if (!roulette) return;
    const id = setInterval(() => setRouletteIdx((prev) => (prev + 1) % ROULETTE_EMOJIS.length), 80);
    return () => clearInterval(id);
  }, [roulette]);

  const pressDrift = useCallback(() => {
    if (driftRef.current) return;
    driftRef.current = true;
    setIsDrifting(true);
    flushInput();
    buzz(20);
  }, [flushInput]);
  const releaseDrift = useCallback(() => {
    if (!driftRef.current) return;
    driftRef.current = false;
    setIsDrifting(false);
    flushInput();
  }, [flushInput]);
  const pressBrake = useCallback(() => {
    if (brakeRef.current) return;
    brakeRef.current = true;
    setIsBraking(true);
    flushInput();
  }, [flushInput]);
  const releaseBrake = useCallback(() => {
    if (!brakeRef.current) return;
    brakeRef.current = false;
    setIsBraking(false);
    flushInput();
  }, [flushInput]);
  const pressItem = useCallback(() => {
    flushInput({ useItem: true });
    buzz(30);
  }, [flushInput]);

  // Keyboard controls, for playing on a laptop
  useEffect(() => {
    if (!inRace) return;
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const key = e.key.toLowerCase();
      if (['arrowleft', 'a'].includes(key)) keysRef.current.left = down;
      else if (['arrowright', 'd'].includes(key)) keysRef.current.right = down;
      else if (key === ' ' || key === 'shift') {
        if (down) pressDrift();
        else releaseDrift();
      } else if (['arrowdown', 's'].includes(key)) {
        if (down) pressBrake();
        else releaseBrake();
      } else if (['e', 'x', 'enter', 'arrowup', 'w'].includes(key)) {
        if (down && !e.repeat) pressItem();
      } else if (key === 'h') {
        if (down && !e.repeat) triggerHonk();
      } else {
        return;
      }
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => onKey(e, true);
    const up = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keysRef.current = { left: false, right: false };
    };
  }, [inRace, pressDrift, releaseDrift, pressBrake, releaseBrake, pressItem, triggerHonk]);

  // Touch steering pad: drag from wherever your thumb lands, full lock is a short slide
  const padUpdate = useCallback((clientX: number, clientY: number) => {
    const box = padRef.current?.getBoundingClientRect();
    if (!box) return;
    const horizontalScreen = !rotateCockpit;
    const span = horizontalScreen ? box.width : box.height;
    const pos = horizontalScreen ? clientX - box.left : clientY - box.top;
    // A rotated cockpit runs along the screen's Y axis
    const dir = horizontalScreen ? 1 : rotateDir;
    padSteerRef.current = Math.max(-1, Math.min(1, ((pos - span / 2) / (span * 0.34)) * dir));
  }, [rotateCockpit, rotateDir]);

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
            onClick={tiltLive ? recenterGyro : enableGyro}
            style={{
              width: '100%',
              padding: '0.8rem 1rem',
              borderRadius: '14px',
              border: tiltLive ? '1.5px solid rgba(34,197,94,0.5)' : '1.5px solid rgba(250,204,21,0.5)',
              background: tiltLive ? 'rgba(34,197,94,0.14)' : 'rgba(250,204,21,0.14)',
              color: tiltLive ? '#4ade80' : '#fde047',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            {tiltLive ? '✅ Tilt steering ready' : '🛞 Tap to enable tilt steering'}
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
                border: tiltLive ? '1.5px solid rgba(34,197,94,0.45)' : '2px solid #facc15',
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
                  🛞 Steering check
                </span>
                <button
                  type="button"
                  onClick={tiltLive ? recenterGyro : enableGyro}
                  style={{
                    padding: '0.38rem 0.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    background: tiltLive ? 'rgba(56,189,248,0.22)' : '#facc15',
                    color: tiltLive ? '#38bdf8' : '#0f172a',
                    fontWeight: 900,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                  }}
                >
                  {tiltLive ? '🎯 Recenter' : '🔓 Enable tilt'}
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
                  ref={gaugeRef}
                  style={{
                    position: 'absolute',
                    top: '1px',
                    bottom: '1px',
                    width: '22px',
                    borderRadius: '999px',
                    background: '#38bdf8',
                    left: 'calc(50% - 11px)',
                  }}
                />
              </div>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                {tiltLive ? 'Tilt like a steering wheel: the marker should follow.' : 'No tilt yet? You can also drag a touch pad in the race.'}
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
              📱 Turn your phone sideways to test your steering.
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
                  <TrackMinimap trackId={t.id as TrackId} size={112} />
                  <span style={{ fontWeight: 900, fontSize: '0.92rem' }}>{t.emoji} {t.name}</span>
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
      const chaosTriggered = Boolean(snapshot?.chaosFired);
      const predictionLocked = (snapshot?.raceTimeMs || 0) > 30_000;
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
                ? '💥 Chaos dropped!'
                : chaosVote
                  ? '✅ Vote in! It drops shortly after the race starts'
                  : '🎁 Vote on the mid-race Chaos Drop!'}
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
              🔮 Winner pick (+300 pts){predictionLocked ? ' · locked' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
              {activeRacers.map((r: any) => {
                const picked = predictedWinnerId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={predictionLocked}
                    onClick={() => sendAction({ type: 'SUBMIT_HEAT_PREDICTION', racerId: r.id })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      opacity: predictionLocked && !picked ? 0.5 : 1,
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
                    {k.finished ? '🏁 FINISHED' : `Lap ${k.lap}/${snapshot?.totalLaps || 3}`}
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
              🎉 Pit crew emoji cannon (shows on the TV)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PIT_EMOJIS.length}, 1fr)`, gap: '0.3rem', width: '100%' }}>
              {PIT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    sendAction({ type: 'SUBMIT_REACTION', emoji });
                    buzz(25);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: '12px',
                    padding: '0.4rem 0',
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

    // ACTIVE RACER COCKPIT
    const needsTiltTap = !tiltLive && typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function' && (gyroStatus === 'unknown' || (gyroStatus === 'granted' && !noSensor));
    // Held upright: ask them to turn the phone. A phone on rotation lock can't turn the page, so
    // offer a way through instead of leaving them stuck on this screen.
    if (!isDeviceHorizontal) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'radial-gradient(circle at 50% 30%, #12284a, #060914)',
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
          <div style={{ fontSize: '4.5rem', lineHeight: 1, marginBottom: '0.8rem', transform: 'rotate(90deg)' }}>📱</div>
          <h2 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.8rem', fontWeight: 900, margin: '0 0 0.5rem', color: '#38bdf8', textTransform: 'uppercase' }}>
            Turn your phone sideways
          </h2>
          <p style={{ fontSize: '1rem', color: '#94a3b8', maxWidth: '340px', margin: '0 0 1.2rem', lineHeight: 1.4 }}>
            Hold it like a steering wheel to drive your kart.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.06)', borderRadius: '12px', padding: '0.5rem 1rem', fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '1.4rem' }}>
            <span>{myKart?.avatar || state?.me?.avatar || '🏎️'}</span>
            <span style={{ fontWeight: 800, color: myKart?.color || '#38bdf8' }}>{myKart?.name || state?.me?.name || 'Racer'}</span>
            <span>· {pd?.trackName || 'Circuit'}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (needsTiltTap) enableGyro();
              setForceSideways(true);
            }}
            style={{ background: 'rgba(56,189,248,0.14)', border: '1.5px solid rgba(56,189,248,0.5)', color: '#7dd3fc', borderRadius: '12px', padding: '0.65rem 1rem', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer' }}
          >
            Screen won&rsquo;t rotate? Tap here
          </button>
        </div>
      );
    }

    const cockpitW = rotateCockpit ? viewport.h : viewport.w;
    const cockpitH = rotateCockpit ? viewport.w : viewport.h;
    const countdownMs = snapshot?.countdownMs || 0;
    const waiting = Boolean(snapshot?.waitingForOrientation);
    const isCountdown = !waiting && countdownMs > 0;
    const countdownSec = isCountdown ? Math.min(3, Math.ceil(countdownMs / 1000)) : 0;
    const rank = myKart?.rank || 1;
    const lap = myKart?.lap || 1;
    const totalLaps = snapshot?.totalLaps || 3;
    const speedKmh = Math.max(0, Math.round(Math.abs(myKart?.speed || 0) * 2.2));
    const heldItem: KartItemType | null = myKart?.heldItem || null;
    const tier = myKart?.driftLevel || 0;
    const driftPct = myKart?.drifting ? (tier === 3 ? 100 : ((tier * 100 + (myKart?.driftCharge || 0)) / 3)) : 0;
    const tierColor = DRIFT_TIER_COLORS[tier];
    const isSpunOut = (myKart?.spinOutTimer || 0) > 0;
    const isStar = (myKart?.starTimer || 0) > 0;
    const isBoost = (myKart?.boostTimer || 0) > 0;
    const inAir = (myKart?.airT || 0) > 0;
    const showTrickPrompt = inAir && !myKart?.trick;
    const finished = Boolean(myKart?.finished);
    const rankColor = RANK_COLORS[Math.min(RANK_COLORS.length - 1, rank - 1)];
    const useTilt = tiltLive && !preferTouch;
    const showTiltPrompt = needsTiltTap && !preferTouch;
    const compact = cockpitH < 300;

    const smallBtn: React.CSSProperties = { flex: 1, minWidth: 0, padding: '0.22rem 0.2rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.07)', color: '#cbd5e1', fontWeight: 800, fontSize: '0.66rem', cursor: 'pointer', whiteSpace: 'nowrap' };

    const itemColor = heldItem ? ITEM_META[heldItem].color : roulette ? '#facc15' : 'rgba(255,255,255,0.22)';
    const itemButton = (
      <HoldButton
        onDown={() => {
          tryLockLandscape();
          pressItem();
        }}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          borderRadius: '20px',
          border: `3px ${heldItem || roulette ? 'solid' : 'dashed'} ${itemColor}`,
          background: heldItem ? `radial-gradient(circle at 50% 40%, ${ITEM_META[heldItem].color}55, rgba(10,14,28,0.95))` : 'rgba(15,23,42,0.9)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.15rem',
          padding: '0.3rem',
          overflow: 'hidden',
          boxShadow: heldItem ? `0 0 26px ${ITEM_META[heldItem].color}66` : 'none',
        }}
      >
        <span style={{ fontSize: heldItem || roulette ? 'clamp(2.4rem, 19vmin, 4rem)' : 'clamp(1.6rem, 11vmin, 2.4rem)', lineHeight: 1, opacity: heldItem || roulette ? 1 : 0.45 }}>
          {roulette ? ROULETTE_EMOJIS[rouletteIdx] : heldItem ? ITEM_META[heldItem].emoji : '🎁'}
        </span>
        <span style={{ fontWeight: 900, fontSize: 'clamp(0.74rem, 4vmin, 1rem)', textAlign: 'center', lineHeight: 1.05 }}>
          {roulette ? 'Tap to stop!' : heldItem ? ITEM_META[heldItem].name : 'No item'}
        </span>
        {!compact && (
          <span style={{ fontSize: 'clamp(0.6rem, 3vmin, 0.74rem)', color: '#94a3b8', textAlign: 'center', lineHeight: 1.05 }}>
            {heldItem ? ITEM_META[heldItem].hint : 'Hit a rainbow box'}
          </span>
        )}
      </HoldButton>
    );

    const driftButton = (
      <HoldButton
        onDown={() => {
          tryLockLandscape();
          pressDrift();
        }}
        onUp={releaseDrift}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          borderRadius: '20px',
          border: `3px solid ${showTrickPrompt ? '#22ff66' : tier > 0 ? tierColor : isDrifting ? '#facc15' : 'rgba(56,189,248,0.5)'}`,
          background: showTrickPrompt
            ? 'rgba(34,255,102,0.3)'
            : tier > 0
              ? `radial-gradient(circle at 50% 40%, ${tierColor}77, rgba(10,14,28,0.95))`
              : isDrifting
                ? 'rgba(250,204,21,0.2)'
                : isCountdown && countdownSec === 1
                  ? 'rgba(250,204,21,0.32)'
                  : 'rgba(15,23,42,0.9)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.2rem',
          padding: '0.3rem 0.5rem',
          overflow: 'hidden',
          boxShadow: tier === 3 ? '0 0 28px #d946efaa' : undefined,
        }}
      >
        <span style={{ fontSize: 'clamp(1.5rem, 12vmin, 2.6rem)', lineHeight: 1 }}>
          {showTrickPrompt ? '🤸' : isCountdown ? '🚀' : tier === 3 ? '💜' : tier === 2 ? '🔥' : tier === 1 ? '💨' : isDrifting ? '〰️' : '💨'}
        </span>
        <span style={{ fontWeight: 900, fontSize: 'clamp(0.78rem, 4.2vmin, 1.05rem)', textAlign: 'center', lineHeight: 1.05 }}>
          {showTrickPrompt
            ? 'TRICK NOW!'
            : isCountdown
              ? (countdownSec === 1 ? 'HOLD NOW!' : 'Wait for 1...')
              : tier === 3
                ? 'ULTRA! Let go!'
                : tier === 2
                  ? 'SUPER! Let go!'
                  : tier === 1
                    ? 'MINI! Let go!'
                    : isDrifting
                      ? 'Steer in...'
                      : 'DRIFT'}
        </span>
        <div style={{ width: '86%', height: '7px', borderRadius: '999px', background: 'rgba(255,255,255,0.14)', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ width: `${driftPct}%`, height: '100%', borderRadius: '999px', background: tier === 0 ? '#e2e8f0' : tierColor, transition: 'width 90ms linear' }} />
        </div>
      </HoldButton>
    );

    const brakeButton = (
      <HoldButton
        onDown={pressBrake}
        onUp={releaseBrake}
        style={{
          flexShrink: 0,
          height: 'clamp(32px, 12vmin, 46px)',
          width: '100%',
          borderRadius: '12px',
          border: `1.5px solid ${isBraking ? '#ef4444' : 'rgba(239,68,68,0.38)'}`,
          background: isBraking ? 'rgba(239,68,68,0.34)' : 'rgba(239,68,68,0.1)',
          color: '#fca5a5',
          fontWeight: 900,
          fontSize: 'clamp(0.66rem, 3.2vmin, 0.8rem)',
        }}
      >
        🛑 BRAKE
      </HoldButton>
    );

    // Touch steering pad for phones without tilt, or anyone who'd rather use a thumb
    const steerPad = (
      <div
        ref={padRef}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Capture can fail if the pointer already lifted
          }
          padUpdate(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (padSteerRef.current !== null) padUpdate(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          padSteerRef.current = null;
        }}
        onPointerCancel={() => {
          padSteerRef.current = null;
        }}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          position: 'relative',
          borderRadius: '20px',
          border: '2px solid rgba(255,255,255,0.18)',
          background: 'linear-gradient(90deg, rgba(56,189,248,0.2), rgba(15,23,42,0.9) 50%, rgba(56,189,248,0.2))',
          touchAction: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 0.7rem',
          fontSize: 'clamp(1.4rem, 9vmin, 2rem)',
          color: 'rgba(255,255,255,0.7)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <span>◀</span>
        <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', bottom: '0.4rem', fontSize: '0.68rem', fontWeight: 800, color: '#94a3b8' }}>DRAG TO STEER</span>
        <span>▶</span>
        <div ref={steerBarRef} style={{ position: 'absolute', top: '12%', bottom: '12%', width: '24px', borderRadius: '999px', background: '#38bdf8', boxShadow: '0 0 14px #38bdf8', left: 'calc(50% - 12px)', pointerEvents: 'none' }} />
      </div>
    );

    return (
      <div
        // Touch end, not touch start: iOS only unlocks audio on a completed tap
        onTouchEndCapture={() => getAudio()}
        style={{
          position: 'fixed',
          top: rotateCockpit ? `${viewport.top + (viewport.h - cockpitH) / 2}px` : `${viewport.top}px`,
          left: rotateCockpit ? `${viewport.left + (viewport.w - cockpitW) / 2}px` : `${viewport.left}px`,
          width: `${cockpitW}px`,
          height: `${cockpitH}px`,
          transform: rotateCockpit ? `rotate(${rotateDir * 90}deg)` : undefined,
          zIndex: 90,
          background: incoming ? '#2a0606' : isStar ? 'linear-gradient(120deg, #3b2506, #33113a, #082b3b)' : '#070b14',
          paddingTop: 'max(0.35rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.45rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.45rem, env(safe-area-inset-right))',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.95fr) minmax(0, 1fr)',
          gap: '0.4rem',
          alignItems: 'stretch',
          boxSizing: 'border-box',
          overflow: 'hidden',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          // While Safari's bars are up, a swipe on anything but a control scrolls them away
          touchAction: safariBarsShowing ? 'pan-y' : 'none',
        }}
      >
        {/* Left thumb */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: 0 }}>
          {useTilt ? itemButton : steerPad}
        </div>

        {/* Centre: position, lap, wheel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minHeight: 0, minWidth: 0, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.5rem', flexShrink: 0, lineHeight: 1, visibility: isCountdown && showTiltPrompt ? 'hidden' : undefined }}>
            <span style={{ fontFamily: 'var(--party-font-display)', fontSize: 'clamp(1.8rem, 15vmin, 3.2rem)', fontWeight: 900, color: rankColor }}>{ordinal(rank)}</span>
            <span style={{ fontWeight: 900, fontSize: 'clamp(0.8rem, 4.4vmin, 1.1rem)', color: '#cbd5e1' }}>LAP {lap}/{totalLaps}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '3px', flexShrink: 0 }}>
            {Array.from({ length: 10 }).map((_, i) => {
              const lit = i / 10 < speedKmh / 170;
              const color = isBoost || isStar ? '#22d3ee' : i < 5 ? '#22c55e' : i < 8 ? '#facc15' : '#ef4444';
              return <div key={i} style={{ flex: 1, maxWidth: '16px', height: 'clamp(4px, 2vmin, 8px)', borderRadius: '2px', background: lit ? color : 'rgba(255,255,255,0.12)' }} />;
            })}
          </div>

          {safariBarsShowing && !barsHintDismissed && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(56,189,248,0.95)', color: '#04121a', borderRadius: '10px', padding: '0.18rem 0.4rem', fontWeight: 900, fontSize: 'clamp(0.62rem, 3.2vmin, 0.78rem)', lineHeight: 1.1, pointerEvents: 'none' }}>
              <span style={{ flex: 1, textAlign: 'center' }}>⬆️ Swipe up here to hide Safari&rsquo;s tabs</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => {
                  setBarsHintDismissed(true);
                  try {
                    localStorage.setItem('kartBarsHintDismissed', '1');
                  } catch {
                    // Storage unavailable: it only hides for this game
                  }
                }}
                style={{ pointerEvents: 'auto', background: 'none', border: 'none', color: '#04121a', fontWeight: 900, fontSize: '0.9rem', padding: '0 0.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {showTiltPrompt ? (
              <button
                type="button"
                onClick={enableGyro}
                style={{ width: '100%', height: '100%', borderRadius: '16px', border: '3px solid #fff', background: '#facc15', color: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.15rem', padding: '0.3rem', fontWeight: 900, cursor: 'pointer', animation: 'kartGlow 700ms ease-in-out infinite alternate' }}
              >
                <span style={{ fontSize: 'clamp(1.6rem, 13vmin, 2.8rem)', lineHeight: 1 }}>🛞</span>
                <span style={{ fontSize: 'clamp(0.85rem, 5vmin, 1.25rem)', lineHeight: 1.05 }}>Tap to turn on tilt steering</span>
                <span style={{ fontSize: 'clamp(0.6rem, 3vmin, 0.74rem)', fontWeight: 700, opacity: 0.8 }}>Then choose Allow</span>
              </button>
            ) : snapshot?.trackId ? (
              <TrackMinimap trackId={snapshot.trackId} karts={snapshot.karts} highlightId={meId} size={260} />
            ) : null}
          </div>

          {!showTiltPrompt && (
            <div style={{ flexShrink: 0, height: 'clamp(7px, 2.6vmin, 10px)', borderRadius: '999px', background: 'rgba(255,255,255,0.12)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: 'rgba(255,255,255,0.35)' }} />
              <div ref={cockpitGaugeRef} style={{ position: 'absolute', top: 0, bottom: 0, width: '18px', borderRadius: '999px', left: 'calc(50% - 9px)', background: tier > 0 ? tierColor : (myKart?.color || '#38bdf8') }} />
            </div>
          )}

          <div style={{ flexShrink: 0, display: 'flex', gap: '0.25rem', justifyContent: 'center', alignItems: 'center', minHeight: 'clamp(24px, 9vmin, 32px)' }}>
            {useTilt ? (
              <>
                <button type="button" onClick={recenterGyro} style={{ ...smallBtn, border: '1px solid rgba(56,189,248,0.45)', background: 'rgba(56,189,248,0.14)', color: '#7dd3fc' }}>🎯 Center</button>
                <button type="button" onClick={flipTilt} style={smallBtn}>⇄ Invert</button>
                <button type="button" onClick={() => setPreferTouch(true)} style={smallBtn}>👆 Touch</button>
              </>
            ) : showTiltPrompt ? (
              <button type="button" onClick={() => setPreferTouch(true)} style={smallBtn}>👆 Use the touch pad instead</button>
            ) : tiltLive || needsTiltTap ? (
              <button type="button" onClick={() => (tiltLive ? setPreferTouch(false) : enableGyro())} style={{ ...smallBtn, background: 'rgba(250,204,21,0.16)', border: '1px solid rgba(250,204,21,0.5)', color: '#fde047' }}>🛞 Use tilt</button>
            ) : (
              <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 700, textAlign: 'center', lineHeight: 1.15 }}>
                {gyroStatus === 'denied'
                  ? 'Motion access is off. Close this tab and rejoin to turn on tilt.'
                  : hasFinePointer
                    ? '← → steer · Space drift · E item · S brake · H horn'
                    : 'Tilt isn’t available here: drag the pad to steer'}
              </span>
            )}
            {!showTiltPrompt && (
              <button
                type="button"
                aria-label="Horn"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  triggerHonk();
                }}
                style={{ ...smallBtn, flex: '0 0 auto', touchAction: 'none', fontSize: '0.9rem', padding: '0.12rem 0.5rem' }}
              >
                📣
              </button>
            )}
            {hostId && (
              <button type="button" onClick={() => sendHostAction({ type: 'FINISH_KART_RACE' })} style={{ ...smallBtn, flex: '0 0 auto', border: '1px solid rgba(250,204,21,0.45)', background: 'rgba(250,204,21,0.12)', color: '#fde047' }}>⏭️</button>
            )}
          </div>
        </div>

        {/* Right thumb */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minHeight: 0 }}>
          {!useTilt && <div style={{ flex: 0.75, minHeight: 0, display: 'flex' }}>{itemButton}</div>}
          {driftButton}
          {brakeButton}
        </div>

        {/* Overlays */}
        {flash && (
          <div key={flash.key} className="kart-edge-flash" style={{ boxShadow: `inset 0 0 36px 12px ${flash.color}` }} />
        )}
        {waiting && (
          <div style={{ position: 'absolute', bottom: 'clamp(2rem, 13vmin, 3rem)', left: '50%', transform: 'translateX(-50%)', background: 'rgba(56,189,248,0.95)', color: '#04121a', borderRadius: '999px', padding: '0.2rem 1rem', fontWeight: 900, fontSize: '0.82rem', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            ✅ You&rsquo;re ready! Waiting for the others...
          </div>
        )}
        {waiting && hostId && (
          <button
            type="button"
            onClick={() => sendHostAction({ type: 'FORCE_START_COUNTDOWN' })}
            style={{ position: 'absolute', top: '0.4rem', left: '50%', transform: 'translateX(-50%)', background: '#facc15', color: '#0f172a', border: 'none', borderRadius: '999px', padding: '0.25rem 1rem', fontWeight: 900, fontSize: '0.8rem', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            👑 Start now
          </button>
        )}
        {isCountdown && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: showTiltPrompt ? 'flex-start' : 'center', pointerEvents: 'none' }}>
            <div key={countdownSec} style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: showTiltPrompt ? 'clamp(2rem, 17vmin, 3.6rem)' : 'clamp(4rem, 42vmin, 9rem)', lineHeight: 1, color: countdownSec === 1 ? '#facc15' : '#fff', textShadow: '0 4px 24px #000', animation: 'kartCount 800ms ease' }}>{countdownSec}</div>
          </div>
        )}
        {incoming && !finished && (
          <div style={{ position: 'absolute', bottom: 'clamp(2rem, 13vmin, 3rem)', left: '50%', transform: 'translateX(-50%)', background: '#dc2626', border: '2px solid #fff', borderRadius: '999px', padding: '0.15rem 0.9rem', fontWeight: 900, fontSize: '0.8rem', whiteSpace: 'nowrap', pointerEvents: 'none', animation: 'kartPulse 320ms ease-in-out infinite alternate' }}>
            ⚠️ SHELL INCOMING!
          </div>
        )}
        {myKart?.statusText && !finished && !incoming && !isCountdown && (
          <div key={myKart.statusText} style={{ position: 'absolute', bottom: 'clamp(2rem, 13vmin, 3rem)', left: '50%', transform: 'translateX(-50%)', background: 'rgba(6,8,18,0.85)', border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: '999px', padding: '0.12rem 0.9rem', fontWeight: 900, fontSize: 'clamp(0.74rem, 4vmin, 0.95rem)', whiteSpace: 'nowrap', pointerEvents: 'none', maxWidth: '34%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {myKart.statusText}
          </div>
        )}
        {isSpunOut && !finished && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(239,68,68,0.18)', pointerEvents: 'none' }} />
        )}
        {finished && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,18,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: 'clamp(3rem, 28vmin, 6rem)', lineHeight: 1, color: rankColor }}>{ordinal(myKart?.finishRank || rank)}</div>
            <div style={{ fontWeight: 900, fontSize: '1.2rem' }}>🏁 {formatRaceTime(myKart?.finishTimeMs)}</div>
            {myKart?.bestLapTimeMs && <div style={{ color: '#94a3b8', fontWeight: 700 }}>Best lap {formatRaceTime(myKart.bestLapTimeMs)}</div>}
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.3rem' }}>Watch the others come home on the TV</div>
          </div>
        )}
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
    const standings: any[] = pd?.standings || [];

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
              <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '3rem', fontWeight: 900, lineHeight: 1.1, color: RANK_COLORS[Math.min(RANK_COLORS.length - 1, myRank - 1)], marginTop: '0.2rem' }}>
                {ordinal(myRank)}
              </div>
              <div style={{ fontWeight: 700, color: '#cbd5e1' }}>
                {pd?.myDnf ? 'Did not finish' : `🏁 ${formatRaceTime(pd?.myTimeMs)}`}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#4ade80', marginTop: '0.2rem' }}>
                +{myPoints.toLocaleString()} points
              </div>
              {pd?.myCupRank > 0 && (
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e2e8f0', marginTop: '0.15rem' }}>
                  {ordinal(pd.myCupRank)} overall · {(pd.myCupScore || 0).toLocaleString()} pts
                </div>
              )}
              {qualified && hd?.heats?.length > 1 && !hd?.isFinalHeat && (
                <div style={{ marginTop: '0.55rem', display: 'inline-block', padding: '0.3rem 0.8rem', borderRadius: '999px', background: 'rgba(250,204,21,0.22)', border: '1.5px solid #facc15', color: '#fde047', fontWeight: 900, fontSize: '0.8rem' }}>
                  🏆 QUALIFIED FOR THE FINAL!
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f8fafc', marginTop: '0.3rem' }}>
                🏆 {topHumanName} won the heat!
              </div>
              {wonPrediction ? (
                <div style={{ fontSize: '1rem', fontWeight: 900, color: '#facc15', marginTop: '0.35rem' }}>
                  🔮 You called it! +300 points
                </div>
              ) : (
                <div style={{ fontSize: '0.84rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                  Next heat coming right up!
                </div>
              )}
            </>
          )}
        </div>

        {standings.length > 0 && (
          <div style={{ background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '0.6rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {standings.map((row: any) => (
              <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0.4rem', borderRadius: '8px', background: row.id === meId ? 'rgba(56,189,248,0.16)' : 'transparent', fontSize: '0.86rem', opacity: row.isBot ? 0.72 : 1 }}>
                <span style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: RANK_COLORS[Math.min(RANK_COLORS.length - 1, row.rank - 1)] }}>{ordinal(row.rank)}</span> {row.avatar} {row.name}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#94a3b8', flexShrink: 0, marginLeft: '0.5rem' }}>
                  {row.dnf || !row.timeMs ? 'DNF' : formatRaceTime(row.timeMs)}
                </span>
              </div>
            ))}
          </div>
        )}

        {pd?.fastestLap && (
          <div style={{ textAlign: 'center', padding: '0.35rem 0.75rem', borderRadius: '10px', background: 'rgba(217,70,239,0.18)', border: '1px solid #d946ef', color: '#f0abfc', fontSize: '0.8rem', fontWeight: 800 }}>
            ⏱ Fastest lap: {pd.fastestLap.racerName} ({formatRaceTime(pd.fastestLap.timeMs)})
          </div>
        )}

        {hostId && (
          <button
            type="button"
            onClick={() => sendHostAction({ type: 'NEXT_KART_STEP' })}
            style={{ width: '100%', padding: '0.85rem', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #06b6d4, #2563eb)', color: '#fff', fontWeight: 900, fontSize: '0.95rem', cursor: 'pointer' }}
          >
            👑 Continue →
          </button>
        )}
      </div>
    );
  }

  return null;
}
