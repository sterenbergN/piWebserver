'use client';
import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

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

function QuitDialog({ onQuit, onCancel }: { onQuit: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: 'var(--party-surface)', border: '2px solid rgba(239,68,68,0.5)', borderRadius: '24px', padding: '2.5rem', maxWidth: '420px', width: '100%', textAlign: 'center', boxShadow: '0 0 60px rgba(239,68,68,0.3)' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚪</div>
        <h2 style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>End the game?</h2>
        <p style={{ color: 'var(--party-text-muted)', fontFamily: 'var(--party-font-body)', marginBottom: '1.75rem' }}>Everyone will be sent back to the lobby.</p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={onCancel} className="party-btn party-btn-outline" style={{ flex: 1 }}>Keep Playing</button>
          <button onClick={onQuit} className="party-btn" style={{ flex: 1, background: 'var(--party-red)', color: '#fff' }}>End Game</button>
        </div>
      </div>
    </div>
  );
}

function PostGameOptions({ gameType, onPlayAgain, onSwitch, onQuit }: {
  gameType: string; onPlayAgain: () => void; onSwitch: (g: string) => void; onQuit: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '420px', padding: '0.5rem 0' }}>
      <button onClick={onPlayAgain} className="party-btn party-btn-primary" style={{ fontSize: '1.3rem', padding: '1.2rem' }}>🔁 Play Again</button>
      {gameType !== 'quip-clash' && <button onClick={() => onSwitch('quip-clash')} className="party-btn party-btn-yellow" style={{ fontSize: '1.1rem' }}>Switch to ⚡ Quip Clash</button>}
      {gameType !== 'the-faker' && <button onClick={() => onSwitch('the-faker')} className="party-btn party-btn-cyan" style={{ fontSize: '1.1rem' }}>Switch to 🕵️ The Faker</button>}
      {gameType !== 'trivia-death' && <button onClick={() => onSwitch('trivia-death')} className="party-btn party-btn-purple" style={{ fontSize: '1.1rem' }}>Switch to 💀 Trivia Death</button>}
      {gameType !== 'bracket-battles' && <button onClick={() => onSwitch('bracket-battles')} className="party-btn party-btn-cyan" style={{ fontSize: '1.1rem' }}>Switch to 🏆 Bracket Battles</button>}
      {gameType !== 'ready-set-bet' && <button onClick={() => onSwitch('ready-set-bet')} className="party-btn party-btn-green" style={{ fontSize: '1.1rem' }}>Switch to 🐎 Ready Set Bet</button>}
      <button onClick={onQuit} className="party-btn party-btn-outline" style={{ fontSize: '1.1rem' }}>🚪 Go Home</button>
    </div>
  );
}

