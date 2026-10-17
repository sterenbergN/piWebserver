'use client';
import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { shareResultsCard } from '@/components/party/resultsCard';
import { GAME_TITLES, ReactionLayer, ScoreTicker, SoundBar, TitleCard, VoterFaces, useImmersive, useShowDirector } from '@/components/party/HostShow';
import { HowToPlayModal, ShareInviteButton } from '@/components/party/PhoneExtras';
import { GAME_GUIDES } from '@/lib/party/guides';
import { GameType } from '@/lib/party/types';

// Gradient titles paint text with a transparent fill, which turns emoji into flat
// silhouettes. Wrap each emoji so it keeps its own colours.
const EMOJI_RUN = new RegExp('(\\p{Extended_Pictographic}(?:\uFE0F|\\p{Emoji_Modifier}|\u200D\\p{Extended_Pictographic})*)', 'gu');
function EmojiText({ text }: { text: string }) {
  return <>{String(text ?? '').split(EMOJI_RUN).map((part, i) => (i % 2 ? <span key={i} className="host-emoji">{part}</span> : part))}</>;
}

function useCountdown(timerStart?: number, timerDuration?: number) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!timerStart || !timerDuration) { setSecondsLeft(null); return; }
    const tick = () => {
      const elapsed = (Date.now() - timerStart) / 1000;
      setSecondsLeft(Math.max(0, timerDuration - elapsed));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [timerStart, timerDuration]);
  const pct = (timerStart && timerDuration && secondsLeft !== null)
    ? (secondsLeft / timerDuration) * 100 : 100;
  return { secondsLeft, pct };
}

function FakerCountdown({ onDone }: { onDone: () => void }) {
  const [val, setVal] = useState(3);
  const doneRef = useRef(onDone);
  
  // Keep the latest ref fresh without triggering useEffect
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let i = 0;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    
    const go = () => {
      const steps = [3, 2, 1, 0];
      setVal(steps[i]);
      i++;
      if (i < steps.length) {
        timeouts.push(setTimeout(go, 900));
      } else {
        timeouts.push(setTimeout(() => { doneRef.current(); }, 700));
      }
    };
    
    go();
    return () => timeouts.forEach(clearTimeout);
  }, []); // Run ONCE on mount

  return val === 0
    ? <div className="host-go-text" key={0}>GO!</div>
    : <div className="host-countdown-number" key={val}>{val}</div>;
}

/** QR code that opens the join page with this room's code filled in. */
function JoinQrCode({ roomCode }: { roomCode: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = `${window.location.origin}/party?code=${roomCode}`;
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b0b12', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [roomCode]);
  if (!src) return null;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', background: '#fff', padding: '0.75rem', borderRadius: '16px' }}>
      <img src={src} alt={`Scan to join room ${roomCode}`} width={180} height={180} />
      <span style={{ color: '#0b0b12', fontWeight: 800, fontSize: '0.85rem' }}>Scan to join</span>
    </div>
  );
}

