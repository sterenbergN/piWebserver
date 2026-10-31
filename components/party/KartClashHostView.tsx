'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DRIFT_TIER_COLORS, ITEM_META, RANK_COLORS, ROULETTE_EMOJIS, formatRaceTime, ordinal } from '@/lib/party/kart-shared';
import { KART_TRACKS, KartTrack, TRACK_LIST, TrackId } from '@/lib/party/kart-tracks';
import type { KartEvent, KartTelemetrySnapshot } from '@/lib/party/kart-physics';
import type { KartHeat } from '@/lib/party/games/kart-clash';
import type { SoundPrefs } from '@/components/party/audio';
import { CameraMode, KartScene, computeSplitGrid } from '@/components/party/kart/kartScene';
import { KartAudio } from '@/components/party/kart/kartAudio';
import TrackMinimap from '@/components/party/kart/TrackMinimap';

type SnapKart = KartTelemetrySnapshot['karts'][number];

const RECORDS_KEY = 'kartLapRecords';
type LapRecord = { timeMs: number; name: string; avatar: string };

/** Lap records live on this TV, per track and engine class. */
function loadLapRecords(): Record<string, LapRecord> {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
  } catch {
    return {};
  }
}

const HUD_INTERVAL_MS = 90; // The 3D view runs at full rate from a ref; React only redraws the HUD

const CAMERA_OPTIONS: { id: CameraMode; label: string }[] = [
  { id: 'split', label: '🏁 Drivers' },
  { id: 'leader', label: '🏎️ Leader' },
  { id: 'helicopter', label: '🚁 Blimp' },
  { id: 'action', label: '⚡ Battle' },
];

function ItemSlot({ kart }: { kart: SnapKart }) {
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    if (!kart.itemRoulette) return;
    const id = setInterval(() => setSpin((s) => s + 1), 70);
    return () => clearInterval(id);
  }, [kart.itemRoulette]);
  const item = kart.heldItem ? ITEM_META[kart.heldItem] : null;
  return (
    <div
      className="kart-item-slot"
      style={{
        borderColor: kart.itemRoulette ? '#facc15' : item ? item.color : undefined,
        boxShadow: item ? `0 0 18px ${item.color}` : undefined,
      }}
    >
      {kart.itemRoulette ? ROULETTE_EMOJIS[spin % ROULETTE_EMOJIS.length] : item ? item.emoji : null}
    </div>
  );
}

