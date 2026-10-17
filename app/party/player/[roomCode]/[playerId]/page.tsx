'use client';
import { useState, useEffect, use, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { shareResultsCard } from '@/components/party/resultsCard';
import { useImmersive } from '@/components/party/HostShow';
import { ReactionBar, PhoneSessionControls, HowToPlayModal, ShareInviteButton, safetyQuip, useTurnBuzz } from '@/components/party/PhoneExtras';
import { GAME_GUIDES } from '@/lib/party/guides';
import { GameType } from '@/lib/party/types';

const GAME_NAMES: Record<string, string> = {
  'quip-clash': 'Quip Clash',
  'the-faker': 'The Faker',
  'trivia-death': 'Trivia Death',
  'bracket-battles': 'Bracket Battles',
  'ready-set-bet': 'Ready Set Bet',
  'spyfall': 'Spyfall',
  'herd-mentality': 'Herd Mentality',
  'wavelength': 'Wavelength',
  'bluff-clash': 'Bluff Clash',
  'emoji-telephone': 'Emoji Telephone',
};

const ALL_GAMES: { id: string; label: string; minPlayers: number }[] = [
  { id: 'quip-clash', label: '⚡ Quip Clash', minPlayers: 3 },
  { id: 'the-faker', label: '🕵️ The Faker', minPlayers: 3 },
  { id: 'trivia-death', label: '💀 Trivia Death', minPlayers: 3 },
  { id: 'bracket-battles', label: '🏆 Bracket Battles', minPlayers: 3 },
  { id: 'ready-set-bet', label: '🐎 Ready Set Bet', minPlayers: 1 },
  { id: 'spyfall', label: '🕵️‍♀️ Spyfall', minPlayers: 3 },
  { id: 'herd-mentality', label: '🐄 Herd Mentality', minPlayers: 3 },
  { id: 'wavelength', label: '📡 Wavelength', minPlayers: 2 },
  { id: 'bluff-clash', label: '🤥 Bluff Clash', minPlayers: 3 },
  { id: 'emoji-telephone', label: '🔗 Emoji Telephone', minPlayers: 3 },
];

const QUICK_EMOJIS = [
  '😂','😭','😱','😡','🥳','🤯','🤠','🤡','👻','💀','👽','🤖','🎃','👀','🧠','👑',
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐸','🐵','🐔','🐧','🦖','🐙','🦈','🐝',
  '🍔','🍕','🌮','🍣','🍦','🍩','🍪','🎂','🍿','☕','🍺','🍷','🍾','🌶️','🍌','🥑',
  '🚗','✈️','🚀','🛸','⛵','🚓','🚑','🚒','🏠','🏰','🏝️','🌋','⛺','🏥','🏫','🏦',
  '⚽','🏀','🏈','⚾','🎾','🎮','🎲','🎸','🎺','🎬','🎤','🎧','📸','📱','💻','💣',
  '🔥','💧','⚡','🌈','☀️','🌙','⭐','❄️','💸','💎','🔑','🎁','🎈','🎉','❤️','💔',
];

/** Trim to `max` user-visible characters without splitting multi-codepoint emoji. */
function capGraphemes(text: string, max: number) {
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (g) => g.segment);
  return parts.length > max ? parts.slice(0, max).join('') : text;
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
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timerStart, timerDuration]);
  const pct = (timerStart && timerDuration && secondsLeft !== null)
    ? (secondsLeft / timerDuration) * 100 : 100;
  return { secondsLeft, pct };
}

function JoinQrCode({ roomCode }: { roomCode: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = `${window.location.origin}/party?code=${roomCode}`;
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#0b0b12', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [roomCode]);
  if (!src) return null;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', background: '#fff', padding: '0.6rem', borderRadius: '14px' }}>
      <img src={src} alt={`Scan to join room ${roomCode}`} width={150} height={150} />
      <span style={{ color: '#0b0b12', fontWeight: 800, fontSize: '0.75rem' }}>Scan to join {roomCode}</span>
    </div>
  );
}