export default function HostPage({ params }: { params: Promise<{ roomCode: string }> }) {
  const { roomCode } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const hostId = searchParams.get('hostId');

  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [showCountdown, setShowCountdown] = useState(false);
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const phaseRef = useRef('');
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { secondsLeft, pct } = useCountdown(state?.hostData?.timerStart, state?.hostData?.timerDuration);

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
      sendAction({ type: state.hostData.autoAdvanceAction });
    }, safeDelay);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [state?.hostData?.autoAdvanceAt, state?.hostData?.autoAdvanceAction, sendAction]);

  useEffect(() => {
    if (!hostId) { setError('Missing host token.'); return; }
    const sse = new EventSource(`/api/party/stream/host?roomCode=${roomCode}&hostId=${hostId}`);
    sse.onmessage = (event) => {
      if (event.data === ':') return;
      const data = JSON.parse(event.data);
      if (data.error) { setError(data.error); sse.close(); }
      else {
        if (data.phase === 'ACTION' && phaseRef.current !== 'ACTION') setShowCountdown(true);
        phaseRef.current = data.phase;
        setState(data);
      }
    };
    return () => sse.close();
  }, [roomCode, hostId]);

  // Race Ticker for Ready Set Bet
  useEffect(() => {
    if (state?.gameType === 'ready-set-bet' && state?.phase === 'RACING') {
      const id = setInterval(() => {
        sendAction({ type: 'RACE_TICK' });
      }, 1500);
      return () => clearInterval(id);
    }
  }, [state?.gameType, state?.phase]);

  const handleQuit = () => { setShowQuitDialog(false); sendAction({ type: 'QUIT_GAME' }); };
  const handleSwitch = (g: string) => sendAction({ type: 'SWITCH_GAME', gameType: g });
  const handlePlayAgain = () => sendAction({ type: 'PLAY_AGAIN' });
  const handleSetQuipRounds = (rs: number) => sendAction({ type: 'SET_QUIP_ROUNDS', rounds: rs });

  const isPlaying = state && state.phase !== 'LOBBY' && state.phase !== 'FINAL_RESULTS';
  const gameColor = state?.gameType === 'quip-clash' ? 'yellow' : state?.gameType === 'trivia-death' ? 'purple-lt' : state?.gameType === 'bracket-battles' ? 'cyan' : state?.gameType === 'ready-set-bet' ? 'green' : 'red';
  const gameName = state?.gameType === 'quip-clash' ? '⚡ Quip Clash' : state?.gameType === 'trivia-death' ? '💀 Trivia Death' : state?.gameType === 'bracket-battles' ? '🏆 Bracket Battles' : state?.gameType === 'ready-set-bet' ? '🐎 Ready Set Bet' : '🕵️ The Faker';

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

      {showQuitDialog && <QuitDialog onQuit={handleQuit} onCancel={() => setShowQuitDialog(false)} />}

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
        </div>

        {isPlaying ? (
          <button onClick={() => setShowQuitDialog(true)} style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '12px', color: 'var(--party-red)', fontWeight: 800, padding: '0.6rem 1.25rem', cursor: 'pointer' }}>
            🚪 End Game
          </button>
        ) : (
          <button onClick={() => router.push('/party')} className="party-btn-outline" style={{ borderRadius: '12px', fontWeight: 800, padding: '0.6rem 1.25rem' }}>
            ← Home
          </button>
        )}
      </div>

      <div className="host-stage party-content">
        {/* ===== LOBBY ===== */}
        {state.phase === 'LOBBY' && (
          <div className="host-lobby phase-enter">
            <div className="host-lobby-title">Waiting for players...</div>
            <p className="host-lobby-subtitle">{state.playerOrder.length} player(s) connected</p>
            <div className="host-players-grid">
              {Object.values(state.players).map((p: any) => (
                <div key={p.id} className="host-player-card">
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: p.avatarColor }} />
                  <div className="host-player-avatar" style={{ border: `3px solid ${p.avatarColor}`, color: p.avatarColor }}>{p.name.charAt(0)}</div>
                  <div className="host-player-name">{p.name}</div>
                </div>
              ))}
            </div>
            
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

            {state.playerOrder.length >= (state.gameType === 'ready-set-bet' ? 1 : 3) ? (
              <div className="center-stack mt-4"><button onClick={() => sendAction({ type: 'START_GAME' })} className="party-btn party-btn-primary party-btn-huge">Start Game! 🎮</button></div>
            ) : (
              <p className="text-muted text-center mt-4">Need at least {state.gameType === 'ready-set-bet' ? 1 : 3} players to start</p>
            )}

            <div style={{ marginTop: '3rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '2rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--party-text-muted)', marginBottom: '1rem' }}>Change Game:</div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {state.gameType !== 'quip-clash' && <button onClick={() => handleSwitch('quip-clash')} className="party-btn party-btn-yellow party-btn-inline" style={{ fontSize: '0.9rem' }}>⚡ Quip Clash</button>}
                {state.gameType !== 'the-faker' && <button onClick={() => handleSwitch('the-faker')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🕵️ The Faker</button>}
                {state.gameType !== 'trivia-death' && <button onClick={() => handleSwitch('trivia-death')} className="party-btn party-btn-purple party-btn-inline" style={{ fontSize: '0.9rem' }}>💀 Trivia Death</button>}
                {state.gameType !== 'bracket-battles' && <button onClick={() => handleSwitch('bracket-battles')} className="party-btn party-btn-cyan party-btn-inline" style={{ fontSize: '0.9rem' }}>🏆 Bracket Battles</button>}
                {state.gameType !== 'ready-set-bet' && <button onClick={() => handleSwitch('ready-set-bet')} className="party-btn party-btn-green party-btn-inline" style={{ fontSize: '0.9rem' }}>🐎 Ready Set Bet</button>}
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
              {Object.values(state.players).map((p: any) => {
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
            <div className="host-phase-title" style={{ fontSize: '2rem' }}>{state.hostData.message}</div>
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
                       <div style={{ fontSize: '1.5rem', color: isWinner ? 'var(--party-green)' : 'var(--party-text-muted)' }}>{votes} Votes</div>
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

        {/* ===== FINAL LEADERBOARD ===== */}
        {state.phase === 'FINAL_RESULTS' && (
          <div className="center-stack phase-enter">
            <div className="host-leaderboard" style={{ marginBottom: '2rem' }}>
              <div className="host-leaderboard-title">🏆 Final Scores</div>
              {Object.values(state.players).sort((a: any, b: any) => b.score - a.score).map((p: any, idx: number) => (
                <div key={p.id} className={`host-leaderboard-row ${idx === 0 ? 'first' : ''}`}>
                  <div className="host-leaderboard-rank">{idx === 0 ? '🥇' : `#${idx + 1}`}</div>
                  <div className="host-leaderboard-name">{p.name}</div>
                  <div className="host-leaderboard-score">{p.score}</div>
                </div>
              ))}
            </div>
            <PostGameOptions gameType={state.gameType} onPlayAgain={handlePlayAgain} onSwitch={handleSwitch} onQuit={() => router.push('/party')} />
          </div>
        )}
      </div>
    </div>
  );
}