/** One driver's viewport overlay. */
function DriverHud({ kart, totalLaps, racing, compact }: { kart: SnapKart; totalLaps: number; racing: boolean; compact: boolean }) {
  const boosting = kart.boostTimer > 0 || kart.starTimer > 0;
  const kmh = Math.max(0, Math.round(Math.abs(kart.speed) * 2.2));
  const rankColor = RANK_COLORS[Math.min(RANK_COLORS.length - 1, kart.rank - 1)];
  const suffix = ordinal(kart.rank).replace(String(kart.rank), '');
  const tierColor = DRIFT_TIER_COLORS[kart.driftLevel];
  return (
    <div className="kart-tile">
      {racing && boosting && (
        <>
          <div className="kart-speedlines" />
          <div className="kart-boost-fx" />
        </>
      )}
      {racing && kart.hasIncomingShell && (
        <>
          <div className="kart-warn" />
          <div className="kart-warn-text">⚠️ SHELL INCOMING!</div>
        </>
      )}

      <div style={{ position: 'absolute', top: '2cqh', left: '1.6cqw', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25em', fontSize: 'clamp(11px, 3.3cqh, 22px)', maxWidth: '36cqw' }}>
        <span className="kart-chip" style={{ boxShadow: `inset 0 0 0 2px ${kart.color}` }}>
          <span>{kart.avatar}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{kart.name}</span>
        </span>
        {!kart.finished && (
          <span className="kart-chip">LAP {kart.lap}<span style={{ opacity: 0.6 }}>/{totalLaps}</span></span>
        )}
        {kart.autopilot && <span className="kart-chip" style={{ color: '#fbbf24' }}>📡 Autopilot</span>}
      </div>

      {!kart.finished && <ItemSlot kart={kart} />}

      {kart.statusText && !kart.finished && <div className="kart-status" key={kart.statusText}>{kart.statusText}</div>}

      {!kart.finished && (
        <>
          <div className="kart-speedo">
            <span style={{ textShadow: '0 2px 5px #000' }}>
              {kmh}<span style={{ fontSize: '0.65em', opacity: 0.75 }}> km/h</span>
              {kart.offRoad && !compact && <span style={{ marginLeft: '0.5em', color: '#fbbf24' }}>OFF-ROAD</span>}
            </span>
            <div className="kart-drift-bar" style={{ opacity: kart.drifting ? 1 : 0.35 }}>
              <div
                className="kart-drift-fill"
                style={{
                  width: `${kart.drifting ? (kart.driftLevel === 3 ? 100 : (kart.driftLevel * 100 + kart.driftCharge) / 3) : 0}%`,
                  background: kart.driftLevel === 0 ? '#e2e8f0' : tierColor,
                  boxShadow: kart.driftLevel > 0 ? `0 0 10px ${tierColor}` : undefined,
                }}
              />
            </div>
          </div>
          <div className="kart-rank-big" style={{ color: rankColor }} key={kart.rank}>
            {kart.rank}<small>{suffix}</small>
          </div>
        </>
      )}

      {kart.finished && (
        <div className="kart-finish">
          <div className="kart-finish-rank" style={{ color: rankColor }}>{ordinal(kart.finishRank || kart.rank)}</div>
          <div className="kart-chip" style={{ fontSize: 'clamp(12px, 5cqh, 30px)', marginTop: '0.3em' }}>
            🏁 {formatRaceTime(kart.finishTimeMs)}
          </div>
          {kart.bestLapTimeMs && (
            <div style={{ fontWeight: 800, fontSize: 'clamp(10px, 3cqh, 20px)', marginTop: '0.3em', textShadow: '0 2px 6px #000' }}>
              Best lap {formatRaceTime(kart.bestLapTimeMs)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Standings({ karts, fastestLapId }: { karts: SnapKart[]; fastestLapId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
      {karts.map((k) => {
        const item = k.heldItem ? ITEM_META[k.heldItem] : null;
        return (
          <div
            key={k.id}
            className="kart-rank-row"
            style={{
              background: k.isBot ? 'transparent' : 'rgba(255,255,255,0.08)',
              boxShadow: `inset 3px 0 0 ${k.color}`,
              opacity: k.isBot ? 0.85 : 1,
            }}
          >
            <span style={{ color: RANK_COLORS[Math.min(RANK_COLORS.length - 1, k.rank - 1)], fontWeight: 900, textAlign: 'center' }}>{k.rank}</span>
            <span style={{ textAlign: 'center' }}>{k.avatar}</span>
            <span className="kart-rank-name">{k.name}</span>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
              {item && <span>{item.emoji}</span>}
              {fastestLapId === k.id && <span title="Fastest lap" style={{ color: '#d946ef' }}>⏱</span>}
              {k.finished ? '🏁' : `L${k.lap}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The live race: full-screen canvas, HUD overlays and a broadcast sidebar. */
function RaceView({
  hd,
  roomCode,
  sendAction,
  soundPrefs,
  setSoundPrefs,
  onRequestQuit,
}: {
  hd: any;
  roomCode: string;
  sendAction: (action: any) => void;
  soundPrefs?: SoundPrefs;
  setSoundPrefs?: (next: SoundPrefs) => void;
  onRequestQuit?: () => void;
}) {
  const trackId: TrackId = hd.trackId || 'sunny-circuit';
  const raceId: string = hd.raceId || '';
  const track: KartTrack = KART_TRACKS[trackId] || KART_TRACKS['sunny-circuit'];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<KartScene | null>(null);
  const audioRef = useRef<KartAudio | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('split');
  const cameraRef = useRef<CameraMode>('split');
  const [snap, setSnap] = useState<KartTelemetrySnapshot | null>(hd.initialSnapshot || null);
  const [aspect, setAspect] = useState(16 / 9);
  const [flashKey, setFlashKey] = useState(0);
  const [needsSoundTap, setNeedsSoundTap] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const snapRef = useRef<KartTelemetrySnapshot | null>(hd.initialSnapshot || null);
  const prefsRef = useRef(soundPrefs);

  useEffect(() => {
    cameraRef.current = cameraMode;
  }, [cameraMode]);

  const handleEvent = useCallback((e: KartEvent) => {
    const karts = snapRef.current?.karts || [];
    const kart = e.kartId ? karts.find((k) => k.id === e.kartId) : null;
    // Events with no kart (explosions, chaos) are world-level and worth hearing
    const human = kart ? !kart.isBot : e.type === 'go' || e.type === 'clash';
    audioRef.current?.event(e, human);
    if (e.type === 'lightning') setFlashKey(Date.now());
  }, []);

  // Scene, audio and the render loop live for one race on one track
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: KartScene;
    try {
      scene = new KartScene(canvas, track, handleEvent);
    } catch (err) {
      console.error('Kart Clash could not start WebGL', err);
      setWebglFailed(true);
      return;
    }
    sceneRef.current = scene;
    const audio = new KartAudio(track);
    audioRef.current = audio;
    audio.resume();
    audio.setPrefs(prefsRef.current?.music !== false, prefsRef.current?.sfx !== false);
    if (snapRef.current) scene.setSnapshot(snapRef.current);

    let animId = 0;
    let lastAspect = 0;
    const loop = (now: number) => {
      animId = requestAnimationFrame(loop);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const nextAspect = width / height;
      if (Math.abs(nextAspect - lastAspect) > 0.01) {
        lastAspect = nextAspect;
        setAspect(nextAspect);
      }
      scene.render(now, cameraRef.current, width, height);
    };
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      scene.dispose();
      audio.dispose();
      sceneRef.current = null;
      audioRef.current = null;
    };
  }, [track, handleEvent]);

  // 30Hz telemetry: straight to the scene and audio, throttled to React for the HUD
  useEffect(() => {
    if (!raceId) return;
    const sse = new EventSource(`/api/party/stream/kart?roomCode=${encodeURIComponent(roomCode)}&role=host`);
    let lastHud = 0;
    sse.onmessage = (ev) => {
      if (!ev.data) return;
      let data: KartTelemetrySnapshot;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (data.raceId !== raceId) return; // a late tick from the previous race
      snapRef.current = data;
      sceneRef.current?.setSnapshot(data);
      audioRef.current?.update(data);
      const now = performance.now();
      if (now - lastHud >= HUD_INTERVAL_MS) {
        lastHud = now;
        setSnap(data);
        setNeedsSoundTap(Boolean(audioRef.current) && !audioRef.current!.running);
      }
    };
    return () => sse.close();
  }, [raceId, roomCode]);

  useEffect(() => {
    prefsRef.current = soundPrefs;
    audioRef.current?.setPrefs(soundPrefs?.music !== false, soundPrefs?.sfx !== false);
  }, [soundPrefs]);

  const allKarts = snap?.karts || [];
  const humanKarts = allKarts.filter((k) => !k.isBot);
  const views = humanKarts.length > 0 ? humanKarts : allKarts.slice(0, 1);
  const { cols, rows } = computeSplitGrid(views.length, aspect);
  const compact = views.length > 2;
  const sorted = [...allKarts].sort((a, b) => a.rank - b.rank);
  const totalLaps = snap?.totalLaps || 3;
  const racing = Boolean(snap && !snap.waitingForOrientation && snap.countdownMs <= 0);
  const countdownSec = snap && !snap.waitingForOrientation && snap.countdownMs > 0 ? Math.min(3, Math.ceil(snap.countdownMs / 1000)) : 0;
  const showGo = Boolean(snap && racing && snap.raceTimeMs < 1100);
  const leaderLap = sorted[0]?.lap || 1;
  const spareTiles = cols * rows - views.length;

  return (
    <div className="kart-race-root">
      <div className="kart-race-stage" onPointerDown={() => audioRef.current?.resume()}>
        <canvas ref={canvasRef} />

        {webglFailed && (
          <div className="kart-center-overlay">
            <div className="kart-title-banner">This screen can&rsquo;t run 3D graphics, so the race can&rsquo;t be shown here. Try opening the host page in Chrome or Edge.</div>
          </div>
        )}

        {cameraMode === 'split' && (
          <div className="kart-hud-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {views.map((k) => (
              <DriverHud key={k.id} kart={k} totalLaps={totalLaps} racing={racing} compact={compact} />
            ))}
            {Array.from({ length: spareTiles }).map((_, i) => (
              <div className="kart-tile" key={i}>
                <span className="kart-chip" style={{ position: 'absolute', top: '3cqh', left: '2cqw', fontSize: 'clamp(11px, 4cqh, 20px)' }}>
                  <span style={{ color: '#f87171' }}>●</span> LIVE · {sorted[0]?.name || 'Leader'}
                </span>
              </div>
            ))}
          </div>
        )}

        {snap?.announcement && !snap.waitingForOrientation && (
          <div className="kart-announce" key={snap.announcement}>{snap.announcement}</div>
        )}
        {!snap?.announcement && snap?.finishCountdownMs != null && !snap.celebrating && (
          <div className="kart-announce">🏁 Race ends in {Math.ceil(snap.finishCountdownMs / 1000)}s</div>
        )}

        {flashKey > 0 && <div className="kart-flash" key={flashKey} />}

        {snap?.waitingForOrientation && (
          <div className="kart-center-overlay">
            <div className="kart-title-banner">
              <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>{track.emoji}</div>
              <div style={{ fontFamily: 'var(--party-font-display)', fontSize: 'clamp(1.6rem, 3.6vw, 2.8rem)', fontWeight: 900 }}>{track.name}</div>
              <div style={{ color: '#cbd5e1', fontSize: '0.95rem', margin: '0.15rem 0 0.7rem' }}>
                {hd.heatName} · {snap.speedClass} · {totalLaps} laps
              </div>
              <div style={{ fontWeight: 900, fontSize: '1.15rem', color: 'var(--party-cyan)', marginBottom: '0.5rem' }}>📱 Turn your phone sideways to get ready!</div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '0.7rem' }}>
                {(snap.humanRacersStatus || []).map((r) => (
                  <span
                    key={r.id}
                    style={{
                      background: r.isHorizontal ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.07)',
                      border: `1.5px solid ${r.isHorizontal ? 'var(--party-green)' : 'rgba(255,255,255,0.25)'}`,
                      borderRadius: '999px',
                      padding: '0.28rem 0.8rem',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                    }}
                  >
                    {r.avatar} {r.name} {r.isHorizontal ? '✅' : '⏳'}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => sendAction({ type: 'FORCE_START_COUNTDOWN' })}
                className="party-btn party-btn-yellow party-btn-inline"
                style={{ fontSize: '0.95rem', padding: '0.55rem 1.2rem' }}
              >
                🏁 Start now <span style={{ opacity: 0.7, fontWeight: 700 }}>(auto in {Math.ceil((snap.orientationAutoStartMs || 0) / 1000)}s)</span>
              </button>
            </div>
          </div>
        )}

        {countdownSec > 0 && (
          <div className="kart-center-overlay">
            <div className="kart-countdown" key={countdownSec} style={{ color: countdownSec === 1 ? '#facc15' : '#ffffff' }}>{countdownSec}</div>
            <div className="kart-chip" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)', color: countdownSec === 1 ? '#facc15' : '#fff' }}>
              {countdownSec === 1 ? '🚀 HOLD DRIFT NOW!' : 'Wait for the 1, then hold DRIFT for a rocket start'}
            </div>
          </div>
        )}
        {showGo && (
          <div className="kart-center-overlay">
            <div className="kart-countdown" style={{ color: '#22ff66' }}>GO!</div>
          </div>
        )}
      </div>

      <aside className="kart-side">
        <div className="kart-side-card" style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 900, fontSize: '0.98rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.emoji} {track.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 800, fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.1rem' }}>
            <span>LAP {Math.min(leaderLap, totalLaps)}/{totalLaps}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '1.05rem', color: '#f8fafc' }}>{formatRaceTime(snap?.raceTimeMs ?? 0)}</span>
          </div>
        </div>

        <div className="kart-side-card" style={{ flex: '0 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <Standings karts={sorted} fastestLapId={snap?.fastestLap?.racerId} />
        </div>

        <div className="kart-side-card" style={{ display: 'flex', justifyContent: 'center', flex: '1 1 0', minHeight: 110, alignItems: 'center', overflow: 'hidden' }}>
          <TrackMinimap trackId={trackId} karts={allKarts} size={360} />
        </div>

        {snap?.fastestLap && (
          <div className="kart-side-card" style={{ fontSize: '0.74rem', fontWeight: 800, display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
            <span style={{ color: '#f0abfc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⏱ {snap.fastestLap.racerName}</span>
            <span style={{ fontFamily: 'monospace' }}>{formatRaceTime(snap.fastestLap.timeMs)}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
          {CAMERA_OPTIONS.map((opt) => (
            <button key={opt.id} type="button" className="kart-side-btn" data-on={cameraMode === opt.id} onClick={() => setCameraMode(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {needsSoundTap ? (
            <button type="button" className="kart-side-btn" style={{ background: '#facc15', color: '#000' }} onClick={() => { audioRef.current?.resume(); setNeedsSoundTap(false); }}>
              🔊 Tap for sound
            </button>
          ) : (
            <>
              <button
                type="button"
                className="kart-side-btn"
                data-on={soundPrefs?.music !== false}
                onClick={() => soundPrefs && setSoundPrefs?.({ ...soundPrefs, music: !soundPrefs.music })}
              >
                🎵 Music
              </button>
              <button
                type="button"
                className="kart-side-btn"
                data-on={soundPrefs?.sfx !== false}
                onClick={() => soundPrefs && setSoundPrefs?.({ ...soundPrefs, sfx: !soundPrefs.sfx })}
              >
                🔊 SFX
              </button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button type="button" className="kart-side-btn" onClick={() => sendAction({ type: 'FINISH_KART_RACE' })}>⏭️ End race</button>
          <button type="button" className="kart-side-btn" onClick={() => onRequestQuit?.()}>🚪 Quit</button>
        </div>
      </aside>
    </div>
  );
}

// ─── Main Host View Component ──────────────────────────────────────────────────

export default function KartClashHostView({
  state,
  roomCode,
  secondsLeft,
  pct,
  sendAction,
  soundPrefs,
  setSoundPrefs,
  onRequestQuit,
}: {
  state: any;
  roomCode: string;
  secondsLeft: number | null;
  pct: number;
  sendAction: (action: any) => void;
  soundPrefs?: SoundPrefs;
  setSoundPrefs?: (next: SoundPrefs) => void;
  onRequestQuit?: () => void;
}) {
  const hd = state.hostData || {};
  const [selectedPlayerForSwap, setSelectedPlayerForSwap] = useState<string | null>(null);
  const [lapRecords, setLapRecords] = useState<Record<string, LapRecord>>({});
  const [newRecord, setNewRecord] = useState<LapRecord | null>(null);

  useEffect(() => {
    setLapRecords(loadLapRecords());
  }, []);

  // When results land, see whether a human beat this TV's lap record
  const resultsKey = state.phase === 'RACE_RESULTS' ? `${hd.trackId}:${hd.speedClass}:${hd.raceNumber}:${hd.heatId}` : null;
  useEffect(() => {
    if (!resultsKey) {
      setNewRecord(null);
      return;
    }
    const key = `${hd.trackId}:${hd.speedClass}`;
    const records = loadLapRecords();
    const best = (hd.standings || [])
      .filter((r: any) => !r.isBot && r.bestLapMs)
      .sort((a: any, b: any) => a.bestLapMs - b.bestLapMs)[0];
    if (!best || (records[key] && records[key].timeMs <= best.bestLapMs)) return;
    const record = { timeMs: best.bestLapMs, name: best.name, avatar: best.avatar };
    const next = { ...records, [key]: record };
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the record just won't persist
    }
    setLapRecords(next);
    setNewRecord(record);
  }, [resultsKey]);

  // ─── Phase 1: HEAT_SETUP (Host-Controlled Tournament Heat Board) ─────────────
  if (state.phase === 'HEAT_SETUP') {
    const heats: KartHeat[] = hd.heats || [];
    const activePlayers = (state.playerOrder || [])
      .map((pid: string) => state.players?.[pid])
      .filter((p: any) => p && !p.left);

    return (
      <div className="phase-enter" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'rgba(255,255,255,0.04)', border: '1.5px solid var(--party-border)', borderRadius: '18px', padding: '1rem 1.35rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-cyan)' }}>
              🔥 Kart Clash Tournament Board
            </div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.8rem', fontWeight: 900 }}>
              Set Up Race Heats &amp; Bracket
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)' }}>
              {selectedPlayerForSwap
                ? `✋ Selected ${state.players?.[selectedPlayerForSwap]?.name} — click another player to swap heats, or click "+ Assign Here" on any pending heat!`
                : 'Tip: Click any player in a pending heat to manually move or swap them, or use Randomize Heats.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(0,0,0,0.35)', padding: '0.35rem 0.65rem', borderRadius: '12px', border: '1px solid var(--party-border)' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)' }}>Racers/Heat:</span>
              {[2, 4, 8].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => sendAction({ type: 'SET_KART_CONFIG', heatSize: sz })}
                  style={{
                    background: hd.heatSize === sz ? 'var(--party-yellow)' : 'transparent',
                    color: hd.heatSize === sz ? '#000' : '#fff',
                    border: '1.5px solid var(--party-yellow)',
                    borderRadius: '8px',
                    padding: '0.2rem 0.55rem',
                    fontWeight: 900,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  {sz}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => sendAction({ type: 'SET_KART_CONFIG', aiBots: !hd.aiBots })}
              style={{
                background: hd.aiBots ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${hd.aiBots ? 'var(--party-green)' : 'var(--party-border)'}`,
                color: hd.aiBots ? 'var(--party-green)' : 'var(--party-text-muted)',
                borderRadius: '10px',
                padding: '0.45rem 0.8rem',
                fontWeight: 800,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              🤖 AI Bots: {hd.aiBots ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() => { setSelectedPlayerForSwap(null); sendAction({ type: 'RANDOMIZE_HEATS' }); }}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.84rem', borderColor: 'var(--party-cyan)', color: 'var(--party-cyan)' }}
            >
              🎲 Randomize Heats
            </button>

            <button
              type="button"
              onClick={() => sendAction({ type: 'ADD_CUSTOM_HEAT' })}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.84rem' }}
            >
              ➕ Add Heat
            </button>
          </div>
        </div>

        {/* Heats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '1rem' }}>
          {heats.map((heat) => {
            const isNext = heat.id === hd.nextHeatId;
            const isFinal = heat.stage === 'final';
            return (
              <div
                key={heat.id}
                className="party-card"
                style={{
                  maxWidth: 'none',
                  padding: '1.1rem',
                  border: `2.5px solid ${
                    heat.status === 'completed'
                      ? 'var(--party-green)'
                      : isFinal
                      ? 'var(--party-yellow)'
                      : isNext
                      ? 'var(--party-cyan)'
                      : 'var(--party-border)'
                  }`,
                  background: isFinal ? 'rgba(250, 204, 21, 0.07)' : undefined,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '1.15rem', color: isFinal ? 'var(--party-yellow)' : '#fff' }}>
                      {heat.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)', fontWeight: 700 }}>
                      {heat.status === 'completed'
                        ? `✅ Completed · ${KART_TRACKS[heat.trackId || 'sunny-circuit']?.name}`
                        : `${heat.playerIds.length} Racer${heat.playerIds.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    {heat.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => sendAction({ type: 'START_HEAT', heatId: heat.id })}
                        className="party-btn party-btn-primary party-btn-inline"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        🏁 Race This Heat
                      </button>
                    )}
                    {heat.status === 'pending' && heats.length > 1 && (
                      <button
                        type="button"
                        onClick={() => sendAction({ type: 'REMOVE_HEAT', heatId: heat.id })}
                        title="Remove Heat"
                        style={{ background: 'transparent', border: 'none', color: 'var(--party-text-muted)', cursor: 'pointer', fontWeight: 900 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Players in this Heat */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {heat.playerIds.map((pid, idx) => {
                    const p = state.players?.[pid];
                    if (!p) return null;
                    const isSelected = selectedPlayerForSwap === pid;
                    const qualified = heat.qualifiers?.includes(pid);
                    const standingRow = heat.standings?.find((s) => s.id === pid);

                    return (
                      <div
                        key={pid}
                        onClick={() => {
                          if (heat.status !== 'pending') return;
                          if (!selectedPlayerForSwap) {
                            setSelectedPlayerForSwap(pid);
                          } else if (selectedPlayerForSwap === pid) {
                            setSelectedPlayerForSwap(null);
                          } else {
                            sendAction({
                              type: 'ASSIGN_HEAT_PLAYER',
                              playerId: selectedPlayerForSwap,
                              targetHeatId: heat.id,
                              swapWithPlayerId: pid,
                            });
                            setSelectedPlayerForSwap(null);
                          }
                        }}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '10px',
                          background: isSelected ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255,255,255,0.05)',
                          border: `2px solid ${isSelected ? 'var(--party-cyan)' : p.avatarColor}`,
                          cursor: heat.status === 'pending' ? 'pointer' : 'default',
                        }}
                      >
                        <span style={{ fontWeight: 800, color: p.avatarColor }}>
                          {heat.status === 'completed' && standingRow
                            ? `${['🥇', '🥈', '🥉'][standingRow.rank - 1] || `#${standingRow.rank}`} `
                            : `${idx + 1}. `}
                          {p.avatar} {p.name}
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 900, color: qualified ? 'var(--party-green)' : 'var(--party-text-muted)' }}>
                          {heat.status === 'completed'
                            ? qualified
                              ? '✅ QUALIFIED'
                              : `+${standingRow?.points || 0} pts`
                            : isSelected
                            ? '✋ Selected'
                            : 'Tap to swap'}
                        </span>
                      </div>
                    );
                  })}

                  {heat.status === 'pending' && selectedPlayerForSwap && !heat.playerIds.includes(selectedPlayerForSwap) && heat.playerIds.length < 8 && (
                    <button
                      type="button"
                      onClick={() => {
                        sendAction({
                          type: 'ASSIGN_HEAT_PLAYER',
                          playerId: selectedPlayerForSwap,
                          targetHeatId: heat.id,
                        });
                        setSelectedPlayerForSwap(null);
                      }}
                      style={{
                        background: 'rgba(6, 182, 212, 0.15)',
                        border: '1.5px dashed var(--party-cyan)',
                        borderRadius: '10px',
                        padding: '0.45rem',
                        color: 'var(--party-cyan)',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                      }}
                    >
                      ➕ Move {state.players?.[selectedPlayerForSwap]?.name} to {heat.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Pool of All Players to Assign to Next Pending Heat */}
        {heats.some((h) => h.status === 'pending') && (
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--party-border)', borderRadius: '14px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)' }}>
              All Room Racers (tap to select &amp; assign):
            </span>
            {activePlayers.map((p: any) => {
              const sel = selectedPlayerForSwap === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlayerForSwap(sel ? null : p.id)}
                  style={{
                    background: sel ? 'var(--party-cyan)' : 'rgba(255,255,255,0.06)',
                    color: sel ? '#000' : p.avatarColor,
                    border: `1.5px solid ${sel ? '#fff' : p.avatarColor}`,
                    borderRadius: '999px',
                    padding: '0.22rem 0.65rem',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {p.avatar} {p.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Bottom Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
          {hd.nextHeatId && (
            <button
              type="button"
              onClick={() => sendAction({ type: 'START_HEAT', heatId: hd.nextHeatId })}
              className="party-btn party-btn-primary party-btn-huge"
            >
              🏁 Start {heats.find((h) => h.id === hd.nextHeatId)?.name || 'Next Heat'}!
            </button>
          )}
          {hd.canBuildFinals && (
            <>
              <button
                type="button"
                onClick={() => sendAction({ type: 'BUILD_FINALS_HEAT', includeConsolation: false })}
                className="party-btn party-btn-yellow party-btn-inline"
                style={{ fontSize: '1.05rem', padding: '0.85rem 1.4rem' }}
              >
                🏆 Seed Championship Final
              </button>
              <button
                type="button"
                onClick={() => sendAction({ type: 'BUILD_FINALS_HEAT', includeConsolation: true })}
                className="party-btn party-btn-outline party-btn-inline"
                style={{ fontSize: '0.95rem', padding: '0.85rem 1.2rem', borderColor: 'var(--party-cyan)', color: 'var(--party-cyan)' }}
              >
                💥 Seed Consolation + Final
              </button>
            </>
          )}
          {heats.some((h) => h.status === 'completed') && (
            <button
              type="button"
              onClick={() => sendAction({ type: 'END_TOURNAMENT' })}
              className="party-btn party-btn-outline party-btn-inline"
              style={{ fontSize: '1rem', padding: '0.85rem 1.35rem', borderColor: 'var(--party-yellow)', color: 'var(--party-yellow)' }}
            >
              🏆 Finish Tournament &amp; Crown Champion
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Phase 2: TRACK_VOTE ────────────────────────────────────────────────────
  if (state.phase === 'TRACK_VOTE') {
    const trackVotes: Record<string, TrackId> = hd.trackVotes || {};
    const activeRacers: string[] = hd.activeRacers || [];
    const leadingVotes = Math.max(0, ...TRACK_LIST.map((t) => Object.values(trackVotes).filter((v) => v === t.id).length));

    return (
      <div className="phase-enter center-stack" style={{ width: '100%', maxWidth: '1280px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--party-cyan)' }}>
          {hd.heatName}
          {hd.speedClass ? ` · ${hd.speedClass}` : ''}
          {hd.itemsMode && hd.itemsMode !== 'normal' ? ` · ${hd.itemsMode} items` : ''}
        </div>
        <div className="host-phase-title" style={{ marginBottom: '0.25rem', fontSize: 'clamp(1.5rem, 6vh, 3.4rem)' }}>
          <span className="host-emoji">🗳️</span> Vote for the Next Track!
        </div>

        {secondsLeft !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0 auto 0.9rem' }}>
            <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}>
              <div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-yellow)' }} />
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
          </div>
        )}

        <div className="kart-vote-grid">
          {TRACK_LIST.map((t) => {
            const voters = Object.entries(trackVotes)
              .filter(([, tid]) => tid === t.id)
              .map(([pid]) => pid);
            const leading = voters.length > 0 && voters.length === leadingVotes;
            return (
              <div
                key={t.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'clamp(90px, 17vh, 156px) minmax(0, 1fr)',
                  gap: '0.85rem',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: '18px',
                  border: `2.5px solid ${leading ? 'var(--party-yellow)' : 'rgba(255,255,255,0.14)'}`,
                  background: `linear-gradient(120deg, ${t.theme.skyHorizon}3d, ${t.theme.skyTop}70)`,
                  boxShadow: leading ? '0 0 24px rgba(250,204,21,0.45)' : undefined,
                  textAlign: 'left',
                  transition: 'box-shadow 200ms, border-color 200ms',
                }}
              >
                <div style={{ background: 'rgba(5,8,18,0.6)', borderRadius: '14px', padding: '0.3rem', height: 'clamp(90px, 17vh, 156px)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TrackMinimap trackId={t.id} size={144} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontWeight: 900, fontSize: '1.15rem', lineHeight: 1.15 }}>{t.emoji} {t.name}</span>
                    <span className="badge" style={{ fontSize: '0.7rem', flexShrink: 0 }}>{t.difficulty}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#d7deea', lineHeight: 1.3, margin: '0.2rem 0 0.25rem' }}>{t.tagline}</div>
                  {lapRecords[`${t.id}:${hd.speedClass}`] && (
                    <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#f0abfc', marginBottom: '0.3rem' }}>
                      ⏱ Lap record {formatRaceTime(lapRecords[`${t.id}:${hd.speedClass}`].timeMs)} · {lapRecords[`${t.id}:${hd.speedClass}`].avatar} {lapRecords[`${t.id}:${hd.speedClass}`].name}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', minHeight: '26px' }}>
                    {voters.map((pid) => (
                      <span
                        key={pid}
                        style={{
                          background: 'rgba(5,8,18,0.6)',
                          border: `1.5px solid ${state.players?.[pid]?.avatarColor || '#fff'}`,
                          borderRadius: '999px',
                          padding: '0.08rem 0.5rem',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                        }}
                      >
                        {state.players?.[pid]?.avatar} {state.players?.[pid]?.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--party-text-muted)', textTransform: 'uppercase' }}>On the grid:</span>
          {activeRacers.map((pid) => {
            const p = state.players?.[pid];
            if (!p) return null;
            const voted = Boolean(trackVotes[pid]);
            return (
              <span
                key={pid}
                style={{
                  border: `2px solid ${p.avatarColor}`,
                  background: voted ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '999px',
                  padding: '0.2rem 0.7rem',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                }}
              >
                {voted ? '✓ ' : ''}{p.avatar} {p.name}
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => sendAction({ type: 'LOCK_TRACK_VOTE' })}
            className="party-btn party-btn-yellow party-btn-inline"
            style={{ fontSize: '0.9rem', padding: '0.4rem 1rem', marginLeft: '0.5rem' }}
          >
            🏁 Lock in &amp; race
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase 3: RACING ────────────────────────────────────────────────────────
  if (state.phase === 'RACING') {
    return (
      <RaceView
        key={hd.raceId}
        hd={hd}
        roomCode={roomCode}
        sendAction={sendAction}
        soundPrefs={soundPrefs}
        setSoundPrefs={setSoundPrefs}
        onRequestQuit={onRequestQuit}
      />
    );
  }

  // ─── Phase 4: RACE_RESULTS ──────────────────────────────────────────────────
  if (state.phase === 'RACE_RESULTS') {
    const standings: any[] = hd.standings || [];
    const cup: any[] = hd.cupStandings || [];
    const qualifiers: string[] = hd.qualifiers || [];
    const predictors: string[] = hd.correctPredictors || [];
    const fastestLap = hd.fastestLap;
    const podium: { row: any; height: number; medal: string; color: string; delay: number }[] = [
      { row: standings[1], height: 96, medal: '🥈', color: '#cbd5e1', delay: 200 },
      { row: standings[0], height: 142, medal: '🥇', color: '#facc15', delay: 450 },
      { row: standings[2], height: 68, medal: '🥉', color: '#f59e0b', delay: 0 },
    ];
    const nextLabel = hd.format === 'grand-prix'
      ? (hd.raceNumber >= hd.totalRaces ? 'Final standings' : `Race ${hd.raceNumber + 1} of ${hd.totalRaces}`)
      : 'Back to the heat board';

    return (
      <div className="phase-enter center-stack" style={{ width: '100%', maxWidth: '1240px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--party-cyan)' }}>
          {hd.heatName}
          {hd.trackId && KART_TRACKS[hd.trackId as TrackId] ? ` · ${KART_TRACKS[hd.trackId as TrackId].emoji} ${KART_TRACKS[hd.trackId as TrackId].name}` : ''}
        </div>
        <div className="host-phase-title" style={{ marginBottom: '0.5rem', fontSize: 'clamp(1.5rem, 6vh, 3.4rem)' }}>
          <span className="host-emoji">🏁</span> Race Results
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1.1rem', width: '100%', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', minWidth: 0 }}>
            <div className="kart-podium">
              {podium.map(({ row, height, medal, color, delay }, i) => row ? (
                <div key={row.id} className="kart-podium-col" style={{ animationDelay: `${delay}ms`, flex: i === 1 ? 1.2 : 1 }}>
                  {i === 1 && <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>👑</span>}
                  <span style={{ fontSize: i === 1 ? '3.2rem' : '2.5rem', lineHeight: 1.1 }}>{row.avatar}</span>
                  <span style={{ fontWeight: 900, fontSize: i === 1 ? '1.15rem' : '1rem', color: row.color, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                  <div
                    style={{
                      width: '100%',
                      height: `min(${height}px, ${(height / 10.8).toFixed(1)}vh)`,
                      background: `linear-gradient(180deg, ${color}, ${color}55)`,
                      border: `2px solid ${color}`,
                      borderRadius: '14px 14px 0 0',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--party-font-display)',
                      fontWeight: 900,
                      color: '#0b0f1a',
                    }}
                  >
                    <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{medal}</span>
                    {row.points > 0 && <span style={{ fontSize: '0.95rem' }}>+{row.points.toLocaleString()}</span>}
                  </div>
                </div>
              ) : <div key={i} style={{ flex: 1 }} />)}
            </div>

            {newRecord && (
              <div style={{ textAlign: 'center', background: 'linear-gradient(90deg, #d946ef, #f59e0b)', color: '#10060f', borderRadius: '12px', padding: '0.5rem 0.9rem', fontWeight: 900, fontSize: '1.05rem' }}>
                🏆 NEW LAP RECORD! {newRecord.avatar} {newRecord.name} · {formatRaceTime(newRecord.timeMs)}
              </div>
            )}

            {fastestLap && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', background: 'rgba(217,70,239,0.16)', border: '1.5px solid #d946ef', borderRadius: '12px', padding: '0.5rem 0.9rem' }}>
                <span style={{ fontWeight: 900 }}>⏱ Fastest lap · {fastestLap.racerName}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#f0abfc' }}>{formatRaceTime(fastestLap.timeMs)}</span>
              </div>
            )}

            {predictors.length > 0 && (
              <div style={{ background: 'rgba(250, 204, 21, 0.12)', border: '1.5px solid var(--party-yellow)', borderRadius: '12px', padding: '0.5rem 0.9rem', color: 'var(--party-yellow)', fontWeight: 900 }}>
                🔮 Pit Crew Bonus (+300): {predictors.map((pid) => state.players?.[pid]?.name).filter(Boolean).join(', ')} called it!
              </div>
            )}

            {cup.length > 1 && (
              <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--party-border)', borderRadius: '14px', padding: '0.6rem 0.8rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-yellow)', marginBottom: '0.3rem' }}>
                  🏆 {hd.format === 'grand-prix' ? `Cup standings after race ${hd.raceNumber} of ${hd.totalRaces}` : 'Tournament standings'}
                </div>
                {cup.map((row, i) => (
                  <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1.6rem 1.6rem minmax(0, 1fr) auto auto', gap: '0.35rem', alignItems: 'center', padding: '0.14rem 0', fontWeight: 800 }}>
                    <span style={{ color: RANK_COLORS[Math.min(RANK_COLORS.length - 1, i)] }}>{i + 1}</span>
                    <span>{row.avatar}</span>
                    <span style={{ color: row.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--party-green)' }}>{row.gained ? `+${row.gained.toLocaleString()}` : ''}</span>
                    <span style={{ fontFamily: 'monospace', minWidth: '4.2ch', textAlign: 'right' }}>{row.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
            {standings.map((row, i) => {
              const isQual = qualifiers.includes(row.id);
              return (
                <div
                  key={row.id}
                  className="kart-podium-col"
                  style={{
                    animationDelay: `${600 + i * 70}ms`,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    padding: '0.42rem 0.8rem',
                    borderRadius: '12px',
                    background: row.isBot ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.09)',
                    border: `1.5px solid ${row.rank === 1 ? 'var(--party-yellow)' : isQual ? 'var(--party-green)' : 'rgba(255,255,255,0.1)'}`,
                    opacity: row.isBot ? 0.78 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.15rem', fontWeight: 900, width: '2.1rem', color: RANK_COLORS[Math.min(RANK_COLORS.length - 1, row.rank - 1)] }}>
                      {ordinal(row.rank)}
                    </span>
                    <span style={{ fontSize: '1.2rem' }}>{row.avatar}</span>
                    <span style={{ fontWeight: 900, color: row.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.name}
                    </span>
                    {row.isBot && <span style={{ fontSize: '0.68rem', color: 'var(--party-text-muted)', fontWeight: 800 }}>BOT</span>}
                    {hd.format === 'tournament' && isQual && !hd.isFinalHeat && (hd.heats?.length || 0) > 1 && (
                      <span className="badge" style={{ borderColor: 'var(--party-green)', color: 'var(--party-green)', fontWeight: 900, fontSize: '0.68rem' }}>
                        ✅ Finals
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexShrink: 0 }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--party-text-muted)', fontSize: '0.88rem' }}>
                      {row.dnf || !row.timeMs ? 'DNF' : formatRaceTime(row.timeMs)}
                    </span>
                    {!row.isBot && (
                      <span style={{ fontWeight: 900, color: 'var(--party-green)', minWidth: '3.4rem', textAlign: 'right' }}>
                        +{row.points.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          {secondsLeft !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '260px' }}>
              <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}>
                <div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-green)' }} />
              </div>
              <div style={{ fontSize: '1rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
            </div>
          )}
          <button type="button" onClick={() => sendAction({ type: 'NEXT_KART_STEP' })} className="party-btn party-btn-primary party-btn-inline" style={{ fontSize: '0.95rem', padding: '0.55rem 1.2rem' }}>
            {nextLabel} →
          </button>
        </div>
      </div>
    );
  }

  return null;
}