export default function PlayerPage({ params }: { params: Promise<{ roomCode: string; playerId: string }> }) {
  const { roomCode, playerId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [hostId, setHostId] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState(['', '']);
  const [voted, setVoted] = useState(false);
  const [kfAnswer, setKfAnswer] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [dialValue, setDialValue] = useState(50);
  const [hideSpyRole, setHideSpyRole] = useState(false);
  const [showSpyLocations, setShowSpyLocations] = useState(false);
  const [spyGuessPick, setSpyGuessPick] = useState<string | null>(null);
  const [confirmCallVote, setConfirmCallVote] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sendError, setSendError] = useState('');
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImmersive('party-phone');

  // Detect VIP host token from URL or localStorage
  useEffect(() => {
    const qHost = searchParams.get('hostId');
    if (qHost) {
      setHostId(qHost);
      try { localStorage.setItem('host_' + roomCode, qHost); } catch { /* ignore */ }
    } else {
      try {
        const saved = localStorage.getItem('host_' + roomCode);
        if (saved) setHostId(saved);
      } catch { /* ignore */ }
    }
  }, [roomCode, searchParams]);

  // Prompt packs for VIP lobby controls
  const [packs, setPacks] = useState<{ id: string; name: string; emoji: string; counts: Record<string, number> }[]>([]);
  useEffect(() => {
    if (!hostId) return;
    fetch('/api/party/packs').then(r => r.json()).then(d => { if (d.success) setPacks(d.packs); }).catch(() => {});
  }, [hostId]);

  const { secondsLeft, pct } = useCountdown(state?.hostData?.timerStart, state?.hostData?.timerDuration);

  // Vibrate when a new screen asks for input.
  const inputPhases = [
    'PROMPTING', 'VOTING', 'QUESTION', 'FINAL_ESCAPE', 'PREDICTION', 'MATCHUP',
    'TIEBREAKER', 'RACING', 'TASK_DELIVERY', 'DISCUSSION', 'CLUE_GIVING',
    'DIALING', 'BLUFFING', 'TRANSLATE', 'GUESS',
  ];
  useTurnBuzz(
    state ? `${state.phase}|${state.data?.phase}|${state.data?.prompt || state.data?.question || state.data?.clue || ''}|${state.data?.isOnFloor ? 'floor' : ''}` : null,
    !!state && (inputPhases.includes(state.data?.phase) || (state.data?.phase === 'KILLING_FLOOR' && state.data?.isOnFloor))
  );

  useEffect(() => {
    const sse = new EventSource(`/api/party/stream/player?roomCode=${roomCode}&playerId=${playerId}`);
    sse.onopen = () => setReconnecting(false);
    sse.onerror = () => setReconnecting(true);
    sse.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }
      setReconnecting(false);
      if (data.error) {
        try { localStorage.removeItem('partyLastPlayed'); } catch { /* ignore */ }
        setError(data.error);
        sse.close();
      } else {
        setState(data);
      }
    };
    return () => sse.close();
  }, [roomCode, playerId]);

  // New prompts (next Quip Clash round) start with empty answer boxes.
  const promptKey = JSON.stringify(state?.data?.prompts ?? null);
  useEffect(() => { setAnswers(['', '']); }, [promptKey]);

  useEffect(() => {
    setVoted(false);
    setKfAnswer('');
    setInputValue('');
    setDialValue(50);
    setShowSpyLocations(false);
    setSpyGuessPick(null);
    setConfirmCallVote(false);
  }, [
    state?.phase,
    state?.data?.phase,
    state?.data?.question,
    state?.data?.prompt,
    state?.data?.clue,
    state?.data?.mathQuestion,
    state?.data?.miniGame,
    state?.data?.propBet,
    state?.data?.round,
  ]);

  const sendAction = async (action: any): Promise<boolean> => {
    try {
      const res = await fetch('/api/party/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId, action }),
      });
      if (res.ok) { setSendError(''); return true; }
      const data = await res.json().catch(() => ({}));
      setSendError(data.error || 'That didn\'t go through — try again');
    } catch {
      setSendError('Connection problem — try again');
    }
    return false;
  };

  const sendHostAction = useCallback(async (action: any): Promise<boolean> => {
    if (!hostId) return false;
    try {
      const res = await fetch('/api/party/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId: hostId, action }),
      });
      if (res.ok) { setSendError(''); return true; }
      const data = await res.json().catch(() => ({}));
      setSendError(data.error || 'Host action failed');
    } catch {
      setSendError('Connection problem — try again');
    }
    return false;
  }, [roomCode, hostId]);

  // Fallback client auto-advance timer for VIP hosts
  useEffect(() => {
    if (!hostId || !state?.hostData?.autoAdvanceAt || !state?.hostData?.autoAdvanceAction) return;
    const delay = Math.max(state.hostData.autoAdvanceAt - Date.now(), 250);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      sendHostAction({ type: state.hostData.autoAdvanceAction, deadline: state.hostData.autoAdvanceAt });
    }, delay);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [hostId, state?.hostData?.autoAdvanceAt, state?.hostData?.autoAdvanceAction, sendHostAction]);

  const submitOnce = async (action: any) => {
    setVoted(true);
    if (!(await sendAction(action))) setVoted(false);
  };

  const handleCloseRoomAsVip = async () => {
    await sendHostAction({ type: 'CLOSE_ROOM' });
    try {
      localStorage.removeItem('partyLastHosted');
      localStorage.removeItem('partyLastPlayed');
      localStorage.removeItem(`host_${roomCode}`);
    } catch { /* ignore */ }
    router.push('/party');
  };

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: 'var(--party-bg)', padding: '1rem', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem' }}>🚪</div>
      <p style={{ color: 'var(--party-red)', fontWeight: 700 }}>{error}</p>
      <Link href="/party" className="party-btn party-btn-primary">Back to Party</Link>
    </div>
  );

  if (!state) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--party-bg)', color: 'var(--party-text-muted)' }}>
      Connecting to {roomCode}…
    </div>
  );

  const me = state.me;
  const pd = state.data;
  const hd = state.hostData || {};
  const myScore = pd?.money !== undefined ? pd.money : (state.players?.[me.id]?.score ?? 0);
  const activePlayers = (Object.values(state.players || {}) as any[]).filter((p) => !p.left);
  const others = activePlayers.filter((p) => p.id !== me.id);
  const takenAvatars = others.map((p) => p.avatar).filter(Boolean) as string[];
  const standings = [...activePlayers].sort((a, b) => b.score - a.score);
  const myRank = standings.findIndex((p) => p.id === me.id) + 1;

  const isPlaying = state.phase !== 'LOBBY' && state.phase !== 'FINAL_RESULTS';
  const canSkip = !!hostId && isPlaying && hd?.autoAdvanceAction && hd.autoAdvanceAction !== 'RACE_TICK';
  const currentGameInfo = ALL_GAMES.find((g) => g.id === state.gameType) || ALL_GAMES[0];
  const PACK_LIST_KEY: Record<string, string> = {
    'quip-clash': 'quipClash',
    'the-faker': 'theFaker',
    'bracket-battles': 'bracketBattles',
    'trivia-death': 'triviaQuestions',
    'spyfall': 'spyfallLocations',
    'herd-mentality': 'herdMentality',
    'wavelength': 'wavelengthSpectrums',
    'bluff-clash': 'bluffFacts',
    'emoji-telephone': 'emojiTelephone',
  };
  const activePacks: string[] = state?.settings?.packs?.length ? state.settings.packs : ['classic'];
  const togglePack = (id: string) => {
    const next = activePacks.includes(id) ? activePacks.filter(p => p !== id) : [...activePacks, id];
    if (next.length) sendHostAction({ type: 'SET_PACKS', packs: next });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--party-bg)' }}>
      {/* Top Player Header */}
      <div className="player-header party-content" style={{ borderBottomColor: me.avatarColor, gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: '1 1 110px', minWidth: 0, overflow: 'hidden' }}>
          {me.avatar && <span style={{ fontSize: '1.65rem', flexShrink: 0 }}>{me.avatar}</span>}
          <div className="player-header-name" style={{ color: me.avatarColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.name} {pd?.status === 'ghost' ? '👻' : ''}
          </div>
          {hostId && (
            <span style={{ background: 'rgba(6, 182, 212, 0.2)', border: '1px solid var(--party-cyan)', color: 'var(--party-cyan)', borderRadius: '999px', padding: '0.15rem 0.45rem', fontSize: '0.68rem', fontWeight: 900, whiteSpace: 'nowrap', flexShrink: 0 }}>
              👑 VIP
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexShrink: 0 }}>
          <PhoneSessionControls
            roomCode={roomCode}
            actorKey={playerId}
            currentName={me.name}
            currentAvatar={me.avatar}
            takenAvatars={takenAvatars}
            gameType={state.gameType}
          />
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="player-header-score-label">{pd?.money !== undefined ? 'Money' : 'Score'}</div>
            <div className="player-header-score">{pd?.money !== undefined ? '$' + myScore : myScore}</div>
          </div>
        </div>
      </div>

      {/* Live Countdown & VIP Action Strip during Gameplay */}
      {isPlaying && (secondsLeft !== null || hostId || (state.waitingOn?.length > 0 && !state.waitingOn.includes(me.name))) && (
        <div style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--party-border)', padding: '0.45rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', zIndex: 5 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)' }}>
            {currentGameInfo.label}
            {hd?.round && hd?.totalRounds ? ` · R${hd.round}/${hd.totalRounds}` : ''}
          </div>
          {secondsLeft !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '110px' }}>
              <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct < 25 ? 'var(--party-red)' : 'var(--party-cyan)', transition: 'width 0.25s linear' }} />
              </div>
              <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '0.9rem', color: pct < 25 ? 'var(--party-red)' : 'var(--party-text)' }}>
                {Math.ceil(secondsLeft)}s
              </span>
            </div>
          )}
          {state.waitingOn?.length > 0 && !state.waitingOn.includes(me.name) && (
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--party-yellow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
              ⏳ Waiting on: {state.waitingOn.join(', ')}
            </div>
          )}
          {hostId && (
            <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
              {canSkip && (
                <button
                  type="button"
                  onClick={() => sendHostAction({ type: hd.autoAdvanceAction })}
                  style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--party-border)', borderRadius: '8px', color: 'var(--party-text)', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.6rem', cursor: 'pointer' }}
                >
                  ⏭️ Skip
                </button>
              )}
              <button
                type="button"
                onClick={() => { if (window.confirm('End this game and send everyone back to the lobby?')) sendHostAction({ type: 'QUIT_GAME' }); }}
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: 'var(--party-red)', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.6rem', cursor: 'pointer' }}
              >
                ↩ Lobby
              </button>
            </div>
          )}
        </div>
      )}

      {reconnecting && (
        <div role="status" style={{ background: 'var(--party-yellow)', color: '#000', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', padding: '0.35rem' }}>
          Reconnecting…
        </div>
      )}
      {sendError && (
        <div role="alert" onClick={() => setSendError('')} style={{ background: 'var(--party-red)', color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', padding: '0.35rem', cursor: 'pointer' }}>
          {sendError}
        </div>
      )}

      <div className="player-body party-content">
        {/* ===== LOBBY ===== */}
        {state.phase === 'LOBBY' && (
          <div className="player-waiting" style={{ justifyContent: 'flex-start', paddingTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--party-border)', borderRadius: '16px', padding: '0.75rem 1.1rem', width: '100%', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--party-text-muted)', fontWeight: 800 }}>Room Code</div>
                <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.75rem', fontWeight: 900, letterSpacing: '0.15em', color: 'var(--party-yellow)' }}>{roomCode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--party-cyan)' }}>{currentGameInfo.label}</div>
                <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                  <ShareInviteButton roomCode={roomCode} compact />
                  <button
                    type="button"
                    onClick={() => setShowQr(!showQr)}
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--party-border)', borderRadius: '8px', color: 'var(--party-text)', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.55rem', cursor: 'pointer' }}
                  >
                    {showQr ? 'Hide QR' : '📱 QR'}
                  </button>
                </div>
              </div>
            </div>

            {showQr && (
              <div style={{ margin: '0.75rem 0' }}>
                <JoinQrCode roomCode={roomCode} />
              </div>
            )}

            {/* Quick 3-Step How to Play Card in Lobby */}
            {(() => {
              const guide = GAME_GUIDES[state.gameType as GameType];
              if (!guide) return null;
              return (
                <div style={{ width: '100%', marginTop: '0.85rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--party-border)', borderRadius: '16px', padding: '0.85rem 1rem', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.45rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--party-cyan)' }}>
                      🕹️ How to Play {guide.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRulesModal(true)}
                      style={{ background: 'rgba(6, 182, 212, 0.15)', border: '1px solid rgba(6, 182, 212, 0.45)', borderRadius: '999px', color: 'var(--party-cyan)', fontSize: '0.72rem', fontWeight: 800, padding: '0.2rem 0.65rem', cursor: 'pointer' }}
                    >
                      ❓ Scoring &amp; All Games
                    </button>
                  </div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fff', marginBottom: '0.4rem' }}>
                    🎯 {guide.goal}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--party-text-muted)' }}>
                    {guide.steps.map((s, idx) => (
                      <div key={idx}><strong>{idx + 1}.</strong> {s}</div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Players in Room */}
            <div style={{ width: '100%', marginTop: '1rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--party-text-muted)', marginBottom: '0.5rem', textAlign: 'center' }}>
                Players in Room ({activePlayers.length}/16)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', justifyContent: 'center' }}>
                {activePlayers.map((p) => (
                  <span
                    key={p.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      border: `2px solid ${p.avatarColor}`,
                      background: p.id === me.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                      color: p.avatarColor,
                      borderRadius: '999px',
                      padding: '0.25rem 0.75rem',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      opacity: p.connected ? 1 : 0.45,
                    }}
                  >
                    <span>
                      {p.avatar} {p.name}{p.id === me.id ? ' (You)' : ''}
                      {p.score > 0 ? ` · 🏆 ${p.score.toLocaleString()}` : ''}
                    </span>
                    {hostId && p.id !== me.id && (
                      <button
                        type="button"
                        onClick={() => sendHostAction({ type: 'KICK_PLAYER', targetId: p.id })}
                        title={`Remove ${p.name}`}
                        style={{ background: 'transparent', border: 'none', color: 'var(--party-text-muted)', cursor: 'pointer', fontWeight: 900, fontSize: '0.8rem', padding: '0 0.15rem' }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Session Leaderboard in Lobby */}
            {standings.some((p) => p.score > 0) && (
              <div style={{ width: '100%', marginTop: '0.85rem', background: 'rgba(250, 204, 21, 0.06)', border: '1px solid rgba(250, 204, 21, 0.3)', borderRadius: '14px', padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'left', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 900, color: 'var(--party-yellow)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.06em' }}>🏆 Session Leaderboard</div>
                  <div style={{ fontWeight: 800, marginTop: '0.15rem' }}>
                    {standings.slice(0, 3).map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} (${p.score.toLocaleString()})`).join(' · ')}
                  </div>
                </div>
                {hostId && (
                  <button
                    type="button"
                    onClick={() => sendHostAction({ type: 'RESET_SCORES' })}
                    style={{ background: 'rgba(250, 204, 21, 0.14)', border: '1px solid rgba(250, 204, 21, 0.45)', borderRadius: '8px', color: 'var(--party-yellow)', fontSize: '0.72rem', fontWeight: 800, padding: '0.25rem 0.6rem', cursor: 'pointer' }}
                  >
                    🔄 Reset Scores
                  </button>
                )}
              </div>
            )}

            {/* VIP Host Lobby Controls */}
            {hostId ? (
              <div style={{ width: '100%', marginTop: '1.25rem', background: 'rgba(6, 182, 212, 0.07)', border: '2px solid rgba(6, 182, 212, 0.35)', borderRadius: '18px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--party-cyan)' }}>👑 VIP Host Controls</span>
                  <button
                    type="button"
                    onClick={handleCloseRoomAsVip}
                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: 'var(--party-red)', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.6rem', cursor: 'pointer' }}
                  >
                    🚪 Close Room
                  </button>
                </div>

                {state.gameType === 'quip-clash' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Rounds:</span>
                    {[1, 2, 3].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => sendHostAction({ type: 'SET_QUIP_ROUNDS', rounds: r })}
                        style={{
                          background: (state.targetRounds || 1) === r ? 'var(--party-yellow)' : 'transparent',
                          color: (state.targetRounds || 1) === r ? '#000' : '#fff',
                          border: '2px solid var(--party-yellow)',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '8px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}

                {packs.length > 1 && PACK_LIST_KEY[state.gameType] && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, width: '100%', textAlign: 'center', color: 'var(--party-text-muted)' }}>Prompt Packs:</span>
                    {packs.map((p) => {
                      const on = activePacks.includes(p.id);
                      const size = p.counts[PACK_LIST_KEY[state.gameType]] || 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePack(p.id)}
                          disabled={size === 0 && !on}
                          style={{
                            background: on ? 'var(--party-purple, #7c3aed)' : 'transparent',
                            color: '#fff',
                            border: '1.5px solid var(--party-purple-lt)',
                            padding: '0.25rem 0.65rem',
                            borderRadius: '999px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            opacity: size === 0 && !on ? 0.4 : 1,
                          }}
                        >
                          {on ? '✓ ' : ''}{p.emoji} {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {activePlayers.length >= currentGameInfo.minPlayers ? (
                  <button
                    type="button"
                    onClick={() => sendHostAction({ type: 'START_GAME' })}
                    className="party-btn party-btn-primary"
                    style={{ fontSize: '1.2rem', padding: '1rem' }}
                  >
                    Start {currentGameInfo.label}! 🎮
                  </button>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--party-yellow)', fontWeight: 800, fontSize: '0.9rem', padding: '0.5rem' }}>
                    Waiting for at least {currentGameInfo.minPlayers} players ({activePlayers.length}/{currentGameInfo.minPlayers})…
                  </div>
                )}

                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)', fontWeight: 800, textAlign: 'center', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Switch Game
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' }}>
                    {ALL_GAMES.map((g) => {
                      const active = g.id === state.gameType;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => !active && sendHostAction({ type: 'SWITCH_GAME', gameType: g.id })}
                          style={{
                            background: active ? 'var(--party-cyan)' : 'rgba(255,255,255,0.06)',
                            color: active ? '#0b0b12' : 'var(--party-text)',
                            border: `1.5px solid ${active ? 'var(--party-cyan)' : 'var(--party-border)'}`,
                            borderRadius: '999px',
                            padding: '0.3rem 0.7rem',
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            cursor: active ? 'default' : 'pointer',
                          }}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="player-waiting-sub" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
                Waiting for the host to start {currentGameInfo.label}…
              </p>
            )}
          </div>
        )}

        {/* ===== QUIP CLASH ===== */}
        {pd?.phase === 'PROMPTING' && state.gameType === 'quip-clash' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[0, 1].map((i) => (
              <div key={i} className="player-prompt-card">
                <div className="player-prompt-text">"{pd.prompts[i]}"</div>
                {pd.answers?.[i] ? <div className="player-submitted-badge">✅ Submitted!</div> : (
                  <form className="player-answer-row" onSubmit={e => { e.preventDefault(); if (answers[i].trim()) sendAction({ type: 'SUBMIT_ANSWER', promptIndex: i, answer: answers[i].trim() }); }}>
                    <input className="player-input" value={answers[i]} maxLength={80} placeholder="Be funny…" enterKeyHint="send" autoFocus={i === 0}
                      onChange={e => { const c=[...answers]; c[i]=e.target.value; setAnswers(c); }} />
                    <button type="submit" disabled={!answers[i].trim()} className="party-btn party-btn-primary party-btn-inline">Send</button>
                  </form>
                )}
                {!pd.answers?.[i] && (
                  <button type="button" className="party-safety-btn" onClick={() => { const c = [...answers]; c[i] = safetyQuip(); setAnswers(c); }}>🛟 Safety quip</button>
                )}
              </div>
            ))}
          </div>
        )}
        {pd?.phase === 'VOTING' && state.gameType === 'quip-clash' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="player-vote-prompt-text mb-4 text-center">"{pd.prompt}"</div>
            {voted ? <div className="player-waiting"><div className="player-waiting-title">Voted!</div></div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {pd.answers?.map((a: any) => (
                  <button key={a.id} className="player-vote-btn" onClick={() => submitOnce({ type: 'SUBMIT_VOTE', votedForId: a.id })}>{a.answer}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'WAITING' && state.gameType === 'quip-clash' && (
          <div className="player-look-tv" style={{ gap: '1rem' }}>
            {state.phase === 'VOTING' && hd?.prompt ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'var(--party-yellow)', textTransform: 'uppercase' }}>
                  Your Matchup — Others Are Voting!
                </div>
                <div className="player-prompt-box" style={{ marginBottom: '0.25rem' }}>"{hd.prompt}"</div>
                {hd.answers?.map((a: any, idx: number) => (
                  <div key={idx} className="party-card" style={{ padding: '1rem', textAlign: 'center', fontWeight: 800, fontSize: '1.1rem' }}>
                    {a.answer}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="player-look-tv-icon">⏳</div>
                {pd.message && <p className="player-waiting-sub" style={{ textAlign: 'center' }}>{pd.message}</p>}
              </>
            )}
          </div>
        )}
        {state.phase === 'ROUND_RESULTS' && state.gameType === 'quip-clash' && hd?.tally && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div className="player-prompt-box" style={{ marginBottom: '0.25rem' }}>"{hd.prompt}"</div>
            {Object.keys(hd.tally).map((pid) => {
              const isWinner = hd.quipLash === pid;
              return (
                <div
                  key={pid}
                  className="party-card"
                  style={{
                    padding: '1rem',
                    border: `2px solid ${isWinner ? 'var(--party-yellow)' : 'var(--party-border)'}`,
                    background: isWinner ? 'rgba(250, 204, 21, 0.1)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 900, color: state.players[pid]?.avatarColor }}>
                      {state.players[pid]?.avatar} {state.players[pid]?.name}
                    </span>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--party-yellow)' }}>
                      {hd.tally[pid]} vote{hd.tally[pid] === 1 ? '' : 's'} {isWinner ? '⚡ QUIP LASH!' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>"{hd.answers?.[pid]}"</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== FAKER ===== */}
        {pd?.phase === 'TASK_DELIVERY' && state.gameType === 'the-faker' && (
          <div className={`player-role-card ${pd.role === 'FAKER' ? 'faker' : pd.role === 'ELIMINATED' ? 'eliminated' : 'innocent'}`}>
            <div className="player-role-title">{pd.role === 'ELIMINATED' ? 'Eliminated 💀' : pd.role === 'FAKER' ? 'You Are The Faker!' : 'Your Secret Task'}</div>
            <p className="player-role-instruction">{pd.instruction || pd.message}</p>
            {pd.prompt && <div className="player-task-box">"{pd.prompt}"</div>}
          </div>
        )}
        {pd?.role === 'ELIMINATED' && state.gameType === 'the-faker' && pd?.phase !== 'RESULTS' && (
          <div className="player-role-card eliminated">
            <div className="player-role-title">Eliminated 💀</div>
            <p className="player-role-instruction">{pd.message || 'Watch the round play out!'}</p>
          </div>
        )}
        {pd?.showAction && pd?.phase !== 'VOTING' && (
          <div className="player-waiting">
            <div style={{ fontSize: '5rem', animation: 'avatarPulse 0.5s infinite' }}>🏃</div>
            <div className="player-waiting-title text-red">PERFORM &amp; FREEZE!</div>
            <p className="player-waiting-sub">Look at the other players in the room!</p>
          </div>
        )}
        {pd?.phase === 'VOTING' && state.gameType === 'the-faker' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="player-vote-prompt text-red text-center mb-4 font-bold">Vote out The Faker!</div>
            {voted ? <div className="player-waiting">Voted!</div> : (
              <div className="player-faker-vote-grid">
                {pd.activePlayers.filter((pid:string) => pid !== me.id).map((pid:string) => (
                  <button key={pid} className="player-faker-vote-btn" onClick={() => submitOnce({ type: 'SUBMIT_VOTE', votedFor: pid })}>{state.players[pid]?.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {state.phase === 'RESULTS' && state.gameType === 'the-faker' && (
          <div className="player-result-screen" style={{ gap: '0.85rem' }}>
            <div style={{ fontSize: '2.5rem' }}>{hd.fakerCaught ? '🎯' : '👻'}</div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.5rem', color: hd.fakerCaught ? 'var(--party-green)' : 'var(--party-red)' }}>
              {hd.fakerCaught ? 'Faker Caught!' : hd.fakerEliminated ? 'Wrong Person Eliminated!' : 'Faker Escaped!'}
            </div>
            {hd.eliminated && (
              <div style={{ fontWeight: 800 }}>
                {state.players[hd.eliminated]?.name} was voted out.
              </div>
            )}
            <div className="party-card" style={{ width: '100%', padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--party-text-muted)', fontWeight: 800 }}>The Faker Was</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--party-red)', marginTop: '0.2rem' }}>
                {state.players[hd.fakerId]?.avatar} {state.players[hd.fakerId]?.name}
              </div>
            </div>
            {hd.task && (
              <div className="party-card" style={{ width: '100%', padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--party-text-muted)', fontWeight: 800 }}>The Hidden Task Was</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: '0.25rem' }}>"{hd.task}"</div>
              </div>
            )}
          </div>
        )}

        {/* ===== TRIVIA DEATH — MURDER HOTEL ===== */}
        {(pd?.phase === 'QUESTION' || pd?.phase === 'FINAL_ESCAPE') && state.gameType === 'trivia-death' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {pd.status === 'ghost' && (
              <div className="player-ghost-streak">
                <span>👻</span>
                {[0,1,2].map(i => (
                  <div key={i} className={`player-ghost-pip ${(pd.ghostStreak || 0) > i ? 'filled' : ''}`} />
                ))}
                <span style={{ fontSize: '0.85rem', marginLeft: '0.25rem' }}>to resurrect</span>
              </div>
            )}
            {pd.status === 'alive' && (
              <div style={{ textAlign: 'center', marginBottom: '0.75rem', color: 'var(--party-green)', fontWeight: 900, fontSize: '0.9rem' }}>Alive • ${pd.money ?? 0}</div>
            )}
            {pd.category && <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--party-text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>{pd.category}</div>}
            <div className="player-prompt-text" style={{ marginBottom: '1rem', textAlign: 'center' }}>{pd.question}</div>

            {pd.phase === 'FINAL_ESCAPE' && pd.allowDoubleDown && !voted && (
              <div style={{ background: 'rgba(239,64,64,0.1)', border: '2px solid var(--party-red)', padding: '0.75rem', borderRadius: '12px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input type="checkbox" id="doubleDown" checked={inputValue === 'true'} onChange={e => setInputValue(e.target.checked ? 'true' : '')} style={{ width: '1.5rem', height: '1.5rem', accentColor: 'var(--party-red)' }} />
                <label htmlFor="doubleDown" style={{ color: 'var(--party-red)', fontWeight: 900, cursor: 'pointer' }}>DOUBLE DOWN (+2 / -2)</label>
              </div>
            )}

            {voted ? (
              <div className="player-waiting"><div className="player-waiting-title">Answered!</div><div className="player-waiting-sub">Waiting for other players…</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {pd.choices?.map((c: string, idx: number) => (
                  <button key={idx} className="player-trivia-choice" onClick={() => submitOnce({
                    type: pd.phase === 'FINAL_ESCAPE' ? 'SUBMIT_ESCAPE_ANSWER' : 'SUBMIT_TRIVIA_ANSWER',
                    answer: idx,
                    doubleDown: inputValue === 'true',
                  })}>
                    <div className="host-trivia-choice-letter">{['A','B','C','D'][idx]}</div> {c}
                  </button>
                ))}
              </div>
            )}
            {pd.flavor && <div className="player-flavor-msg" style={{ marginTop: '1rem' }}>{pd.flavor}</div>}
          </div>
        )}
        {pd?.phase === 'QUESTION_RESULTS' && state.gameType === 'trivia-death' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ textAlign: 'center', fontSize: '1.35rem', fontWeight: 900, color: pd.correct ? 'var(--party-green)' : 'var(--party-red)' }}>
              {pd.correct ? '✅ Correct!' : pd.going_to_killing_floor ? '💀 WRONG! To the Killing Floor!' : '❌ Wrong!'}
            </div>
            {hd.question && <div className="player-prompt-text" style={{ textAlign: 'center', fontSize: '1rem' }}>{hd.question}</div>}
            {hd.choices && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {hd.choices.map((c: string, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.65rem 0.9rem',
                      borderRadius: '12px',
                      fontWeight: 800,
                      border: `2px solid ${idx === hd.correctAnswer ? 'var(--party-green)' : 'var(--party-border)'}`,
                      background: idx === hd.correctAnswer ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.03)',
                      opacity: idx === hd.correctAnswer ? 1 : 0.55,
                    }}
                  >
                    {['A','B','C','D'][idx]}. {c} {idx === hd.correctAnswer ? '✓' : ''}
                  </div>
                ))}
              </div>
            )}
            {hd.killingFloorPlayers?.length > 0 && (
              <div style={{ textAlign: 'center', color: 'var(--party-red)', fontWeight: 800, fontSize: '0.9rem', marginTop: '0.25rem' }}>
                💀 On the Killing Floor: {hd.killingFloorPlayers.map((pid: string) => state.players[pid]?.name).join(', ')}
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'KILLING_FLOOR' && state.gameType === 'trivia-death' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {pd.isOnFloor ? (
              <>
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.3rem', color: 'var(--party-red)', textAlign: 'center', marginBottom: '0.5rem' }}>THE KILLING FLOOR</div>
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.1rem', color: '#fca5a5', marginBottom: '1.5rem', textAlign: 'center' }}>{pd.miniGameName}</div>
                {pd.miniGame === 'spin' && <div style={{ fontSize: '5rem', marginBottom: '1rem', animation: 'spin 2s linear infinite' }}>🎡</div>}
                {pd.miniGame === 'math' && (
                  <div style={{ width: '100%' }}>
                    <div className="host-kf-math" style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{pd.mathQuestion} = ?</div>
                    <div className="player-numpad">
                      {[1,2,3,4,5,6,7,8,9,0].map(n => <button key={n} onClick={() => setKfAnswer(kfAnswer + n)} className="player-numpad-btn">{n}</button>)}
                      <button className="party-btn party-btn-outline" onClick={() => setKfAnswer('')}>CLR</button>
                      <button className="party-btn party-btn-primary" disabled={voted || !kfAnswer} onClick={() => submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer })}>GO</button>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '2rem', fontFamily: 'monospace', marginTop: '1rem' }}>{kfAnswer || '_'}</div>
                  </div>
                )}
                {pd.miniGame === 'password' && (
                  <div style={{ width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--party-text-muted)', fontStyle: 'italic' }}>Choose a door... one leads to safety.</div>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} disabled={voted} className="player-numpad-btn" style={{ width: '64px', height: '64px', fontSize: '1.75rem' }} onClick={() => submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: n })}>🚪</button>
                      ))}
                    </div>
                  </div>
                )}
                {pd.miniGame === 'scramble' && (
                  <div style={{ width: '100%' }}>
                    <div className="host-kf-scramble" style={{ fontSize: '2.5rem', textAlign: 'center' }}>{pd.scrambled}</div>
                    <div style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--party-text-muted)', fontSize: '0.9rem' }}>Unscramble this word</div>
                    <div className="player-answer-row">
                      <input type="text" className="party-input" value={kfAnswer} onChange={e => setKfAnswer(e.target.value.toUpperCase())} placeholder="TYPE WORD..." maxLength={10} style={{ textTransform: 'uppercase', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.2em' }} />
                      <button disabled={voted || !kfAnswer} className="party-btn party-btn-primary" onClick={() => submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer.toUpperCase() })}>GO</button>
                    </div>
                  </div>
                )}
                {pd.miniGame === 'hotpotato' && (
                  <div style={{ textAlign: 'center', width: '100%' }}>
                    {pd.isHolder ? (
                      <button className="party-btn party-btn-primary" style={{ fontSize: '2rem', padding: '2rem 3rem', background: 'var(--party-red)', borderColor: 'var(--party-red)' }} onClick={() => sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER' })}>
                        🎃 PASS!
                      </button>
                    ) : (
                      <div className="player-waiting"><div style={{ fontSize: '3rem' }}>😰</div><div>Waiting for pass...</div></div>
                    )}
                  </div>
                )}
                {pd.miniGame === 'reaction' && (
                  <div style={{ textAlign: 'center', width: '100%' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--party-text-muted)' }}>Get Ready...</div>
                    {!voted ? (
                      <button className="party-btn party-btn-primary" style={{ fontSize: '2rem', padding: '2rem 3rem' }} onClick={() => submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER' })}>⚡ TAP!</button>
                    ) : (
                      <div className="player-waiting"><div className="player-waiting-title">Tapped!</div></div>
                    )}
                  </div>
                )}
                {pd.miniGame === 'memory' && (
                  <div style={{ textAlign: 'center', width: '100%' }}>
                    {hd.grid && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: '0.4rem', justifyContent: 'center', marginBottom: '1rem' }}>
                        {hd.grid.map((sym: string, i: number) => (
                          <div key={i} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--party-border)', borderRadius: '8px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>{sym}</div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginBottom: '1rem', color: 'var(--party-text-muted)', fontSize: '0.9rem' }}>Type the FIRST symbol you saw</div>
                    <div className="player-answer-row">
                      <input type="text" className="party-input" value={kfAnswer} onChange={e => setKfAnswer(e.target.value)} placeholder="e.g. 🦇" maxLength={2} style={{ textAlign: 'center', fontSize: '2rem' }} />
                      <button disabled={voted || !kfAnswer} className="party-btn party-btn-primary" onClick={() => submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer })}>GO</button>
                    </div>
                  </div>
                )}
                {pd.miniGame === 'auction' && (
                  <div style={{ width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--party-yellow)', fontWeight: 900, fontSize: '1.1rem' }}>💰 Bid to Survive</div>
                    <div style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--party-text-muted)', fontSize: '0.85rem' }}>Lowest bidder dies. All bids are spent.</div>
                    <div style={{ textAlign: 'center', marginBottom: '1rem', fontWeight: 900 }}>Your cash: ${pd.maxBid}</div>
                    <div className="player-numpad">
                      {[1,2,3,4,5,6,7,8,9,0].map(n => <button key={n} onClick={() => setKfAnswer(kfAnswer + n)} className="player-numpad-btn">{n}</button>)}
                      <button className="player-numpad-btn" onClick={() => setKfAnswer('')} style={{ fontSize: '0.9rem' }}>CLR</button>
                      <button className="player-numpad-btn" style={{ background: 'var(--party-yellow)', borderColor: 'var(--party-yellow)', color: '#000' }}
                        onClick={() => { const bid = Math.min(parseInt(kfAnswer)||0, pd.maxBid); submitOnce({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: bid }); }}>BID</button>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '2rem', fontFamily: 'monospace', marginTop: '0.75rem', color: 'var(--party-yellow)' }}>${kfAnswer || '0'}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="player-waiting">
                <div style={{ fontSize: '3rem' }}>💀</div>
                <div className="player-waiting-title">You Are Safe!</div>
                <div className="player-waiting-sub">{hd.miniGameName || 'The Killing Floor'}: {hd.killingFloorPlayers?.map((pid: string) => state.players[pid]?.name).join(', ')}</div>
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'KILLING_FLOOR_RESULTS' && state.gameType === 'trivia-death' && (
          <div className="player-waiting" style={{ gap: '0.75rem' }}>
            {pd.isOnFloor ? (
              <>
                <div style={{ fontSize: '3.5rem' }}>{pd.isDead ? '💀' : '🎉'}</div>
                <div className="player-waiting-title" style={{ color: pd.isDead ? 'var(--party-red)' : 'var(--party-green)' }}>
                  {pd.isDead ? 'You have been slain...' : 'You survived!'}
                </div>
              </>
            ) : (
              <div className="player-waiting-title">Killing Floor Results</div>
            )}
            {hd.killingFloorPlayers && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                {hd.killingFloorPlayers.map((pid: string) => {
                  const dead = hd.dead?.includes(pid);
                  return (
                    <span key={pid} style={{ padding: '0.35rem 0.85rem', borderRadius: '999px', fontWeight: 800, border: `2px solid ${dead ? 'var(--party-red)' : 'var(--party-green)'}`, color: dead ? 'var(--party-red)' : 'var(--party-green)' }}>
                      {dead ? '👻' : '✓'} {state.players[pid]?.name}: {dead ? 'SLAIN' : 'SURVIVED'}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== BRACKET BATTLES ===== */}
        {pd?.phase === 'PROMPTING' && state.gameType === 'bracket-battles' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1rem', color: 'var(--party-cyan)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>🏆 Bracket Battles</div>
            <div className="player-prompt-box">"{pd.prompt}"</div>
            {voted ? <div className="player-waiting"><div className="player-waiting-title">Submitted!</div><div className="player-waiting-sub">Wait for the bracket...</div></div> : (
              <form style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} onSubmit={e => { e.preventDefault(); if (inputValue.trim()) submitOnce({ type: 'SUBMIT_ANSWER', answer: inputValue.trim() }); }}>
                <input type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} className="party-input" placeholder="Type your answer..." maxLength={40} autoFocus enterKeyHint="send"
                  style={{ textAlign: 'center', fontSize: '1.1rem', padding: '1rem' }} />
                <button type="submit" disabled={!inputValue.trim()} className="party-btn party-btn-primary"
                  style={{ padding: '1rem', fontSize: '1.1rem' }}>SUBMIT</button>
                <button type="button" className="party-safety-btn" onClick={() => setInputValue(safetyQuip())}>🛟 Safety answer</button>
              </form>
            )}
          </div>
        )}
        {pd?.phase === 'PREDICTION' && state.gameType === 'bracket-battles' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '1rem', color: 'var(--party-cyan)', marginBottom: '0.5rem' }}>🏆 Predict the Champion</div>
            <div style={{ textAlign: 'center', color: 'var(--party-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Who will win the whole bracket?</div>
            {voted ? <div className="player-waiting"><div className="player-waiting-title">Predicted!</div></div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
                {pd.entries?.map((e: any) => (
                  <button key={e.id} className="player-vote-btn" onClick={() => submitOnce({ type: 'SUBMIT_PREDICTION', predictionId: e.id })}>{e.answer}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'MATCHUP' && state.gameType === 'bracket-battles' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '1rem', color: 'var(--party-cyan)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>⚔️ Vote!</div>
            {pd.prompt && <div className="player-prompt-text" style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.1rem' }}>{pd.prompt}</div>}
            {voted ? <div className="player-waiting"><div className="player-waiting-title">Voted!</div></div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
                {pd.answers?.map((a: any) => (
                  <button key={a.id} className="player-vote-btn" onClick={() => submitOnce({ type: 'SUBMIT_VOTE', voteId: a.id })}>{a.answer}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'TIEBREAKER' && state.gameType === 'bracket-battles' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, color: 'var(--party-red)', marginBottom: '1rem', fontSize: '1.2rem' }}>TIE BREAKER!</div>
            <button className="player-mash-btn" onClick={() => sendAction({ type: 'SUBMIT_TIEBREAKER' })}>MASH!</button>
          </div>
        )}
        {pd?.phase === 'MATCH_RESULT' && state.gameType === 'bracket-battles' && (
          <div className="player-waiting" style={{ gap: '0.75rem' }}>
            <div style={{ fontSize: '2.5rem' }}>🏆</div>
            <div className="player-waiting-title">Matchup Winner!</div>
            {hd.winner && (
              <div className="party-card" style={{ width: '100%', padding: '1.25rem', textAlign: 'center', border: '2px solid var(--party-green)' }}>
                <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--party-green)' }}>"{hd.winner.answer}"</div>
                {hd.votes && <div style={{ fontSize: '0.9rem', color: 'var(--party-text-muted)', marginTop: '0.35rem' }}>{hd.votes[hd.winner.id] || 0} votes</div>}
                {!hd.winner.isBot && state.players[hd.winner.id] && (
                  <div style={{ marginTop: '0.5rem', fontWeight: 800, color: state.players[hd.winner.id]?.avatarColor }}>
                    By {state.players[hd.winner.id]?.avatar} {state.players[hd.winner.id]?.name}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== READY SET BET ===== */}
        {pd?.phase === 'RACING' && state.gameType === 'ready-set-bet' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--party-radius)', padding: '0.6rem 0.9rem' }}>
              <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.1rem', color: 'var(--party-green)' }}>🏆 ${pd.money}</div>
              {hd.lastRoll !== undefined && (
                <div style={{ fontWeight: 900, fontSize: '1rem', color: 'var(--party-yellow)' }}>🎲 Rolled: {hd.lastRoll}</div>
              )}
              <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1rem', color: 'var(--party-yellow)' }}>🪙 {5 - (pd.bets?.length || 0)} left</div>
            </div>

            {/* Compact Live Horse Track on Phone */}
            {hd.positions && (
              <div style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid var(--party-border)', borderRadius: '12px', padding: '0.5rem 0.65rem', marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
                {hd.commentary && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--party-green)', fontStyle: 'italic', textAlign: 'center', marginBottom: '0.2rem' }}>
                    🎤 {hd.commentary}
                  </div>
                )}
                {['2/3','4','5','6','7','8','9','10','11/12'].map((horse) => {
                  const pos = hd.positions?.[horse] || 0;
                  const trackLen = hd.trackLength || 15;
                  const pctHorse = Math.min((pos / trackLen) * 100, 100);
                  return (
                    <div key={horse} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem' }}>
                      <span style={{ width: '32px', fontWeight: 900, textAlign: 'right', color: 'var(--party-yellow)' }}>{horse}</span>
                      <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ width: `${pctHorse}%`, height: '100%', background: 'var(--party-green)', transition: 'width 0.3s ease' }} />
                      </div>
                      <span style={{ width: '28px', fontFamily: 'monospace', color: 'var(--party-text-muted)' }}>{pos}/{trackLen}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {pd.propBet && (
              <div className="player-prop-bet-card">
                <div className="player-prop-bet-label">💰 Prop Bet</div>
                <div className="player-prop-bet-desc">{pd.propBet.desc}</div>
                <div className="player-prop-btns">
                  <button className={`player-prop-btn ${pd.propBetChoice === true ? 'selected-yes' : ''}`} onClick={() => sendAction({ type: 'SUBMIT_PROP_BET', choice: true })} disabled={pd.propBetAnswered}>YES</button>
                  <button className={`player-prop-btn ${pd.propBetChoice === false ? 'selected-no' : ''}`} onClick={() => sendAction({ type: 'SUBMIT_PROP_BET', choice: false })} disabled={pd.propBetAnswered}>NO</button>
                </div>
              </div>
            )}
            {pd.bettingClosed ? (
              <div className="player-waiting">
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, color: 'var(--party-red)', fontSize: '1.4rem' }}>BETTING CLOSED</div>
                <div style={{ marginTop: '0.35rem', color: 'var(--party-text-muted)' }}>Watch the horses sprint to the finish above!</div>
              </div>
            ) : (pd.bets?.length || 0) >= 5 ? (
              <div className="player-waiting">
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '1.25rem' }}>All Tokens Placed!</div>
                <div style={{ color: 'var(--party-text-muted)', marginTop: '0.35rem' }}>Cheer your horses home!</div>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '1rem' }}>
                <div className="player-bet-grid">
                  {['2/3','4','5','6','7','8','9','10','11/12'].map(horse => {
                    const winPlaced   = pd.bets?.some((b: any) => b.horse === horse && b.type === 'win');
                    const placePlaced = pd.bets?.some((b: any) => b.horse === horse && b.type === 'place');
                    const showPlaced  = pd.bets?.some((b: any) => b.horse === horse && b.type === 'show');
                    return (
                      <div key={horse} className={`player-bet-cell ${winPlaced || placePlaced || showPlaced ? 'placed' : ''}`}>
                        <div className="player-bet-cell-label">{horse}</div>
                        <button onClick={() => sendAction({ type: 'PLACE_BET', horse, betType: 'win' })} disabled={!!winPlaced} className={`player-bet-btn bet-win ${winPlaced ? 'bet-placed' : ''}`}>WIN</button>
                        <button onClick={() => sendAction({ type: 'PLACE_BET', horse, betType: 'place' })} disabled={!!placePlaced} className={`player-bet-btn bet-place ${placePlaced ? 'bet-placed' : ''}`}>PLACE</button>
                        <button onClick={() => sendAction({ type: 'PLACE_BET', horse, betType: 'show' })} disabled={!!showPlaced} className={`player-bet-btn bet-show ${showPlaced ? 'bet-placed' : ''}`}>SHOW</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'RACE_RESULTS' && state.gameType === 'ready-set-bet' && (
          <div className="player-waiting" style={{ gap: '0.75rem' }}>
            {hd.finishers && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {hd.finishers.map((f: string, i: number) => (
                  <span key={f} style={{ background: 'rgba(250,204,21,0.12)', border: '2px solid var(--party-yellow)', color: 'var(--party-yellow)', borderRadius: '10px', padding: '0.35rem 0.75rem', fontWeight: 900 }}>
                    {['🥇 #1', '🥈 #2', '🥉 #3'][i] || `#${i + 1}`} Horse {f}
                  </span>
                ))}
              </div>
            )}
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '2.5rem', color: pd.net > 0 ? 'var(--party-green)' : pd.net < 0 ? 'var(--party-red)' : '#fff' }}>
              {pd.net > 0 ? `+$${pd.net}` : pd.net < 0 ? `-$${Math.abs(pd.net)}` : 'EVEN'}
            </div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.4rem' }}>Balance: ${pd.money}</div>
          </div>
        )}

        {/* ===== SPYFALL ===== */}
        {state.gameType === 'spyfall' && pd?.phase === 'DISCUSSION' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              className="party-card"
              style={{
                padding: '1.25rem',
                textAlign: 'center',
                border: `2px solid ${hideSpyRole ? 'var(--party-border)' : pd.isSpy ? 'var(--party-red)' : 'var(--party-green)'}`,
                background: hideSpyRole ? 'rgba(255,255,255,0.03)' : pd.isSpy ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, color: 'var(--party-text-muted)' }}>
                  Secret Dossier
                </span>
                <button
                  type="button"
                  onClick={() => setHideSpyRole(!hideSpyRole)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--party-border)', borderRadius: '8px', color: 'var(--party-text)', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                >
                  {hideSpyRole ? '👁️ Show Role' : '🙈 Hide Role'}
                </button>
              </div>
              {hideSpyRole ? (
                <div style={{ padding: '1rem 0', color: 'var(--party-text-muted)', fontWeight: 800 }}>
                  🔒 Role hidden for tabletop privacy — tap "Show Role" to peek
                </div>
              ) : pd.isSpy ? (
                <>
                  <div style={{ fontSize: '2.2rem' }}>🕵️‍♀️</div>
                  <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.5rem', fontWeight: 900, color: 'var(--party-red)' }}>
                    YOU ARE THE SPY!
                  </div>
                  <p style={{ fontSize: '0.88rem', color: 'var(--party-text-muted)', marginTop: '0.35rem' }}>
                    Blend in! Listen carefully to everyone's questions and figure out the secret location.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '2.2rem' }}>{pd.locationEmoji}</div>
                  <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.4rem', fontWeight: 900, color: 'var(--party-green)' }}>
                    {pd.location}
                  </div>
                  <div style={{ marginTop: '0.35rem', fontWeight: 800, color: 'var(--party-yellow)', fontSize: '1rem' }}>
                    🎭 Role: {pd.role}
                  </div>
                </>
              )}
            </div>

            {pd.firstAskerName && (
              <div style={{ textAlign: 'center', fontSize: '0.88rem', color: 'var(--party-cyan)', fontWeight: 800 }}>
                💬 {pd.firstAskerName} asks the first question!{pd.samplePrompt ? ` (e.g. "${pd.samplePrompt}")` : ''}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  if (!confirmCallVote) { setConfirmCallVote(true); return; }
                  sendAction({ type: 'CALL_VOTE' });
                }}
                className="party-btn"
                style={{ flex: 1, background: confirmCallVote ? 'var(--party-red)' : 'rgba(239, 68, 68, 0.2)', border: '2px solid var(--party-red)', color: '#fff', fontWeight: 900 }}
              >
                {confirmCallVote ? '🚨 Tap again to stop & vote' : '🚨 Call a Vote'}
              </button>
              {pd.isSpy && !hideSpyRole && (
                <button
                  type="button"
                  onClick={() => setShowSpyLocations(!showSpyLocations)}
                  className="party-btn"
                  style={{ flex: 1, background: 'rgba(250, 204, 21, 0.2)', border: '2px solid var(--party-yellow)', color: 'var(--party-yellow)', fontWeight: 900 }}
                >
                  🎯 Guess Location
                </button>
              )}
            </div>

            {pd.isSpy && showSpyLocations && !hideSpyRole && (
              <div className="party-card" style={{ padding: '1rem', border: '2px solid var(--party-yellow)' }}>
                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--party-yellow)', marginBottom: '0.6rem', textAlign: 'center' }}>
                  🎯 Pick the location, then confirm. Right = you win the round, wrong = you lose it!
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                  {(pd.locations || hd.locations)?.map((loc: any) => (
                    <button
                      key={loc.name}
                      type="button"
                      onClick={() => setSpyGuessPick(loc.name)}
                      style={{ background: spyGuessPick === loc.name ? 'rgba(250, 204, 21, 0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${spyGuessPick === loc.name ? 'var(--party-yellow)' : 'var(--party-border)'}`, borderRadius: '10px', padding: '0.5rem', color: '#fff', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer', textAlign: 'left' }}
                    >
                      {loc.emoji} {loc.name}
                    </button>
                  ))}
                </div>
                {spyGuessPick && (
                  <button
                    type="button"
                    onClick={() => submitOnce({ type: 'SPY_GUESS_LOCATION', location: spyGuessPick })}
                    disabled={voted}
                    className="party-btn party-btn-primary"
                    style={{ width: '100%', marginTop: '0.75rem' }}
                  >
                    Final answer: {spyGuessPick}
                  </button>
                )}
              </div>
            )}

            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--party-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem', textAlign: 'center' }}>
                All Possible Locations ({(pd.locations || hd.locations)?.length || 16})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                {(pd.locations || hd.locations)?.map((loc: any) => (
                  <div key={loc.name} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--party-border)', borderRadius: '8px', padding: '0.4rem 0.6rem', fontSize: '0.8rem', fontWeight: 700 }}>
                    {loc.emoji} {loc.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {state.gameType === 'spyfall' && pd?.phase === 'VOTING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-red)', fontSize: '1.2rem' }}>
              {hd.message || '🚨 Who is the Spy?'}
            </div>
            {voted ? (
              <div className="player-waiting"><div className="player-waiting-title">Vote Locked In!</div></div>
            ) : (
              <div className="player-faker-vote-grid">
                {pd.activePlayers?.filter((pid: string) => pid !== me.id).map((pid: string) => (
                  <button key={pid} className="player-faker-vote-btn" onClick={() => submitOnce({ type: 'SUBMIT_VOTE', votedFor: pid })}>
                    {state.players[pid]?.avatar} {state.players[pid]?.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {state.gameType === 'spyfall' && pd?.phase === 'RESULTS' && (
          <div className="player-result-screen" style={{ gap: '0.85rem' }}>
            <div style={{ fontSize: '2.8rem' }}>{pd.spyCaught ? '🎉' : '🕵️‍♀️'}</div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.35rem', textAlign: 'center', color: pd.spyCaught ? 'var(--party-green)' : 'var(--party-red)' }}>
              {pd.headline || hd.headline}
            </div>
            <div className="party-card" style={{ width: '100%', padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--party-text-muted)', fontWeight: 800 }}>The Spy Was</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--party-red)', marginTop: '0.25rem' }}>
                {state.players[hd.spyId]?.avatar} {pd.spyName || state.players[hd.spyId]?.name}
              </div>
            </div>
            <div className="party-card" style={{ width: '100%', padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--party-text-muted)', fontWeight: 800 }}>Secret Location</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--party-green)', marginTop: '0.25rem' }}>
                {pd.location || `${hd.locationEmoji || ''} ${hd.location || ''}`}
              </div>
            </div>
          </div>
        )}

        {/* ===== HERD MENTALITY ===== */}
        {state.gameType === 'herd-mentality' && pd?.phase === 'PROMPTING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              🐄 Think Like The Herd!
            </div>
            {(pd.hasPinkCow || hd.pinkCowHolder === me.id) && (
              <div style={{ background: 'rgba(236, 72, 153, 0.15)', border: '2px solid #ec4899', borderRadius: '12px', padding: '0.5rem 0.85rem', textAlign: 'center', color: '#f472b6', fontWeight: 900, fontSize: '0.85rem' }}>
                🐄🍓 You are holding the Pink Cow! Match the herd to pass it away!
              </div>
            )}
            <div className="player-prompt-box">"{pd.prompt}"</div>
            {pd.submitted || voted ? (
              <div className="player-waiting">
                <div className="player-waiting-title">Moo! Locked In 🐄</div>
                <div className="player-waiting-sub">"{pd.submitted || inputValue}"</div>
              </div>
            ) : (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim()) submitOnce({ type: 'SUBMIT_ANSWER', answer: inputValue.trim() });
                }}
              >
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="party-input"
                  placeholder="What will everyone say?"
                  maxLength={50}
                  autoFocus
                  enterKeyHint="send"
                  style={{ textAlign: 'center', fontSize: '1.15rem', padding: '1rem' }}
                />
                <button type="submit" disabled={!inputValue.trim()} className="party-btn party-btn-primary" style={{ padding: '1rem', fontSize: '1.1rem' }}>
                  Join the Herd 🐄
                </button>
              </form>
            )}
          </div>
        )}
        {state.gameType === 'herd-mentality' && pd?.phase === 'ROUND_RESULTS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.05rem', color: pd.gotCow ? '#f472b6' : pd.inMajority ? 'var(--party-green)' : 'var(--party-yellow)' }}>
              {pd.message}
            </div>
            {hd.prompt && <div className="player-prompt-box" style={{ marginBottom: '0.25rem' }}>"{hd.prompt}"</div>}
            {hd.groups?.map((g: any, idx: number) => (
              <div
                key={idx}
                className="party-card"
                style={{
                  padding: '0.85rem 1rem',
                  border: `2px solid ${g.isMajority ? 'var(--party-green)' : g.isPinkCow ? '#ec4899' : 'var(--party-border)'}`,
                  background: g.isMajority ? 'rgba(34, 197, 94, 0.12)' : g.isPinkCow ? 'rgba(236, 72, 153, 0.12)' : undefined,
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem 0.6rem' }}>
                  <span style={{ fontWeight: 900, fontSize: '1.15rem', minWidth: 0, overflowWrap: 'anywhere' }}>"{g.label}"</span>
                  <span style={{ fontWeight: 900, whiteSpace: 'nowrap', marginLeft: 'auto', color: g.isMajority ? 'var(--party-green)' : g.isPinkCow ? '#f472b6' : 'var(--party-text-muted)' }}>
                    {g.playerIds?.length || 0} {g.isMajority ? '✅ HERD (+600)' : g.isPinkCow ? '🐄🍓 PINK COW!' : ''}
                  </span>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--party-text-muted)', marginTop: '0.3rem', fontWeight: 700 }}>
                  {g.playerIds?.map((pid: string) => `${state.players[pid]?.avatar || ''} ${state.players[pid]?.name || '?'}`).join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== WAVELENGTH ===== */}
        {state.gameType === 'wavelength' && pd?.phase === 'CLUE_GIVING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div className="party-card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '1.05rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--party-cyan)' }}>⬅️ {pd.spectrum?.[0]}</span>
                <span style={{ color: 'var(--party-orange, #f97316)' }}>{pd.spectrum?.[1]} ➡️</span>
              </div>
              <div style={{ position: 'relative', height: '24px', borderRadius: '999px', background: 'linear-gradient(90deg, #06b6d4, #a855f7, #f97316)', overflow: 'hidden' }}>
                {pd.isPsychic && pd.target !== null && pd.target !== undefined && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `calc(${pd.target}% - 6px)`,
                      width: '12px',
                      background: '#fff',
                      border: '2px solid #000',
                      borderRadius: '4px',
                      boxShadow: '0 0 12px #fff',
                    }}
                  />
                )}
              </div>
              {pd.isPsychic && pd.target !== null && pd.target !== undefined && (
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '1.1rem' }}>
                  🎯 Secret Target: {pd.target}%
                </div>
              )}
            </div>

            {pd.isPsychic ? (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim()) submitOnce({ type: 'SUBMIT_CLUE', clue: inputValue.trim() });
                }}
              >
                <div style={{ textAlign: 'center', fontSize: '0.9rem', color: 'var(--party-text-muted)', fontWeight: 700 }}>
                  🔮 You are the Psychic! Give a clue that sits at <strong>{pd.target}%</strong> on this spectrum:
                </div>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="party-input"
                  placeholder="Type your clue…"
                  maxLength={60}
                  autoFocus
                  enterKeyHint="send"
                  style={{ textAlign: 'center', fontSize: '1.15rem', padding: '1rem' }}
                />
                <button type="submit" disabled={!inputValue.trim()} className="party-btn party-btn-primary" style={{ padding: '1rem', fontSize: '1.1rem' }}>
                  Broadcast Clue 📡
                </button>
              </form>
            ) : (
              <div className="player-waiting">
                <div style={{ fontSize: '3rem' }}>🔮</div>
                <div className="player-waiting-title">
                  {pd.psychicName || state.players[hd.psychicId]?.name} is the Psychic
                </div>
                <p className="player-waiting-sub">Waiting for their clue on the spectrum…</p>
              </div>
            )}
          </div>
        )}
        {state.gameType === 'wavelength' && pd?.phase === 'DIALING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 800, color: 'var(--party-text-muted)', textTransform: 'uppercase' }}>
              🔮 {pd.psychicName || state.players[hd.psychicId]?.name}'s Clue:
            </div>
            <div className="player-prompt-box" style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>
              "{pd.clue}"
            </div>

            <div className="party-card" style={{ padding: '1.1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '1rem', marginBottom: '0.6rem' }}>
                <span style={{ color: 'var(--party-cyan)' }}>0% · {pd.spectrum?.[0]}</span>
                <span style={{ color: 'var(--party-orange, #f97316)' }}>{pd.spectrum?.[1]} · 100%</span>
              </div>

              <div style={{ position: 'relative', height: '28px', borderRadius: '999px', background: 'linear-gradient(90deg, #06b6d4, #a855f7, #f97316)', marginBottom: '0.75rem' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    bottom: '-4px',
                    left: `calc(${(pd.isPsychic ? pd.target : (pd.lockedDial ?? dialValue))}% - 5px)`,
                    width: '10px',
                    background: '#fff',
                    border: '2px solid #000',
                    borderRadius: '4px',
                  }}
                />
              </div>

              {!pd.isPsychic && pd.lockedDial === null && !voted && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={dialValue}
                    onChange={(e) => setDialValue(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--party-cyan)', height: '2rem', cursor: 'pointer' }}
                  />
                  <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 900, fontSize: '1.5rem', color: 'var(--party-yellow)', marginTop: '0.25rem' }}>
                    {dialValue}%
                  </div>
                </>
              )}
            </div>

            {pd.isPsychic ? (
              <div className="player-waiting">
                <div className="player-waiting-title">Target: {pd.target}%</div>
                <p className="player-waiting-sub">Players are dialing in their guesses…</p>
              </div>
            ) : pd.lockedDial !== null || voted ? (
              <div className="player-waiting">
                <div className="player-waiting-title">Locked In at {pd.lockedDial ?? dialValue}%! 📡</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => submitOnce({ type: 'SUBMIT_DIAL', value: dialValue })}
                className="party-btn party-btn-primary"
                style={{ padding: '1rem', fontSize: '1.15rem' }}
              >
                Lock In {dialValue}% 📡
              </button>
            )}
          </div>
        )}
        {state.gameType === 'wavelength' && pd?.phase === 'ROUND_RESULTS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.1rem', color: 'var(--party-yellow)' }}>
              🎯 Target: {pd.target}% — Clue: "{pd.clue}"
            </div>
            {pd.message && (
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.95rem', color: (pd.myResult?.points || pd.psychicBonus) ? 'var(--party-green)' : 'var(--party-text-muted)' }}>
                {pd.message}
              </div>
            )}
            <div className="party-card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--party-cyan)' }}>{pd.spectrum?.[0]}</span>
                <span style={{ color: 'var(--party-orange, #f97316)' }}>{pd.spectrum?.[1]}</span>
              </div>
              <div style={{ position: 'relative', height: '28px', borderRadius: '999px', background: 'linear-gradient(90deg, #06b6d4, #a855f7, #f97316)' }}>
                <div
                  title={`Target: ${pd.target}%`}
                  style={{
                    position: 'absolute',
                    top: '-5px',
                    bottom: '-5px',
                    left: `calc(${pd.target}% - 6px)`,
                    width: '12px',
                    background: 'var(--party-green)',
                    border: '2px solid #fff',
                    borderRadius: '4px',
                    zIndex: 3,
                  }}
                />
                {Object.entries(hd.results || {}).map(([pid, r]: [string, any]) => (
                  <div
                    key={pid}
                    title={`${state.players[pid]?.name}: ${r.value}%`}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      bottom: '2px',
                      left: `calc(${r.value}% - 4px)`,
                      width: '8px',
                      background: state.players[pid]?.avatarColor || '#fff',
                      border: '1px solid #000',
                      borderRadius: '999px',
                      zIndex: 2,
                    }}
                  />
                ))}
              </div>
            </div>
            {Object.entries(hd.results || {}).map(([pid, r]: [string, any]) => (
              <div key={pid} className="party-card" style={{ padding: '0.65rem 0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 800, color: state.players[pid]?.avatarColor, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {state.players[pid]?.avatar} {state.players[pid]?.name}
                  </span>
                  <span style={{ fontWeight: 900, whiteSpace: 'nowrap', color: r.points > 0 ? 'var(--party-green)' : 'var(--party-text-muted)' }}>
                    +{r.points}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)', fontWeight: 700, marginTop: '0.15rem' }}>
                  {r.label} · guessed {r.value}% (off by {r.diff})
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== BLUFF CLASH ===== */}
        {state.gameType === 'bluff-clash' && pd?.phase === 'BLUFFING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
              🤥 Write a Believable Lie!
            </div>
            <div className="player-prompt-box">{pd.prompt}</div>
            {pd.truthWarning && (
              <div style={{ background: 'rgba(250, 204, 21, 0.15)', border: '2px solid var(--party-yellow)', borderRadius: '12px', padding: '0.6rem', textAlign: 'center', color: 'var(--party-yellow)', fontWeight: 800, fontSize: '0.85rem' }}>
                {pd.truthWarning}
              </div>
            )}
            {pd.submitted ? (
              <div className="player-waiting">
                <div className="player-waiting-title">Lie Planted! 🤥</div>
                <div className="player-waiting-sub">"{pd.submitted}"</div>
              </div>
            ) : (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim()) sendAction({ type: 'SUBMIT_BLUFF', bluff: inputValue.trim() });
                }}
              >
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="party-input"
                  placeholder="Type a convincing fake answer…"
                  maxLength={60}
                  autoFocus
                  enterKeyHint="send"
                  style={{ textAlign: 'center', fontSize: '1.1rem', padding: '1rem' }}
                />
                <button type="submit" disabled={!inputValue.trim()} className="party-btn party-btn-primary" style={{ padding: '1rem', fontSize: '1.1rem' }}>
                  Submit Lie 🤥
                </button>
                <button type="button" className="party-safety-btn" onClick={() => setInputValue(safetyQuip())}>
                  🛟 Safety bluff
                </button>
              </form>
            )}
          </div>
        )}
        {state.gameType === 'bluff-clash' && pd?.phase === 'VOTING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-cyan)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
              🔍 Find the REAL Truth!
            </div>
            <div className="player-prompt-box" style={{ fontSize: '1rem' }}>{pd.prompt}</div>
            {voted ? (
              <div className="player-waiting"><div className="player-waiting-title">Choice Locked In!</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {pd.choices?.map((c: any) => (
                  <button
                    key={c.id}
                    className="player-vote-btn"
                    onClick={() => submitOnce({ type: 'SUBMIT_VOTE', choiceId: c.id })}
                  >
                    {c.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {state.gameType === 'bluff-clash' && pd?.phase === 'ROUND_RESULTS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pd.message && (
              <div style={{ textAlign: 'center', fontWeight: 900, color: pd.pickedTruth ? 'var(--party-green)' : 'var(--party-yellow)', fontSize: '1rem' }}>
                {pd.message}
              </div>
            )}
            {hd.prompt && <div className="player-prompt-box" style={{ fontSize: '0.95rem', marginBottom: '0.2rem' }}>{hd.prompt}</div>}
            {hd.revealed?.map((r: any) => (
              <div
                key={r.id}
                className="party-card"
                style={{
                  padding: '0.85rem 1rem',
                  border: `2px solid ${r.isTruth ? 'var(--party-green)' : 'var(--party-border)'}`,
                  background: r.isTruth ? 'rgba(34, 197, 94, 0.14)' : undefined,
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.25rem 0.6rem' }}>
                  <span style={{ fontWeight: 900, fontSize: '1.1rem', minWidth: 0, overflowWrap: 'anywhere' }}>"{r.text}"</span>
                  <span style={{ fontWeight: 900, fontSize: '0.85rem', marginLeft: 'auto', color: r.isTruth ? 'var(--party-green)' : 'var(--party-yellow)' }}>
                    {r.isTruth
                      ? '✅ THE TRUTH (+750)'
                      : r.authorIds.length
                      ? `🤥 ${r.authorIds.map((id: string) => state.players[id]?.name || '?').join(' & ')}'s Lie`
                      : '🏠 House Lie'}
                  </span>
                </div>
                {r.voterIds?.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)', marginTop: '0.3rem', fontWeight: 700 }}>
                    {r.isTruth ? '🎯 Spotted by: ' : r.authorIds.length ? '🎣 Fooled (+400 to the liar each): ' : '🎣 Fooled: '}
                    {r.voterIds.map((vid: string) => state.players[vid]?.name || '?').join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ===== EMOJI TELEPHONE ===== */}
        {state.gameType === 'emoji-telephone' && pd?.phase === 'TRANSLATE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
              🔗 Translate this Phrase into Emojis ONLY!
            </div>
            <div className="player-prompt-box">"{pd.prompt}"</div>
            {pd.submitted || voted ? (
              <div className="player-waiting">
                <div style={{ fontSize: '2.5rem' }}>{pd.submitted || inputValue}</div>
                <div className="player-waiting-title">Emojis Sent!</div>
              </div>
            ) : (
              <>
                <div style={{ background: 'rgba(255,255,255,0.05)', border: '2px solid var(--party-border)', borderRadius: '14px', padding: '0.75rem', minHeight: '3.2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(capGraphemes(e.target.value.replace(/[a-zA-Z0-9]/g, ''), 16))}
                    placeholder="Tap or type emojis…"
                    aria-label="Your emoji clue"
                    style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.6rem', width: '100%', minWidth: 0, outline: 'none' }}
                  />
                  {inputValue && (
                    <button type="button" onClick={() => setInputValue('')} className="party-btn party-btn-outline party-btn-inline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: '0.25rem', maxHeight: '190px', overflowY: 'auto', overflowX: 'hidden', padding: '0.4rem', background: 'rgba(0,0,0,0.25)', borderRadius: '12px' }}>
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setInputValue((prev) => capGraphemes(prev + em, 16))}
                      aria-label={`Add ${em}`}
                      style={{ fontSize: '1.3rem', lineHeight: 1.2, background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', padding: '0.3rem 0', cursor: 'pointer', minWidth: 0 }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!inputValue.trim()}
                  onClick={() => submitOnce({ type: 'SUBMIT_EMOJIS', emojis: inputValue.trim() })}
                  className="party-btn party-btn-primary"
                  style={{ padding: '0.9rem', fontSize: '1.1rem' }}
                >
                  Send Emojis 🔗
                </button>
              </>
            )}
          </div>
        )}
        {state.gameType === 'emoji-telephone' && pd?.phase === 'GUESS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-cyan)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
              🕵️ Decode {pd.translatorName ? `${pd.translatorName}'s ` : ''}Emojis back into English!
            </div>
            <div className="party-card" style={{ padding: '1.5rem', textAlign: 'center', fontSize: '2.8rem', letterSpacing: '0.1em' }}>
              {pd.emojis}
            </div>
            {pd.submitted || voted ? (
              <div className="player-waiting">
                <div className="player-waiting-title">Decoded!</div>
                <div className="player-waiting-sub">"{pd.submitted || inputValue}"</div>
              </div>
            ) : (
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim()) submitOnce({ type: 'SUBMIT_GUESS', guess: inputValue.trim() });
                }}
              >
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="party-input"
                  placeholder="What’s the phrase?"
                  maxLength={80}
                  autoFocus
                  enterKeyHint="send"
                  style={{ textAlign: 'center', fontSize: '1.1rem', padding: '1rem' }}
                />
                <button type="submit" disabled={!inputValue.trim()} className="party-btn party-btn-primary" style={{ padding: '1rem', fontSize: '1.1rem' }}>
                  Submit Guess 🔗
                </button>
              </form>
            )}
          </div>
        )}
        {state.gameType === 'emoji-telephone' && pd?.phase === 'SHOWCASE' && (pd.chain || hd.chain) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {(() => {
              const chain = pd.chain || hd.chain;
              return (
                <>
                  <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '0.9rem', textTransform: 'uppercase' }}>
                    🔗 Chain {pd.round || hd.round || 1} of {pd.totalRounds || hd.totalRounds}
                  </div>
                  <div className="party-card" style={{ padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>1. Original Prompt</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, marginTop: '0.2rem' }}>"{chain.originPrompt}"</div>
                  </div>
                  <div className="party-card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--party-cyan)', fontWeight: 800, textTransform: 'uppercase' }}>
                      2. Translated by {chain.translatorName}
                    </div>
                    <div style={{ fontSize: '2.4rem', marginTop: '0.35rem' }}>{chain.emojis}</div>
                  </div>
                  <div className="party-card" style={{ padding: '1rem', border: '2px solid var(--party-yellow)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--party-yellow)', fontWeight: 800, textTransform: 'uppercase' }}>
                      3. Decoded by {chain.guesserName}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, marginTop: '0.25rem' }}>"{chain.guess}"</div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
        {state.gameType === 'emoji-telephone' && pd?.phase === 'VOTING' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ textAlign: 'center', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '1.05rem' }}>
              🏆 Vote for the Funniest Chain!
            </div>
            {voted ? (
              <div className="player-waiting"><div className="player-waiting-title">Vote Submitted!</div></div>
            ) : (
              pd.chains?.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => submitOnce({ type: 'SUBMIT_VOTE', chainId: c.id })}
                  className="party-card"
                  style={{ padding: '0.9rem', textAlign: 'left', cursor: 'pointer', border: '2px solid var(--party-border)', color: '#fff' }}
                >
                  <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)' }}>"{c.originPrompt}"</div>
                  <div style={{ fontSize: '1.5rem', margin: '0.25rem 0' }}>{c.emojis}</div>
                  <div style={{ fontWeight: 900, color: 'var(--party-yellow)' }}>➡️ "{c.guess}"</div>
                </button>
              ))
            )}
          </div>
        )}

        {/* ===== FINAL RESULTS ===== */}
        {state.phase === 'FINAL_RESULTS' && (
          <div className="player-result-screen" style={{ gap: '0.75rem' }}>
            <div style={{ fontSize: '3.5rem' }}>🏆</div>
            <div className="player-waiting-title">Session Leaderboard</div>
            {myRank > 0 && (
              <p style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                {myRank === 1 ? 'You lead the session! 🥇' : `Session Rank: #${myRank} of ${standings.length}`}
              </p>
            )}

            {/* Compact Leaderboard for all phones */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.5rem 0' }}>
              {standings.map((p, idx) => {
                const delta = state.baseScores ? p.score - (state.baseScores[p.id] || 0) : null;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.55rem 0.9rem',
                      borderRadius: '12px',
                      background: p.id === me.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1.5px solid ${idx === 0 ? 'var(--party-yellow)' : 'var(--party-border)'}`,
                    }}
                  >
                    <span style={{ fontWeight: 800, color: p.avatarColor }}>
                      {['🥇', '🥈', '🥉'][idx] || `#${idx + 1}`} {p.avatar} {p.name}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '1rem' }}>
                      {p.score.toLocaleString()}
                      {delta !== null && delta !== p.score && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--party-green)', marginLeft: '0.35rem' }}>
                          ({delta >= 0 ? `+${delta}` : delta})
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {(state.awards || []).filter((a: any) => a.playerIds.includes(me.id)).map((a: any) => (
              <div key={a.title} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--party-border)', borderRadius: '12px', padding: '0.6rem 1rem', width: '100%', textAlign: 'center' }}>
                <div style={{ fontWeight: 900 }}>{a.emoji} {a.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--party-text-muted)' }}>{a.detail}</div>
              </div>
            ))}

            <button className="party-btn party-btn-outline" style={{ width: '100%' }} onClick={() => shareResultsCard({
              gameName: GAME_NAMES[state.gameType] || 'Party',
              roomCode: state.roomCode,
              standings: standings.map((p: any) => ({ name: p.name, score: p.score, color: p.avatarColor })),
              awards: (state.awards || []).map((a: any) => ({ emoji: a.emoji, title: a.title, detail: a.detail, names: a.playerIds.map((id: string) => state.players[id]?.name || '?') })),
            })}>📸 Share results</button>

            {hostId && (
              <div style={{ width: '100%', marginTop: '0.75rem', background: 'rgba(6, 182, 212, 0.08)', border: '2px solid rgba(6, 182, 212, 0.35)', borderRadius: '18px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--party-cyan)' }}>👑 VIP Next Match</div>
                <button
                  type="button"
                  onClick={() => sendHostAction({ type: 'PLAY_AGAIN' })}
                  className="party-btn party-btn-primary"
                  style={{ width: '100%' }}
                >
                  🔁 Play Again
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' }}>
                  {ALL_GAMES.filter((g) => g.id !== state.gameType).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => sendHostAction({ type: 'SWITCH_GAME', gameType: g.id })}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid var(--party-border)', borderRadius: '999px', padding: '0.3rem 0.7rem', color: '#fff', fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer' }}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                {standings.some((p) => p.score > 0) && (
                  <button
                    type="button"
                    onClick={() => sendHostAction({ type: 'RESET_SCORES' })}
                    className="party-btn party-btn-outline"
                    style={{ width: '100%', borderColor: 'rgba(250, 204, 21, 0.45)', color: 'var(--party-yellow)', fontSize: '0.9rem' }}
                  >
                    🔄 Reset Session Scores
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseRoomAsVip}
                  className="party-btn party-btn-outline"
                  style={{ width: '100%', borderColor: 'rgba(239,68,68,0.45)', color: 'var(--party-red)' }}
                >
                  🚪 Close Room &amp; Exit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <ReactionBar onReact={(emoji) => { sendAction({ type: 'SUBMIT_REACTION', emoji }); }} />
      {showRulesModal && (
        <HowToPlayModal
          initialGameType={state.gameType}
          onClose={() => setShowRulesModal(false)}
          onAction={hostId ? (g) => { if (g !== state.gameType) sendHostAction({ type: 'SWITCH_GAME', gameType: g }); } : undefined}
          actionLabel={hostId ? 'Switch to This Game 🎮' : undefined}
        />
      )}
    </div>
  );
}