function QuitDialog({
  isPlaying,
  onEndToLobby,
  onCloseRoom,
  onCancel,
}: {
  isPlaying: boolean;
  onEndToLobby: () => void;
  onCloseRoom: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: 'var(--party-surface)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: '24px', padding: '2.5rem', maxWidth: '440px', width: '100%', textAlign: 'center', boxShadow: '0 0 60px rgba(239,68,68,0.3)' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🚪</div>
        <h2 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>
          {isPlaying ? 'Leave or End Game?' : 'Close Room?'}
        </h2>
        <p style={{ color: 'var(--party-text-muted)', fontFamily: 'var(--party-font-body)', marginBottom: '1.5rem' }}>
          {isPlaying
            ? 'Return everyone to the room lobby to pick another game, or close the room completely for all devices.'
            : 'Closing the room will disconnect all players and audience members.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {isPlaying && (
            <button onClick={onEndToLobby} className="party-btn party-btn-primary">
              ↩ Return to Room Lobby
            </button>
          )}
          <button onClick={onCloseRoom} className="party-btn" style={{ background: 'var(--party-red)', color: '#fff' }}>
            🚪 Close Room &amp; Exit
          </button>
          <button onClick={onCancel} className="party-btn party-btn-outline">
            {isPlaying ? 'Keep Playing' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PostGameOptions({ gameType, onPlayAgain, onSwitch, onCloseRoom, onResetScores, hasScores }: {
  gameType: string; onPlayAgain: () => void; onSwitch: (g: string) => void; onCloseRoom: () => void; onResetScores?: () => void; hasScores?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '480px', padding: '0.5rem 0' }}>
      <button onClick={onPlayAgain} className="party-btn party-btn-primary" style={{ fontSize: '1.3rem', padding: '1.2rem' }}>🔁 Play Again</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
        {gameType !== 'quip-clash' && <button onClick={() => onSwitch('quip-clash')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>⚡ Quip Clash</button>}
        {gameType !== 'the-faker' && <button onClick={() => onSwitch('the-faker')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🕵️ The Faker</button>}
        {gameType !== 'trivia-death' && <button onClick={() => onSwitch('trivia-death')} className="party-btn party-btn-purple party-btn-inline" style={{ fontSize: '0.9rem' }}>💀 Trivia Death</button>}
        {gameType !== 'bracket-battles' && <button onClick={() => onSwitch('bracket-battles')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🏆 Bracket Battles</button>}
        {gameType !== 'ready-set-bet' && <button onClick={() => onSwitch('ready-set-bet')} className="party-btn party-btn-green party-btn-inline" style={{ fontSize: '0.9rem' }}>🐎 Ready Set Bet</button>}
        {gameType !== 'spyfall' && <button onClick={() => onSwitch('spyfall')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🕵️‍♀️ Spyfall</button>}
        {gameType !== 'herd-mentality' && <button onClick={() => onSwitch('herd-mentality')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>🐄 Herd Mentality</button>}
        {gameType !== 'wavelength' && <button onClick={() => onSwitch('wavelength')} className="party-btn party-btn-purple party-btn-inline" style={{ fontSize: '0.9rem' }}>📡 Wavelength</button>}
        {gameType !== 'bluff-clash' && <button onClick={() => onSwitch('bluff-clash')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>🤥 Bluff Clash</button>}
        {gameType !== 'emoji-telephone' && <button onClick={() => onSwitch('emoji-telephone')} className="party-btn party-btn-green party-btn-inline" style={{ fontSize: '0.9rem' }}>🔗 Emoji Telephone</button>}
      </div>
      {hasScores && onResetScores && (
        <button onClick={onResetScores} className="party-btn party-btn-outline" style={{ fontSize: '0.95rem', borderColor: 'rgba(250,204,21,0.45)', color: 'var(--party-yellow)' }}>
          🔄 Reset Session Scores
        </button>
      )}
      <button onClick={onCloseRoom} className="party-btn party-btn-outline" style={{ fontSize: '1.1rem', borderColor: 'rgba(239,68,68,0.45)', color: 'var(--party-red)' }}>🚪 Close Room &amp; Exit</button>
    </div>
  );
}

const HOST_GAME_META: Record<string, { name: string; color: string; minPlayers: number }> = {
  'quip-clash': { name: '⚡ Quip Clash', color: 'yellow', minPlayers: 3 },
  'the-faker': { name: '🕵️ The Faker', color: 'red', minPlayers: 3 },
  'trivia-death': { name: '💀 Trivia Death', color: 'purple-lt', minPlayers: 3 },
  'bracket-battles': { name: '🏆 Bracket Battles', color: 'cyan', minPlayers: 3 },
  'ready-set-bet': { name: '🐎 Ready Set Bet', color: 'green', minPlayers: 1 },
  'spyfall': { name: '🕵️‍♀️ Spyfall', color: 'red', minPlayers: 3 },
  'herd-mentality': { name: '🐄 Herd Mentality', color: 'yellow', minPlayers: 3 },
  'wavelength': { name: '📡 Wavelength', color: 'cyan', minPlayers: 2 },
  'bluff-clash': { name: '🤥 Bluff Clash', color: 'yellow', minPlayers: 3 },
  'emoji-telephone': { name: '🔗 Emoji Telephone', color: 'green', minPlayers: 3 },
};

export default function HostPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const hostId = searchParams.get('hostId');

  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [showCountdown, setShowCountdown] = useState(false);
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const closingRef = useRef(false);
  const phaseRef = useRef('');
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { secondsLeft, pct } = useCountdown(state?.hostData?.timerStart, state?.hostData?.timerDuration);
  useImmersive('party-tv');
  const show = useShowDirector(state, secondsLeft);

  const sendAction = useCallback(async (action: any) => {
    await fetch('/api/party/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: hostId, action }),
    });
  }, [roomCode, hostId]);

  useEffect(() => {
    if (!state?.hostData?.autoAdvanceAt || !state?.hostData?.autoAdvanceAction) return;
    const delay = state.hostData.autoAdvanceAt - Date.now();
    const safeDelay = Math.max(delay, 200);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      // The server normally fires this itself; this is a fallback. The deadline
      // lets the server ignore it if the game already moved on.
      sendAction({ type: state.hostData.autoAdvanceAction, deadline: state.hostData.autoAdvanceAt });
    }, safeDelay);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [state?.hostData?.autoAdvanceAt, state?.hostData?.autoAdvanceAction, sendAction]);

  useEffect(() => {
    if (!hostId) { setError('Missing host token.'); return; }
    const sse = new EventSource(`/api/party/stream/host?roomCode=${roomCode}&hostId=${hostId}`);
    sse.onmessage = (event) => {
      if (event.data === ':') return;
      const data = JSON.parse(event.data);
      if (data.error) {
        if (closingRef.current) return;
        try { localStorage.removeItem('partyLastHosted'); } catch { /* ignore */ }
        setError(data.error);
        sse.close();
      } else {
        if (data.phase === 'ACTION' && phaseRef.current !== 'ACTION') setShowCountdown(true);
        phaseRef.current = data.phase;
        setState(data);
      }
    };
    return () => sse.close();
  }, [roomCode, hostId]);

  const handleEndToLobby = () => { setShowQuitDialog(false); sendAction({ type: 'QUIT_GAME' }); };
  const handleCloseRoom = async () => {
    closingRef.current = true;
    setShowQuitDialog(false);
    try {
      await sendAction({ type: 'CLOSE_ROOM' });
    } catch { /* navigate anyway */ }
    try {
      localStorage.removeItem('partyLastHosted');
      localStorage.removeItem(`host_${roomCode}`);
    } catch { /* ignore */ }
    router.push('/party');
  };
  const handleSwitch = (g: string) => sendAction({ type: 'SWITCH_GAME', gameType: g });
  const handlePlayAgain = () => sendAction({ type: 'PLAY_AGAIN' });
  const handleSetQuipRounds = (rs: number) => sendAction({ type: 'SET_QUIP_ROUNDS', rounds: rs });

  // Themed prompt packs (Ready Set Bet has no prompts, so it doesn't show them).
  const [packs, setPacks] = useState<{ id: string; name: string; emoji: string; counts: Record<string, number> }[]>([]);
  useEffect(() => {
    fetch('/api/party/packs').then(r => r.json()).then(d => { if (d.success) setPacks(d.packs); }).catch(() => {});
  }, []);
  const activePacks: string[] = state?.settings?.packs?.length ? state.settings.packs : ['classic'];
  const togglePack = (id: string) => {
    const next = activePacks.includes(id) ? activePacks.filter(p => p !== id) : [...activePacks, id];
    if (next.length) sendAction({ type: 'SET_PACKS', packs: next });
  };
  const PACK_LIST_KEY: Record<string, string> = {
    'quip-clash': 'quipClash', 'the-faker': 'theFaker', 'bracket-battles': 'bracketBattles', 'trivia-death': 'triviaQuestions',
    'spyfall': 'spyfallLocations', 'herd-mentality': 'herdMentality', 'wavelength': 'wavelengthSpectrums', 'bluff-clash': 'bluffFacts', 'emoji-telephone': 'emojiTelephone',
  };

  const isPlaying = state && state.phase !== 'LOBBY' && state.phase !== 'FINAL_RESULTS';
  const canSkip = isPlaying && state.hostData?.autoAdvanceAction && state.hostData.autoAdvanceAction !== 'RACE_TICK';
  const currentMeta = HOST_GAME_META[state?.gameType] || HOST_GAME_META['quip-clash'];
  const gameColor = currentMeta.color;
  const gameName = currentMeta.name;

  // Players who left mid-game stay in state (for names in results) but drop out of status grids.
  const seated = state ? (Object.values(state.players) as any[]).filter((p) => !p.left) : [];

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--party-bg)', padding: '2rem' }}>
      <div style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid var(--party-red)', borderRadius: '20px', padding: '3rem', textAlign: 'center', maxWidth: '480px' }}>
        <h2 style={{ color: 'var(--party-red)', fontSize: '1.75rem', marginBottom: '0.75rem' }}>Connection Lost</h2>
        <p>{error}</p>
        <button onClick={() => router.push('/party')} className="party-btn party-btn-outline party-btn-inline">← Back to Lobby</button>
      </div>
    </div>
  );

  if (!state) return <div style={{ minHeight: '100vh', background: 'var(--party-bg)' }}></div>;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--party-bg)', position: 'relative' }}>
      <div className="party-bg"><div className="party-bg-orb party-bg-orb-1" /><div className="party-bg-orb party-bg-orb-2" /></div>

      {showQuitDialog && (
        <QuitDialog
          isPlaying={!!isPlaying}
          onEndToLobby={handleEndToLobby}
          onCloseRoom={handleCloseRoom}
          onCancel={() => setShowQuitDialog(false)}
        />
      )}
      {showRulesModal && (
        <HowToPlayModal
          initialGameType={state.gameType}
          onClose={() => setShowRulesModal(false)}
          onAction={!isPlaying ? (g) => { if (g !== state.gameType) handleSwitch(g); } : undefined}
          actionLabel={!isPlaying ? 'Switch to This Game 🎮' : undefined}
        />
      )}
      {show.card && <TitleCard card={show.card} color={GAME_TITLES[state.gameType]?.color} />}
      <ReactionLayer reactions={state.reactions} players={state.players} />
      {isPlaying && <ScoreTicker players={state.players} order={state.playerOrder} />}

      {/* Top bar */}
      <div className="host-topbar party-content">
        <div>
          <div className={`host-topbar-game text-${gameColor}`}>{gameName}</div>
          {state.hostData?.totalRounds && (
            <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)', marginTop: '0.2rem' }}>
              Round {state.hostData.round} of {state.hostData.totalRounds}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div className="host-room-code-label">Room Code</div>
          <div className="host-room-code-badge">{state.roomCode}</div>
          <div className="host-room-code-label" style={{ marginTop: '0.3rem' }}>
            {typeof window !== 'undefined' ? window.location.host : ''}/party
          </div>
          {state.audienceSize > 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--party-cyan)', fontWeight: 800, marginTop: '0.3rem' }}>👀 {state.audienceSize} in the audience</div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => setShowRulesModal(true)}
              title="How to Play & Scoring"
              style={{ background: 'rgba(6, 182, 212, 0.15)', border: '2px solid rgba(6, 182, 212, 0.45)', borderRadius: '12px', color: 'var(--party-cyan)', fontWeight: 800, padding: '0.6rem 1rem', cursor: 'pointer' }}
            >
              ❓ How to Play
            </button>
            {canSkip && (
              <button
                onClick={() => sendAction({ type: state.hostData.autoAdvanceAction })}
                title="Skip current timer or advance to next step"
                style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid var(--party-border)', borderRadius: '12px', color: 'var(--party-text)', fontWeight: 800, padding: '0.6rem 1rem', cursor: 'pointer' }}
              >
                ⏭️ Skip
              </button>
            )}
            <button
              onClick={() => setShowQuitDialog(true)}
              style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '12px', color: 'var(--party-red)', fontWeight: 800, padding: '0.6rem 1.25rem', cursor: 'pointer' }}
            >
              {isPlaying ? '🚪 End / Leave' : '🚪 Close Room'}
            </button>
          </div>
          <SoundBar prefs={show.prefs} setPrefs={show.setPrefs} soundOn={show.soundOn} enableSound={show.enableSound} />
        </div>
      </div>

      <div className="host-stage party-content">
        {/* ===== LOBBY ===== */}
        {state.phase === 'LOBBY' && (
          <div className="host-lobby phase-enter">
            <div className="host-lobby-title">Waiting for players...</div>
            <p className="host-lobby-subtitle">
              {state.playerOrder.length}/16 players{state.playerOrder.length >= 16 ? ' (full — others can join the audience)' : ''} · join at <strong>{typeof window !== 'undefined' ? window.location.host : ''}/party</strong> with code <strong>{state.roomCode}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', margin: '0 0 1.25rem' }}>
              <JoinQrCode roomCode={state.roomCode} />
              <ShareInviteButton roomCode={state.roomCode} />
            </div>

            {(() => {
              const guide = GAME_GUIDES[state.gameType as GameType];
              if (!guide) return null;
              return (
                <div className="party-card" style={{ maxWidth: '720px', margin: '0 auto 1.5rem', padding: '1rem 1.25rem', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--party-cyan)' }}>
                      🕹️ How to Play {guide.name} ({guide.players} · {guide.rounds})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRulesModal(true)}
                      style={{ background: 'rgba(6, 182, 212, 0.15)', border: '1px solid rgba(6, 182, 212, 0.45)', borderRadius: '999px', color: 'var(--party-cyan)', fontSize: '0.78rem', fontWeight: 800, padding: '0.25rem 0.75rem', cursor: 'pointer' }}
                    >
                      ❓ Scoring &amp; All Games
                    </button>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.4rem' }}>🎯 {guide.goal}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.88rem', color: 'var(--party-text-muted)' }}>
                    {guide.steps.map((s, idx) => (
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.45rem 0.65rem' }}>
                        <strong style={{ color: 'var(--party-cyan)' }}>{idx + 1}.</strong> {s}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="host-players-grid">
              {state.playerOrder.map((pid: string) => state.players[pid]).filter(Boolean).map((p: any) => (
                <div key={p.id} className="host-player-card" style={{ opacity: p.connected ? 1 : 0.45 }} title={p.connected ? 'Connected' : 'Disconnected'}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: p.avatarColor }} />
                  <button
                    onClick={() => sendAction({ type: 'KICK_PLAYER', targetId: p.id })}
                    aria-label={`Remove ${p.name}`}
                    title={`Remove ${p.name}`}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', color: 'var(--party-text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}
                  >✕</button>
                  <div className="host-player-avatar" style={{ border: `3px solid ${p.avatarColor}`, color: p.avatarColor, fontSize: p.avatar ? '2.2rem' : undefined }}>{p.avatar || p.name.charAt(0)}</div>
                  <div className="host-player-name">{p.name}</div>
                  {p.score > 0 && (
                    <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--party-yellow)', marginTop: '0.25rem' }}>
                      🏆 {p.score.toLocaleString()} pts
                    </div>
                  )}
                  {!p.connected && <div style={{ fontSize: '0.7rem', color: 'var(--party-text-muted)' }}>reconnecting…</div>}
                </div>
              ))}
            </div>

            {Object.values(state.players).some((p: any) => p.score > 0) && (
              <div className="party-card" style={{ maxWidth: '640px', margin: '1.5rem auto 0', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--party-yellow)' }}>🏆 Session Leaderboard</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, marginTop: '0.2rem' }}>
                    {seated
                      .sort((a: any, b: any) => b.score - a.score)
                      .slice(0, 4)
                      .map((p: any, i: number) => `${['🥇', '🥈', '🥉', '4.'][i]} ${p.name} (${p.score.toLocaleString()})`)
                      .join('  ·  ')}
                  </div>
                </div>
                <button
                  onClick={() => sendAction({ type: 'RESET_SCORES' })}
                  className="party-btn party-btn-outline party-btn-inline"
                  style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem', borderColor: 'rgba(250,204,21,0.45)', color: 'var(--party-yellow)' }}
                >
                  🔄 Reset Scores
                </button>
              </div>
            )}
            
            {state.gameType === 'quip-clash' && (
              <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <span style={{ fontWeight: 'bold' }}>Rounds to play:</span>
                {[1, 2, 3].map(r => (
                  <button key={r} onClick={() => handleSetQuipRounds(r)}
                    style={{ background: (state.gameData?.targetRounds || 1) === r ? 'var(--party-yellow)' : 'transparent', color: (state.gameData?.targetRounds || 1) === r ? '#000' : '#fff', border: '2px solid var(--party-yellow)', padding: '0.4rem 1rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}

            {packs.length > 1 && PACK_LIST_KEY[state.gameType] && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', margin: '1rem 0' }}>
                <span style={{ fontWeight: 'bold' }}>Prompt packs:</span>
                {packs.map(p => {
                  const on = activePacks.includes(p.id);
                  const size = p.counts[PACK_LIST_KEY[state.gameType]] || 0;
                  return (
                    <button key={p.id} onClick={() => togglePack(p.id)} aria-pressed={on} disabled={size === 0 && !on}
                      title={`${size} prompts for this game`}
                      style={{ background: on ? 'var(--party-purple, #7c3aed)' : 'transparent', color: '#fff', border: '2px solid var(--party-purple-lt)', padding: '0.4rem 0.9rem', borderRadius: '999px', fontWeight: 'bold', cursor: 'pointer', opacity: size === 0 && !on ? 0.4 : 1 }}>
                      {on ? '✓ ' : ''}{p.emoji} {p.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>({size})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {state.playerOrder.length >= currentMeta.minPlayers ? (
              <div className="center-stack mt-4"><button onClick={() => sendAction({ type: 'START_GAME' })} className="party-btn party-btn-primary party-btn-huge">Start Game! 🎮</button></div>
            ) : (
              <p className="text-muted text-center mt-4">Need at least {currentMeta.minPlayers} players to start</p>
            )}

            <div style={{ marginTop: '3rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--party-text-muted)', marginBottom: '1rem' }}>Change Game:</div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {state.gameType !== 'quip-clash' && <button onClick={() => handleSwitch('quip-clash')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>⚡ Quip Clash</button>}
                {state.gameType !== 'the-faker' && <button onClick={() => handleSwitch('the-faker')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🕵️ The Faker</button>}
                {state.gameType !== 'trivia-death' && <button onClick={() => handleSwitch('trivia-death')} className="party-btn party-btn-purple party-btn-inline" style={{ fontSize: '0.9rem' }}>💀 Trivia Death</button>}
                {state.gameType !== 'bracket-battles' && <button onClick={() => handleSwitch('bracket-battles')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🏆 Bracket Battles</button>}
                {state.gameType !== 'ready-set-bet' && <button onClick={() => handleSwitch('ready-set-bet')} className="party-btn party-btn-green party-btn-inline" style={{ fontSize: '0.9rem' }}>🐎 Ready Set Bet</button>}
                {state.gameType !== 'spyfall' && <button onClick={() => handleSwitch('spyfall')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🕵️‍♀️ Spyfall</button>}
                {state.gameType !== 'herd-mentality' && <button onClick={() => handleSwitch('herd-mentality')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>🐄 Herd Mentality</button>}
                {state.gameType !== 'wavelength' && <button onClick={() => handleSwitch('wavelength')} className="party-btn party-btn-purple party-btn-inline" style={{ fontSize: '0.9rem' }}>📡 Wavelength</button>}
                {state.gameType !== 'bluff-clash' && <button onClick={() => handleSwitch('bluff-clash')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>🤥 Bluff Clash</button>}
                {state.gameType !== 'emoji-telephone' && <button onClick={() => handleSwitch('emoji-telephone')} className="party-btn party-btn-green party-btn-inline" style={{ fontSize: '0.9rem' }}>🔗 Emoji Telephone</button>}
              </div>
            </div>
          </div>
        )}

        {/* ===== QUIP CLASH ===== */}
        {state.phase === 'PROMPTING' && state.gameType === 'quip-clash' && (
          <div className="host-prompting phase-enter">
            <div className="host-phase-title">Time to be Funny!</div>
            <p className="host-prompting-sub">Check your phone and type your answers!</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '600px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%` }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-player-status-grid">
              {seated.map((p: any) => {
                const done = state.playerData[p.id]?.answers?.[0] && state.playerData[p.id]?.answers?.[1];
                return (
                  <div key={p.id} className="host-player-status">
                    <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                    <span>{p.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {state.phase === 'VOTING' && state.gameType === 'quip-clash' && (
          <div className="host-voting phase-enter">
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', margin: '0 auto 1.25rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '8px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: pct < 25 ? 'var(--party-red)' : 'var(--party-purple-lt)' }} /></div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'monospace', color: pct < 25 ? 'var(--party-red)' : 'var(--party-purple-lt)' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-prompt-display">
              <div className="host-prompt-text">"{state.hostData.prompt}"</div>
            </div>
            <div className="host-answers-grid">
              {state.hostData.answers?.map((a: any, idx: number) => (
                <div key={idx} className="host-answer-card"><div className="host-answer-text">{a.answer}</div></div>
              ))}
            </div>
          </div>
        )}
        {state.phase === 'ROUND_RESULTS' && state.gameType === 'quip-clash' && (
          <div className="host-round-results phase-enter">
            <p className="host-round-prompt-text">"{state.hostData.prompt}"</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '300px', margin: '0 auto 2rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-purple-lt)' }} /></div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-result-cards">
              {Object.keys(state.hostData.tally).map((pid) => (
                <div key={pid} className={`host-result-card ${state.hostData.quipLash === pid ? 'winner' : ''}`}>
                  <div className="host-result-card-by">{state.players[pid]?.name}</div>
                  <div className="host-result-answer">{state.hostData.answers?.[pid]}</div>
                  <div className="host-result-votes"><div className="host-result-votes-num">{state.hostData.tally[pid]}</div></div>
                  <VoterFaces ids={state.hostData.voters?.[pid]} players={state.players} />
                  {state.hostData.audienceTally && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--party-cyan)', fontWeight: 800, marginTop: '0.5rem' }}>
                      👀 {state.hostData.audienceTally[pid] || 0} audience{state.hostData.audienceFavorite === pid ? ' · favorite +250' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== FAKER ===== */}
        {state.phase === 'TASK_DELIVERY' && state.gameType === 'the-faker' && (
          <div className="host-faker-delivery phase-enter center-stack">
            <div className="host-faker-delivery-icon">📱</div>
            <div className="host-faker-heading">Check Your Devices!</div>
            <p className="host-faker-sub">{state.hostData.subMessage}</p>
            <div className="host-timer-bar-wrap" style={{ maxWidth: '300px' }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-cyan)' }} /></div>
            {state.hostData.eliminatedPlayers?.length > 0 && (
              <div style={{ marginTop: '2rem', color: 'var(--party-red)' }}>Eliminated: {state.hostData.eliminatedPlayers.map((p:string) => state.players[p]?.name).join(', ')}</div>
            )}
          </div>
        )}
        {state.phase === 'ACTION' && state.gameType === 'the-faker' && (
          <div className="center-stack phase-enter">
            {showCountdown ? <FakerCountdown onDone={() => setShowCountdown(false)} /> : (
              <>
                <div className="host-go-text" style={{ marginBottom: '1.5rem' }}>FREEZE! 🧊</div>
                <div className="host-timer-bar-wrap" style={{ maxWidth: '300px', height: '6px' }}><div className="host-timer-bar" style={{ width: `${pct}%` }} /></div>
              </>
            )}
          </div>
        )}
        {state.phase === 'VOTING' && state.gameType === 'the-faker' && (
          <div className="center-stack phase-enter">
            <div style={{ fontSize: '3rem' }}>🗳️</div>
            <div className="host-faker-heading">Time to Vote!</div>
            <p className="host-faker-sub">Who is The Faker? Vote on your phones.</p>
            <div className="host-timer-bar-wrap" style={{ maxWidth: '400px' }}><div className="host-timer-bar" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        {state.phase === 'RESULTS' && state.gameType === 'the-faker' && (
          <div className="host-faker-results phase-enter center-stack">
            <div className={`host-faker-result-heading ${state.hostData.fakerCaught ? 'caught' : 'escaped'}`}>
              {state.hostData.fakerCaught ? '🎯 Faker Caught!' : state.hostData.fakerEliminated ? '😱 Wrong Person Eliminated!' : '👻 Faker Escaped!'}
            </div>
            {state.hostData.eliminated ? (
              <div style={{ fontSize: '1.5rem', marginBottom: '1rem', color: state.hostData.fakerCaught ? 'var(--party-green)' : 'var(--party-red)' }}>
                {state.players[state.hostData.eliminated]?.name} was voted out.
              </div>
            ) : (
              <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>No majority vote.</div>
            )}
            {state.hostData.voters && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', marginBottom: '1.5rem' }}>
                {Object.entries(state.hostData.voters as Record<string, string[]>).filter(([, ids]) => ids.length > 0).map(([target, ids]) => (
                  <div key={target} className="party-card" style={{ padding: '0.75rem 1rem', minWidth: 160, textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem' }}>{state.players[target]?.avatar}</div>
                    <div style={{ fontWeight: 900 }}>{state.players[target]?.name}</div>
                    <VoterFaces ids={ids} players={state.players} />
                  </div>
                ))}
              </div>
            )}
            <div className="host-faker-revealed" style={{ width: '100%', maxWidth: '700px' }}>
              <div>
                <div className="host-faker-revealed-label">The Faker was</div>
                <div className="host-faker-revealed-name">{state.players[state.hostData.fakerId]?.name}</div>
              </div>
            </div>
            <div className="host-faker-task-reveal" style={{ width: '100%', maxWidth: '700px' }}>
              <div className="host-faker-task-reveal-label">The Hidden Task Was</div>
              {state.hostData.task}
            </div>
            {state.hostData.isGameOver && (
              <div style={{ marginTop: '2rem', fontSize: '2rem', color: 'var(--party-yellow)', fontWeight: 900 }}>Goin' to Final Results...</div>
            )}
          </div>
        )}

        {/* ===== TRIVIA DEATH — MURDER HOTEL ===== */}

        {state.gameType === 'trivia-death' && state.phase !== 'LOBBY' && state.hostData?.playerStatuses && (
          <div className="host-player-status-strip">
            {state.playerOrder?.map((pid: string) => {
              const status = state.hostData.playerStatuses[pid];
              const money = state.hostData.playerMoney?.[pid] ?? 0;
              const streak = state.hostData.ghostStreaks?.[pid] ?? 0;
              return (
                <div key={pid} className={`host-status-pill ${status}`}>
                  <div className={`host-status-dot ${status}`}>{status === 'ghost' ? '👻' : status === 'escaped' ? '🚪' : state.players[pid]?.name.charAt(0)}</div>
                  <span style={{ color: status === 'ghost' ? 'var(--party-purple-lt)' : status === 'escaped' ? 'var(--party-cyan)' : 'var(--party-text)' }}>{state.players[pid]?.name}</span>
                  {status === 'ghost' && streak > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--party-purple-lt)' }}>{streak}/3</span>}
                  <span className="host-status-money">${money}</span>
                </div>
              );
            })}
          </div>
        )}

        {state.phase === 'QUESTION' && state.gameType === 'trivia-death' && (
          <div className="host-trivia-question phase-enter center-stack" style={{ maxWidth: '820px' }}>
            <div className="host-round-indicator">
              {Array.from({ length: state.hostData.totalRounds }).map((_: any, i: number) => {
                const r = state.hostData.round;
                const pip = i < r - 1 ? 'done' : i === r - 1 ? 'current' : '';
                return <div key={i} className={`host-round-pip ${pip}`} />;
              })}
            </div>
            <div className="host-trivia-category-badge">☠️ Round {state.hostData.round} of {state.hostData.totalRounds}</div>
            {state.hostData.category && <div className="host-trivia-category">{state.hostData.category}</div>}
            <div className="host-trivia-qtext">{state.hostData.question}</div>
            <div className="host-trivia-choices" style={{ maxWidth: '800px', width: '100%', marginBottom: '1.5rem' }}>
              {state.hostData.choices?.map((c: string, idx: number) => (
                <div key={idx} className="host-trivia-choice dimmed">
                  <div className="host-trivia-choice-letter">{['A','B','C','D'][idx]}</div>
                  {c}
                </div>
              ))}
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '500px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}>
                  <div className="host-timer-bar" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--party-purple), ${pct < 30 ? 'var(--party-red)' : 'var(--party-orange)'})` }} />
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace', color: pct < 30 ? 'var(--party-red)' : 'var(--party-yellow)' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-player-status-grid">
              {Object.entries(state.hostData.playerStatuses || {}).map(([pid, status]: [string, any]) => {
                const done = state.gameData?.currentAnswers?.[pid] !== null && state.gameData?.currentAnswers?.[pid] !== undefined;
                return (
                  <div key={pid} className="host-player-status" style={{ opacity: status === 'ghost' ? 0.55 : 1 }}>
                    <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`} style={{ borderColor: status === 'ghost' ? 'var(--party-purple-lt)' : undefined }}>
                      {done ? '✓' : status === 'ghost' ? '👻' : state.players[pid]?.name.charAt(0)}
                    </div>
                    <span>{state.players[pid]?.name}</span>
                  </div>
                );
              })}
            </div>
            {state.hostData.flavor && <div style={{ marginTop: '1.5rem', fontStyle: 'italic', color: 'var(--party-text-muted)', fontSize: '0.95rem' }}>&#34;{state.hostData.flavor}&#34;</div>}
          </div>
        )}
        {state.phase === 'QUESTION_RESULTS' && state.gameType === 'trivia-death' && (
          <div className="host-trivia-question phase-enter center-stack" style={{ maxWidth: '820px' }}>
            <div className="host-trivia-qtext" style={{ fontSize: 'clamp(1.5rem,3vw,2.5rem)', marginBottom: '1.5rem', opacity: 0.85 }}>{state.hostData.question}</div>
            <div className="host-trivia-choices" style={{ maxWidth: '800px', width: '100%' }}>
              {state.hostData.choices?.map((c: string, idx: number) => (
                <div key={idx} className={`host-trivia-choice ${idx === state.hostData.correctAnswer ? 'correct' : 'incorrect'}`}>
                  <div className="host-trivia-choice-letter">{['A','B','C','D'][idx]}</div>
                  {c}
                </div>
              ))}
            </div>
            {state.hostData.killingFloorPlayers?.length > 0 && (
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ color: 'var(--party-red)', fontWeight: 900, fontSize: '1.1rem', width: '100%', textAlign: 'center' }}>💀 Heading to the Killing Floor:</div>
                {state.hostData.killingFloorPlayers.map((pid: string) => (
                  <div key={pid} style={{ background: 'rgba(239,68,68,0.2)', border: '2px solid var(--party-red)', borderRadius: '99px', padding: '0.3rem 1rem', fontWeight: 900, fontFamily: 'var(--party-font-display)' }}>
                    {state.players[pid]?.name}
                  </div>
                ))}
              </div>
            )}
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '300px', margin: '1.5rem auto 0' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-purple-lt)' }} /></div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
          </div>
        )}
        {state.phase === 'KILLING_FLOOR' && state.gameType === 'trivia-death' && (
          <div className="host-killing-floor phase-enter center-stack">
            <div className="host-kf-title">THE KILLING FLOOR</div>
            <div className="host-kf-game-name">{state.hostData.miniGameName}</div>
            <div className="host-kf-subtitle">{state.hostData.miniGameSubtitle}</div>
            <div className="host-kf-players">
              {state.hostData.killingFloorPlayers?.map((pid: string) => (
                <div key={pid} className="host-kf-player">
                  <div className="host-kf-avatar" style={{ borderColor: state.players[pid]?.avatarColor, color: state.players[pid]?.avatarColor }}>
                    {state.players[pid]?.name.charAt(0)}
                  </div>
                  <div>{state.players[pid]?.name}</div>
                </div>
              ))}
            </div>
            {state.hostData.miniGame === 'spin' && <div className="host-kf-spin-wheel">🎡</div>}
            {state.hostData.miniGame === 'math' && <div className="host-kf-math">{state.hostData.question} = ?</div>}
            {state.hostData.miniGame === 'password' && (
              <div className="host-kf-passwords">{[1,2,3,4,5].map(n => <div key={n} className="host-kf-password-box">🚪</div>)}</div>
            )}
            {state.hostData.miniGame === 'scramble' && <div className="host-kf-scramble">{state.hostData.scrambled}</div>}
            {state.hostData.miniGame === 'hotpotato' && <div style={{ fontSize: '5rem', animation: 'dangerShake 0.2s infinite' }}>🎃</div>}
            {state.hostData.miniGame === 'reaction' && <div className="host-kf-danger-zone">⚡</div>}
            {state.hostData.miniGame === 'memory' && (
              <div className="host-kf-memory-grid" style={{ gridTemplateColumns: 'repeat(3, 80px)' }}>
                {state.hostData.grid?.map((sym: string, i: number) => (
                  <div key={i} className="host-kf-memory-tile revealed">{sym}</div>
                ))}
              </div>
            )}
            {state.hostData.miniGame === 'auction' && (
              <div style={{ fontSize: '3rem', color: 'var(--party-yellow)', textShadow: 'var(--party-glow-yellow)', fontFamily: 'var(--party-font-display)', fontWeight: 900 }}>💰 BID TO SURVIVE</div>
            )}
            <div className="host-timer-bar-wrap" style={{ maxWidth: '400px', margin: '1.5rem auto 0' }}>
              <div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-red)' }} />
            </div>
            {secondsLeft !== null && <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace', color: 'var(--party-red)', marginTop: '0.5rem' }}>{Math.ceil(secondsLeft)}</div>}
            <div style={{ fontStyle: 'italic', color: 'var(--party-text-muted)', marginTop: '1rem', fontSize: '0.9rem' }}>"{state.hostData.flavor}"</div>
          </div>
        )}
        {state.phase === 'KILLING_FLOOR_RESULTS' && state.gameType === 'trivia-death' && (
          <div className="host-killing-floor phase-enter center-stack">
            <div style={{ fontSize: 'clamp(2rem,4vw,3.5rem)', fontFamily: 'var(--party-font-display)', fontWeight: 900, marginBottom: '0.5rem' }}>
              {state.hostData.dead?.length > 0 ? '💀 The Killing Floor Claims More Souls' : '😤 Everyone Survived... This Time.'}
            </div>
            <div style={{ fontStyle: 'italic', color: 'var(--party-text-muted)', marginBottom: '2rem' }}>"{state.hostData.flavor}"</div>
            {state.hostData.miniGame === 'math' && <div className="host-kf-math" style={{ borderColor: 'var(--party-green)', color: 'var(--party-green)', textShadow: 'none', marginBottom: '1.5rem', fontSize: '2.5rem' }}>Answer: {state.hostData.answer}</div>}
            {state.hostData.miniGame === 'password' && <div className="host-kf-math" style={{ borderColor: 'var(--party-red)', color: 'var(--party-red)', marginBottom: '1.5rem', fontSize: '2.5rem' }}>☠️ Death Door: {state.hostData.answer}</div>}
            {state.hostData.miniGame === 'scramble' && <div className="host-kf-math" style={{ borderColor: 'var(--party-green)', color: 'var(--party-green)', textShadow: 'none', marginBottom: '1.5rem' }}>The Word: {state.hostData.answer}</div>}
            {state.hostData.miniGame === 'hotpotato' && <div style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 900 }}>🎃 {state.players[state.hostData.answer as string]?.name} was holding the coffin!</div>}
            <div className="host-kf-players">
              {state.hostData.killingFloorPlayers?.map((pid: string) => {
                const isDead = state.hostData.dead?.includes(pid);
                return (
                  <div key={pid} className="host-kf-player">
                    <div className="host-kf-avatar" style={{ borderColor: isDead ? 'var(--party-red)' : 'var(--party-green)', color: isDead ? 'var(--party-red)' : 'var(--party-green)' }}>
                      {isDead ? '👻' : '✓'}
                    </div>
                    <div style={{ color: isDead ? 'var(--party-red)' : 'var(--party-green)', fontWeight: 900 }}>{state.players[pid]?.name}</div>
                    <div className={`kf-survive-badge ${isDead ? 'slain' : 'survived'}`}>{isDead ? 'SLAIN' : 'SURVIVED'}</div>
                  </div>
                );
              })}
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '300px', margin: '1.5rem auto 0' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-red)' }} /></div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
          </div>
        )}
        {state.phase === 'FINAL_ESCAPE' && state.gameType === 'trivia-death' && (
          <div className="host-trivia-question phase-enter center-stack" style={{ maxWidth: '820px' }}>
            <div className="host-murder-title" style={{ fontSize: 'clamp(2.5rem,5vw,4rem)', marginBottom: '0.5rem' }}>🚪 FINAL ESCAPE</div>
            <div style={{ fontStyle: 'italic', color: 'var(--party-text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>Answer correctly to escape the Murder Hotel!</div>
            {state.hostData.category && <div className="host-trivia-category">{state.hostData.category}</div>}
            <div className="host-trivia-qtext" style={{ fontSize: 'clamp(1.4rem,3vw,2.2rem)', marginBottom: '1.5rem' }}>{state.hostData.question}</div>
            <div className="host-trivia-choices" style={{ maxWidth: '800px', width: '100%', marginBottom: '1.5rem' }}>
              {state.hostData.choices?.map((c: string, idx: number) => (
                <div key={idx} className="host-trivia-choice dimmed">
                  <div className="host-trivia-choice-letter">{['A','B','C','D'][idx]}</div>
                  {c}
                </div>
              ))}
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--party-purple), var(--party-cyan))' }} /></div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'monospace', color: 'var(--party-cyan)' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-escape-track">
              {state.playerOrder?.map((pid: string) => {
                const status = state.hostData.playerStatuses?.[pid];
                const progress = state.hostData.escapeProgress?.[pid] ?? 0;
                const needed = state.hostData.escapeStepsNeeded ?? 4;
                const pctEsc = status === 'escaped' ? 100 : Math.min(99, (progress / needed) * 100);
                const fillClass = status === 'escaped' ? 'escaped-fill' : status === 'ghost' ? 'ghost-fill' : 'alive-fill';
                return (
                  <div key={pid} className="host-escape-player-row">
                    <div className="host-escape-label">{status === 'ghost' ? '👻' : status === 'escaped' ? '🚪' : ''} {state.players[pid]?.name}</div>
                    <div className="host-escape-bar-bg">
                      <div className={`host-escape-bar-fill ${fillClass}`} style={{ width: `${pctEsc}%` }} />
                    </div>
                    <div className="host-escape-steps">{status === 'escaped' ? '✓' : `${progress}/${needed}`}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}



        {/* ===== BRACKET BATTLES ===== */}
        {state.gameType === 'bracket-battles' && state.phase === 'PROMPTING' && (
          <div className="phase-enter" style={{ textAlign: 'center' }}>
            <div className="host-phase-title">Bracket Battles</div>
            <p className="text-muted" style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>{state.hostData.prompt}</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '600px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-cyan)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
          </div>
        )}

        {state.gameType === 'bracket-battles' && state.phase === 'PREDICTION' && (
          <div className="phase-enter" style={{ textAlign: 'center', width: '100%' }}>
            <div className="host-phase-title">The Bracket</div>
            <p className="text-muted">{state.hostData.prompt}</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '600px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-cyan)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}
            <div className="host-bracket-tree">
              {state.hostData.bracket && (
                <>
                  <div className="host-bracket-col">
                    {state.hostData.bracket.filter((_:any, i:number) => i < state.hostData.bracketSize / 2 && i % 2 === 0).map((m: any) => (
                       <div key={m.id} className="host-bracket-match">
                         <div className={`host-bracket-answer ${m.winnerId === m.answer1?.id ? 'host-bracket-winner' : ''}`}>{m.answer1?.answer || '?'}</div>
                         <div className={`host-bracket-answer ${m.winnerId === m.answer2?.id ? 'host-bracket-winner' : ''}`}>{m.answer2?.answer || '?'}</div>
                       </div>
                    ))}
                  </div>
                  {state.hostData.bracketSize === 16 && (
                    <div className="host-bracket-col" style={{ padding: '0 1rem' }}>
                       {state.hostData.bracket.filter((_:any, i:number) => i >= 8 && i <= 11 && i % 2 === 0).map((m: any) => (
                         <div key={m.id} className="host-bracket-match">
                           <div className={`host-bracket-answer ${m.winnerId === m.answer1?.id ? 'host-bracket-winner' : ''}`}>{m.answer1?.answer || '?'}</div>
                           <div className={`host-bracket-answer ${m.winnerId === m.answer2?.id ? 'host-bracket-winner' : ''}`}>{m.answer2?.answer || '?'}</div>
                         </div>
                      ))}
                    </div>
                  )}
                  <div className="host-bracket-col" style={{ padding: '0 2rem', borderInline: '2px solid rgba(255,255,255,0.1)' }}>
                     <div className="host-bracket-match" style={{ borderStyle: 'dashed' }}>
                       <div className="host-bracket-answer">Champion</div>
                     </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {state.gameType === 'bracket-battles' && (state.phase === 'MATCHUP' || state.phase === 'MATCH_RESULT' || state.phase === 'TIEBREAKER') && (
          <div className="phase-enter" style={{ textAlign: 'center', width: '100%', maxWidth: '800px' }}>
            <div className="host-phase-title" style={{ fontSize: '2rem' }}><EmojiText text={state.hostData.message} /></div>
            <div className="text-muted" style={{ fontSize: '1.25rem', marginBottom: '1.5rem', fontStyle: 'italic' }}>{state.hostData.prompt}</div>
            {state.phase === 'TIEBREAKER' && <div className="text-red font-black" style={{ fontSize: '3rem', animation: 'pulseRed 1s infinite' }}>BUTTON MASH!</div>}
            
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '600px', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: state.phase === 'TIEBREAKER' ? 'var(--party-red)' : 'var(--party-cyan)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace', color: state.phase === 'TIEBREAKER' ? 'var(--party-red)' : '#fff' }}>{Math.ceil(secondsLeft)}</div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '2rem' }}>
              {(state.hostData.answers || []).map((ans: any, i: number) => {
                const isWinner = state.phase === 'MATCH_RESULT' && state.hostData.winner.id === ans.id;
                const isLoser = state.phase === 'MATCH_RESULT' && state.hostData.loser.id === ans.id;
                const votes = state.phase === 'MATCH_RESULT' ? state.hostData.votes[ans.id] : null;
                return (
                  <div key={ans.id} className="party-card" style={{ 
                    border: `4px solid ${isWinner ? 'var(--party-green)' : isLoser ? 'var(--party-border)' : 'var(--party-cyan)'}`, 
                    opacity: isLoser ? 0.3 : 1, transform: isWinner ? 'scale(1.05)' : 'none', transition: 'all 0.3s' 
                  }}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '1rem' }}>{ans.answer}</div>
                    {state.phase === 'MATCH_RESULT' && (
                       <>
                         <div style={{ fontSize: '1.5rem', color: isWinner ? 'var(--party-green)' : 'var(--party-text-muted)' }}>{votes} Votes</div>
                         <VoterFaces ids={state.hostData.voters?.[ans.id]} players={state.players} />
                       </>
                    )}
                  </div>
                );
              })}
            </div>
            {state.phase === 'MATCH_RESULT' && !state.hostData.winner.isBot && state.players[state.hostData.winner.id] && (
               <div style={{ marginTop: '2rem', fontSize: '1.5rem', color: 'var(--party-green)' }}>
                 Author: {state.players[state.hostData.winner.id].name} (+Points!)
               </div>
            )}
          </div>
        )}

        {/* ===== READY SET BET ===== */}
        {state.gameType === 'ready-set-bet' && (state.phase === 'RACING' || state.phase === 'RACE_RESULTS') && (
           <div className="phase-enter" style={{ width: '100%' }}>
             <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
               <div className="host-phase-title" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--party-green)', textShadow: '0 0 20px var(--party-green)' }}>
                 {state.hostData.message}
               </div>
               {state.phase === 'RACING' && state.hostData.lastRoll !== undefined && (
                 <div style={{ position: 'absolute', top: '150px', right: '5%', fontSize: '6rem', fontWeight: 900, color: 'var(--party-yellow)', textShadow: '0 0 40px var(--party-yellow)', zIndex: 100 }}>
                   🎲 {state.hostData.lastRoll}
                 </div>
               )}
               {state.phase === 'RACING' && state.hostData.commentary && (
                 <div style={{ background: 'rgba(0,0,0,0.6)', border: '2px solid var(--party-green)', padding: '0.5rem 1rem', borderRadius: '12px', fontSize: '1.25rem', color: '#fff', fontStyle: 'italic', maxWidth: '600px', margin: '0 auto 1rem', display: 'inline-block' }}>
                   🎤 {state.hostData.commentary}
                 </div>
               )}
               <div className="text-muted" style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Track Length: {state.hostData.trackLength}</div>
               {state.phase === 'RACING' && state.hostData.bettingClosed && (
                 <div className="text-red font-black" style={{ fontSize: '2rem', animation: 'pulseRed 1s infinite' }}>BETTING CLOSED!</div>
               )}
             </div>

             <div className="host-track">
                {state.hostData.finishers && state.hostData.finishers.length > 0 && (
                   <div style={{ position: 'absolute', top: '-60px', right: '0', display: 'flex', gap: '1rem' }}>
                     {state.hostData.finishers.map((f: string, i: number) => (
                       <div key={f} style={{ background: '#000', border: '2px solid var(--party-yellow)', color: 'var(--party-yellow)', padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 900 }}>
                         #{i+1} - {f}
                       </div>
                     ))}
                   </div>
                )}
                <div className="host-track-finish" />
                {['2/3', '4', '5', '6', '7', '8', '9', '10', '11/12'].map(horse => {
                  const pos = state.hostData.positions?.[horse] || 0;
                  const trackLength = state.hostData.trackLength || 15;
                  const pct = Math.min((pos / trackLength) * 100, 100);
                  const justRolled = state.hostData.lastRollHorse === horse || (horse === '2/3' && (state.hostData.lastRoll === 2 || state.hostData.lastRoll === 3)) || (horse === '11/12' && (state.hostData.lastRoll === 11 || state.hostData.lastRoll === 12));
                  const hClass = `horse-${horse.replace('/', '-')}`;
                  
                  const HORSE_NAMES: Record<string, string> = {
                    '2/3': 'Glue Factory', '4': 'Slow Poke', '5': 'Pony Soprano', '6': 'Seabiscuit',
                    '7': 'Lucky Sleven', '8': 'Al Capony', '9': 'Mane Attraction', '10': 'Neigh Sayer', '11/12': 'Longshot'
                  };

                  return (
                    <div key={horse} className="host-track-lane">
                       <span style={{position:'absolute', left: '-120px', color: 'rgba(255,255,255,0.4)', width: '110px', textAlign: 'right', fontSize: '1rem', fontWeight: 900, top: '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap'}}>{HORSE_NAMES[horse]}</span>
                       <div className={`host-track-horse ${hClass}`} style={{ 
                         left: `calc(10px + ${pct}% - 40px)`, 
                         boxShadow: justRolled ? '0 0 20px #fff' : 'none',
                         transform: justRolled ? 'scale(1.2)' : 'none',
                         zIndex: justRolled ? 20 : 10
                       }}>
                         {horse}
                       </div>
                    </div>
                  );
                })}
             </div>

             {state.phase === 'RACE_RESULTS' && state.hostData.results && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', marginTop: '2rem' }}>
                  {Object.keys(state.hostData.results).map(pid => {
                     const r = state.hostData.results[pid];
                     const p = state.players[pid];
                     return (
                       <div key={pid} style={{ background: 'rgba(0,0,0,0.5)', padding: '1rem', borderRadius: '12px', textAlign: 'center', border: `2px solid ${r.net > 0 ? 'var(--party-green)' : r.net < 0 ? 'var(--party-red)' : 'var(--party-border)'}` }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                           <div className="host-player-avatar" style={{ width: '30px', height: '30px', background: p.avatarColor, fontSize: '1rem', border: 'none' }}>{p.name[0]}</div>
                           <div style={{ fontWeight: 800 }}>{p.name}</div>
                         </div>
                         <div style={{ fontSize: '1.5rem', fontWeight: 900, color: r.net > 0 ? 'var(--party-green)' : r.net < 0 ? 'var(--party-red)' : '#fff' }}>
                           {r.net > 0 ? '+' : ''}{r.net}
                         </div>
                       </div>
                     );
                  })}
                </div>
             )}
           </div>
        )}

        {/* ===== SPYFALL ===== */}
        {state.gameType === 'spyfall' && state.phase === 'DISCUSSION' && (
          <div className="center-stack phase-enter" style={{ maxWidth: '880px', width: '100%' }}>
            <div className="host-phase-title"><EmojiText text="🕵️‍♀️ Find the Spy!" /></div>
            <p className="host-prompting-sub">{state.hostData.subMessage || state.hostData.message}</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '600px', width: '100%', margin: '0 auto 1rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-red)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            {/* Compact so all 16 locations fit above the score ticker on a 720p TV. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', width: '100%' }}>
              {state.hostData.locations?.map((loc: any) => (
                <div key={loc.name} className="party-card" style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 800, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ fontSize: '1.15rem', marginRight: '0.35rem' }}>{loc.emoji}</span> {loc.name}
                </div>
              ))}
            </div>
          </div>
        )}
        {state.gameType === 'spyfall' && state.phase === 'VOTING' && (
          <div className="center-stack phase-enter" style={{ maxWidth: '720px', width: '100%' }}>
            <div className="host-phase-title"><EmojiText text={state.hostData.message || '🚨 Emergency Vote!'} /></div>
            <p className="host-prompting-sub">{state.hostData.subMessage}</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '1rem auto' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-red)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            <div className="host-player-status-grid">
              {seated.map((p: any) => {
                const done = state.playerData?.[p.id]?.hasVoted;
                return (
                  <div key={p.id} className="host-player-status">
                    <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                    <span>{p.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {state.gameType === 'spyfall' && state.phase === 'RESULTS' && (
          <div className="center-stack phase-enter" style={{ maxWidth: '760px', width: '100%' }}>
            <div className="host-phase-title" style={{ background: 'none', WebkitTextFillColor: state.hostData.spyCaught ? 'var(--party-green)' : 'var(--party-red)', color: state.hostData.spyCaught ? 'var(--party-green)' : 'var(--party-red)' }}>
              {state.hostData.headline}
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '300px', width: '100%', margin: '0.5rem auto' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-cyan)' }} /></div>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1rem', width: '100%' }}>
              <div className="party-card" style={{ padding: '1.5rem 2rem', textAlign: 'center', flex: 1, minWidth: '240px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>The Spy Was</div>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--party-red)', marginTop: '0.4rem' }}>
                  {state.players[state.hostData.spyId]?.avatar} {state.players[state.hostData.spyId]?.name}
                </div>
              </div>
              <div className="party-card" style={{ padding: '1.5rem 2rem', textAlign: 'center', flex: 1, minWidth: '240px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>Secret Location</div>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--party-green)', marginTop: '0.4rem' }}>
                  {state.hostData.locationEmoji} {state.hostData.location}
                </div>
              </div>
            </div>
            {state.hostData.votes && Object.keys(state.hostData.votes).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem', width: '100%' }}>
                {seated.map((p: any) => {
                  const voterIds = Object.entries(state.hostData.votes)
                    .filter(([, target]) => target === p.id)
                    .map(([voter]) => voter);
                  if (voterIds.length === 0) return null;
                  return (
                    <div key={p.id} className="party-card" style={{ width: 'auto', maxWidth: 'none', padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: 900 }}>{p.avatar || '🕵️'} {p.name}:</span>
                      <VoterFaces ids={voterIds} players={state.players} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== HERD MENTALITY ===== */}
        {state.gameType === 'herd-mentality' && state.phase === 'PROMPTING' && (
          <div className="center-stack phase-enter" style={{ maxWidth: '760px', width: '100%' }}>
            <div className="host-phase-title"><EmojiText text="🐄 Think Like The Herd!" /></div>
            <div className="host-prompt-display" style={{ margin: '1rem 0' }}>
              <div className="host-prompt-text">"{state.hostData.prompt}"</div>
            </div>
            {state.hostData.pinkCowHolder && (
              <div style={{ color: '#f472b6', fontWeight: 900, marginBottom: '1rem' }}>
                🐄🍓 Pink Cow Holder: {state.players[state.hostData.pinkCowHolder]?.name}
              </div>
            )}
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0 auto 1.5rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-yellow)' }} /></div>
                <div style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            <div className="host-player-status-grid">
              {seated.map((p: any) => {
                const done = state.playerData?.[p.id]?.submitted;
                return (
                  <div key={p.id} className="host-player-status">
                    <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                    <span>{p.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {state.gameType === 'herd-mentality' && state.phase === 'ROUND_RESULTS' && (
          <div className="center-stack phase-enter" style={{ maxWidth: '820px', width: '100%' }}>
            <div className="host-phase-title" style={{ fontSize: '2.2rem' }}><EmojiText text="🐄 Herd Results!" /></div>
            <p className="text-muted" style={{ fontSize: '1.3rem', marginBottom: '0.75rem' }}>"{state.hostData.prompt}"</p>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '300px', width: '100%', margin: '0 auto 1.25rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, height: '6px', margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-yellow)' }} /></div>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
              {state.hostData.groups?.map((g: any, idx: number) => (
                <div
                  key={idx}
                  className="party-card"
                  style={{
                    maxWidth: 'none',
                    padding: '1.1rem 1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    border: `3px solid ${g.isMajority ? 'var(--party-green)' : g.isPinkCow ? '#ec4899' : 'var(--party-border)'}`,
                  }}
                >
                  <div style={{ minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>"{g.label}"</div>
                    <div style={{ color: 'var(--party-text-muted)', fontWeight: 700 }}>
                      {g.playerIds?.map((pid: string) => state.players[pid]?.name).join(', ')}
                    </div>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, whiteSpace: 'nowrap', flexShrink: 0, color: g.isMajority ? 'var(--party-green)' : g.isPinkCow ? '#f472b6' : '#fff' }}>
                    {g.playerIds?.length || 0} {g.isMajority ? '✅ HERD (+600)' : g.isPinkCow ? '🐄🍓 PINK COW' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== WAVELENGTH ===== */}
        {state.gameType === 'wavelength' && (state.phase === 'CLUE_GIVING' || state.phase === 'DIALING' || state.phase === 'ROUND_RESULTS') && (
          <div className="center-stack phase-enter" style={{ maxWidth: '820px', width: '100%' }}>
            {/* The clue is free text (up to 120 chars), so it gets a smaller size than a fixed title. */}
            <div className="host-phase-title" style={state.phase === 'CLUE_GIVING' ? undefined : { fontSize: 'clamp(1.8rem, 3.5vw, 3rem)', overflowWrap: 'anywhere' }}>
              <EmojiText text={state.phase === 'CLUE_GIVING'
                ? `🔮 ${state.players[state.hostData.psychicId]?.name} is the Psychic!`
                : `📡 Clue: "${state.hostData.clue}"`} />
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0.5rem auto' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-cyan)' }} /></div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            <div className="party-card" style={{ width: '100%', maxWidth: 'none', padding: '1.25rem 1.75rem', margin: '0.5rem 0 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.6rem', fontWeight: 900, marginBottom: '1rem' }}>
                <span style={{ color: 'var(--party-cyan)' }}>⬅️ {state.hostData.spectrum?.[0]}</span>
                <span style={{ color: 'var(--party-orange, #f97316)' }}>{state.hostData.spectrum?.[1]} ➡️</span>
              </div>
              <div style={{ position: 'relative', height: '42px', borderRadius: '999px', background: 'linear-gradient(90deg, #06b6d4, #a855f7, #f97316)' }}>
                {state.phase === 'ROUND_RESULTS' && state.hostData.target !== undefined && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-8px',
                      bottom: '-8px',
                      left: `calc(${state.hostData.target}% - 8px)`,
                      width: '16px',
                      background: 'var(--party-green)',
                      border: '3px solid #fff',
                      borderRadius: '6px',
                      zIndex: 3,
                    }}
                  />
                )}
                {state.phase === 'ROUND_RESULTS' && Object.entries(state.hostData.results || {}).map(([pid, r]: [string, any]) => (
                  <div
                    key={pid}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      bottom: '4px',
                      left: `calc(${r.value}% - 6px)`,
                      width: '12px',
                      background: state.players[pid]?.avatarColor || '#fff',
                      border: '2px solid #000',
                      borderRadius: '999px',
                      zIndex: 2,
                    }}
                  />
                ))}
              </div>
              {state.phase === 'ROUND_RESULTS' && (
                <div style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 900, color: 'var(--party-yellow)', marginTop: '1rem' }}>
                  🎯 Target: {state.hostData.target}%
                  {state.hostData.psychicBonus > 0 && (
                    <span style={{ color: 'var(--party-green)', marginLeft: '1rem' }}>🔮 {state.hostData.psychicName} +{state.hostData.psychicBonus}</span>
                  )}
                </div>
              )}
            </div>
            {state.phase === 'DIALING' && (
              <div className="host-player-status-grid">
                {seated
                  .filter((p: any) => p.id !== state.hostData.psychicId)
                  .map((p: any) => {
                    const done = state.playerData?.[p.id]?.submitted;
                    return (
                      <div key={p.id} className="host-player-status">
                        <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                        <span>{p.name}</span>
                      </div>
                    );
                  })}
              </div>
            )}
            {state.phase === 'ROUND_RESULTS' && state.hostData.results && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', width: '100%' }}>
                {Object.entries(state.hostData.results).map(([pid, r]: [string, any]) => (
                  <div key={pid} className="party-card" style={{ width: 'auto', maxWidth: 'none', padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 900, color: state.players[pid]?.avatarColor }}>{state.players[pid]?.name}</span>
                    <span className="text-muted">({r.value}%)</span>
                    <span style={{ fontWeight: 900, color: r.points > 0 ? 'var(--party-green)' : 'var(--party-text-muted)' }}>+{r.points} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== BLUFF CLASH ===== */}
        {state.gameType === 'bluff-clash' && (state.phase === 'BLUFFING' || state.phase === 'VOTING' || state.phase === 'ROUND_RESULTS') && (
          <div className="center-stack phase-enter" style={{ maxWidth: '1000px', width: '100%' }}>
            <div className="host-phase-title" style={state.phase === 'BLUFFING' ? undefined : { fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
              <EmojiText text={state.phase === 'BLUFFING' ? '🤥 Write a Believable Lie!' : state.phase === 'VOTING' ? '🔍 Spot the REAL Truth!' : '🤥 The Truth Revealed!'} />
            </div>
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0.5rem auto' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-yellow)' }} /></div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            {/* Once the choices are up they're the main event, so the fact shrinks to fit a 720p TV. */}
            <div className="host-prompt-display" style={state.phase === 'BLUFFING' ? { margin: '1rem 0' } : { margin: '0.5rem 0 1rem', padding: '0.75rem 1.5rem' }}>
              <div className="host-prompt-text" style={state.phase === 'BLUFFING' ? undefined : { fontSize: 'clamp(1.1rem, 2vw, 1.5rem)' }}>{state.hostData.prompt}</div>
            </div>
            {state.phase === 'BLUFFING' && (
              <div className="host-player-status-grid">
                {seated.map((p: any) => {
                  const done = state.playerData?.[p.id]?.submitted;
                  return (
                    <div key={p.id} className="host-player-status">
                      <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                      <span>{p.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {state.phase === 'VOTING' && (
              <>
                <div className="host-answers-grid" style={{ width: '100%', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  {state.hostData.choices?.map((c: any) => (
                    <div key={c.id} className="host-answer-card" style={{ minHeight: 0, padding: '0.75rem 1rem' }}><div className="host-answer-text" style={{ fontSize: 'clamp(1.1rem, 1.8vw, 1.5rem)' }}>{c.text}</div></div>
                  ))}
                </div>
                <div className="host-player-status-grid">
                  {seated.map((p: any) => {
                    const done = state.playerData?.[p.id]?.voted;
                    return (
                      <div key={p.id} className="host-player-status">
                        <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                        <span>{p.name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {state.phase === 'ROUND_RESULTS' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.75rem', width: '100%' }}>
                {state.hostData.revealed?.map((r: any) => (
                  <div
                    key={r.id}
                    className="party-card"
                    style={{
                      maxWidth: 'none',
                      padding: '0.6rem 1rem',
                      border: `3px solid ${r.isTruth ? 'var(--party-green)' : 'var(--party-border)'}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                    }}
                  >
                    <div style={{ minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, overflowWrap: 'anywhere' }}>"{r.text}"</div>
                      <div style={{ color: r.isTruth ? 'var(--party-green)' : 'var(--party-yellow)', fontWeight: 800, fontSize: '0.9rem' }}>
                        {r.isTruth ? '✅ THE TRUTH (+750)' : r.authorIds.length ? `🤥 Lie by ${r.authorIds.map((id: string) => state.players[id]?.name || '?').join(' & ')} (+400/vote)` : '🏠 House lie'}
                      </div>
                    </div>
                    <VoterFaces ids={r.voterIds} players={state.players} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== EMOJI TELEPHONE ===== */}
        {state.gameType === 'emoji-telephone' && (state.phase === 'TRANSLATE' || state.phase === 'GUESS' || state.phase === 'SHOWCASE' || state.phase === 'VOTING') && (
          <div className="center-stack phase-enter" style={{ maxWidth: '1000px', width: '100%' }}>
            <div className="host-phase-title">
              <EmojiText text={state.phase === 'TRANSLATE'
                ? '🔗 Step 1: Translate Into Emojis!'
                : state.phase === 'GUESS'
                ? '🕵️ Step 2: Decode the Emojis!'
                : state.phase === 'SHOWCASE'
                ? `🎬 Chain ${state.hostData.round || 1} of ${state.hostData.totalRounds}`
                : '🏆 Vote for the Funniest Chain!'} />
            </div>
            {(state.hostData.subMessage || state.hostData.message) && (
              <p className="host-prompting-sub">{state.hostData.subMessage || state.hostData.message}</p>
            )}
            {secondsLeft !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: '500px', width: '100%', margin: '0.5rem auto 1rem' }}>
                <div className="host-timer-bar-wrap" style={{ flex: 1, margin: 0 }}><div className="host-timer-bar" style={{ width: `${pct}%`, background: 'var(--party-green)' }} /></div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'monospace' }}>{Math.ceil(secondsLeft)}s</div>
              </div>
            )}
            {(state.phase === 'TRANSLATE' || state.phase === 'GUESS') && (
              <div className="host-player-status-grid">
                {seated.map((p: any) => {
                  const done = state.playerData?.[p.id]?.submitted;
                  return (
                    <div key={p.id} className="host-player-status">
                      <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                      <span>{p.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {state.phase === 'SHOWCASE' && state.hostData.chain && (
              // Side by side on a TV so the punchline (the guess) is never pushed below the fold.
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', width: '100%', marginTop: '0.5rem', alignItems: 'stretch' }}>
                <div className="party-card" style={{ maxWidth: 'none', padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>Original Prompt</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, marginTop: '0.25rem' }}>"{state.hostData.chain.originPrompt}"</div>
                </div>
                <div className="party-card" style={{ maxWidth: 'none', padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--party-cyan)', textTransform: 'uppercase', fontWeight: 800 }}>
                    Translated by {state.hostData.chain.translatorName}
                  </div>
                  <div style={{ fontSize: '2.6rem', lineHeight: 1.25, marginTop: '0.35rem', overflowWrap: 'anywhere' }}>{state.hostData.chain.emojis}</div>
                </div>
                <div className="party-card" style={{ maxWidth: 'none', padding: '1.25rem', textAlign: 'center', border: '3px solid var(--party-yellow)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--party-yellow)', textTransform: 'uppercase', fontWeight: 800 }}>
                    Decoded by {state.hostData.chain.guesserName}
                  </div>
                  <div style={{ fontSize: '1.7rem', fontWeight: 900, marginTop: '0.25rem', overflowWrap: 'anywhere' }}>"{state.hostData.chain.guess}"</div>
                </div>
              </div>
            )}
            {state.phase === 'VOTING' && state.hostData.chains && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', width: '100%' }}>
                  {state.hostData.chains.map((c: any) => (
                    <div key={c.id} className="party-card" style={{ padding: '1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)' }}>"{c.originPrompt}"</div>
                      <div style={{ fontSize: '1.9rem', lineHeight: 1.25, margin: '0.35rem 0', overflowWrap: 'anywhere' }}>{c.emojis}</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--party-yellow)' }}>"{c.guess}"</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)', marginTop: '0.25rem' }}>
                        {c.translatorName} → {c.guesserName}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="host-player-status-grid" style={{ marginTop: '1rem' }}>
                  {seated.map((p: any) => {
                    const done = state.playerData?.[p.id]?.voted;
                    return (
                      <div key={p.id} className="host-player-status">
                        <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                        <span>{p.name}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {state.audienceVote && (
          <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 5, background: 'rgba(6,182,212,0.15)', border: '2px solid var(--party-cyan)', borderRadius: '999px', padding: '0.4rem 1rem', color: 'var(--party-cyan)', fontWeight: 800, fontSize: '0.9rem' }}>
            👀 Audience voting · {state.audienceVote.voteCount} vote{state.audienceVote.voteCount === 1 ? '' : 's'}
          </div>
        )}

        {/* ===== FINAL LEADERBOARD ===== */}
        {state.phase === 'FINAL_RESULTS' && (
          <div className="center-stack phase-enter">
            {(() => {
              const standings = [...seated].sort((a: any, b: any) => b.score - a.score) as any[];
              const podium = [standings[1], standings[0], standings[2]];
              const nameOf = (pid: string) => state.players[pid]?.name || '?';
              const baseScores: Record<string, number> | undefined = state.gameData?.baseScores;
              return (
                <>
                  <div className="host-leaderboard-title" style={{ marginBottom: '0.35rem' }}><EmojiText text="🏆 Session Leaderboard" /></div>
                  <p className="text-muted" style={{ marginBottom: '1.25rem', fontSize: '0.95rem' }}>
                    Scores carry over across games in this session!
                  </p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    {podium.map((p: any, i: number) => {
                      if (!p) return null;
                      const delta = baseScores ? p.score - (baseScores[p.id] || 0) : null;
                      return (
                        <div key={p.id} style={{ textAlign: 'center', width: 175 }}>
                          <div style={{ fontSize: '2.5rem' }}>{['🥈', '🥇', '🥉'][i]}</div>
                          <div style={{ fontWeight: 900, fontSize: '1.2rem', color: p.avatarColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                          <div style={{ height: [130, 180, 100][i], background: p.avatarColor, opacity: 0.85, borderRadius: '12px 12px 0 0', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '0.75rem', color: '#0b0b12', fontWeight: 900, fontSize: '1.4rem' }}>
                            <div>{p.score.toLocaleString()}</div>
                            {delta !== null && delta !== p.score && (
                              <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.15rem' }}>
                                ({delta >= 0 ? `+${delta}` : delta} this game)
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {standings.length > 3 && (
                    <div style={{ color: 'var(--party-text-muted)', marginBottom: '1.5rem', textAlign: 'center' }}>
                      {standings.slice(3).map((p: any, i: number) => `${i + 4}. ${p.name} (${p.score.toLocaleString()})`).join('  ·  ')}
                    </div>
                  )}
                  {state.awards?.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', width: '100%', maxWidth: 900, marginBottom: '1.5rem' }}>
                      {state.awards.map((a: any) => (
                        <div key={a.title} className="host-player-card" style={{ textAlign: 'left', padding: '1rem' }}>
                          <div style={{ fontSize: '1.8rem' }}>{a.emoji}</div>
                          <div style={{ fontWeight: 900 }}>{a.title}</div>
                          <div style={{ color: 'var(--party-yellow)', fontWeight: 800 }}>{a.playerIds.map(nameOf).join(' & ')}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--party-text-muted)' }}>{a.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {state.audienceLeaders?.length > 0 && (
                    <div style={{ color: 'var(--party-cyan)', fontWeight: 800, marginBottom: '1.5rem' }}>
                      👀 Audience MVP: {state.audienceLeaders.map((a: any) => `${a.name} (${a.score})`).join(', ')}
                    </div>
                  )}
                  <button className="party-btn party-btn-outline party-btn-inline" style={{ marginBottom: '1.5rem' }} onClick={() => shareResultsCard({
                    gameName: gameName.replace(/^\S+\s/, ''),
                    roomCode: state.roomCode,
                    standings: standings.map((p: any) => ({ name: p.name, score: p.score, color: p.avatarColor })),
                    awards: (state.awards || []).map((a: any) => ({ emoji: a.emoji, title: a.title, detail: a.detail, names: a.playerIds.map(nameOf) })),
                  })}>📸 Save results image</button>
                </>
              );
            })()}
            <PostGameOptions
              gameType={state.gameType}
              onPlayAgain={handlePlayAgain}
              onSwitch={handleSwitch}
              onCloseRoom={handleCloseRoom}
              hasScores={Object.values(state.players).some((p: any) => p.score > 0)}
              onResetScores={() => sendAction({ type: 'RESET_SCORES' })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
