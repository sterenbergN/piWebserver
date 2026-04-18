'use client';
import { useState, useEffect, use } from 'react';

export default function PlayerPage({ params }: { params: Promise<{ roomCode: string; playerId: string }> }) {
  const { roomCode, playerId } = use(params);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState(['', '']);
  const [voted, setVoted] = useState(false);
  const [kfAnswer, setKfAnswer] = useState('');
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const sse = new EventSource(`/api/party/stream/player?roomCode=${roomCode}&playerId=${playerId}`);
    sse.onmessage = (event) => {
      if (event.data === ':') return;
      const data = JSON.parse(event.data);
      if (data.error) { setError(data.error); sse.close(); }
      else { setState(data); }
    };
    return () => sse.close();
  }, [roomCode, playerId]);

  useEffect(() => { setVoted(false); setKfAnswer(''); setInputValue(''); }, [state?.phase, state?.data?.phase, state?.data?.question, state?.data?.mathQuestion, state?.data?.miniGame, state?.data?.propBet]);

  const sendAction = async (action: any) => {
    await fetch('/api/party/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId, action }),
    });
  };

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--party-bg)' }}>
      <p style={{ color: 'var(--party-red)' }}>{error}</p>
    </div>
  );

  if (!state) return <div style={{ minHeight: '100vh', background: 'var(--party-bg)' }} />;

  const me = state.me;
  const pd = state.data;
  const myScore = pd?.money !== undefined ? pd.money : (state.players?.[me.id]?.score ?? 0);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--party-bg)' }}>
      <div className="player-header party-content" style={{ borderBottomColor: me.avatarColor }}>
        <div><div className="player-header-name" style={{ color: me.avatarColor }}>{me.name} {pd?.status === 'ghost' ? '👻' : ''}</div></div>
        <div style={{ textAlign: 'right' }}>
          <div className="player-header-score-label">{pd?.money !== undefined ? 'Money' : 'Score'}</div>
          <div className="player-header-score">{pd?.money !== undefined ? '$'+myScore : myScore}</div>
        </div>
      </div>

      <div className="player-body party-content">
        {state.phase === 'LOBBY' && (
          <div className="player-waiting">
            <div className="player-avatar-big" style={{ color: me.avatarColor, borderColor: me.avatarColor }}>{me.name.charAt(0)}</div>
            <div className="player-waiting-title">You're in!</div>
            <p className="player-waiting-sub">Look at the TV.</p>
          </div>
        )}

        {/* ===== QUIP CLASH ===== */}
        {pd?.phase === 'PROMPTING' && state.gameType === 'quip-clash' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[0, 1].map((i) => (
              <div key={i} className="player-prompt-card">
                <div className="player-prompt-text">"{pd.prompts[i]}"</div>
                {pd.answers?.[i] ? <div className="player-submitted-badge">✅ Submitted!</div> : (
                  <div className="player-answer-row">
                    <input className="player-input" value={answers[i]} onChange={e => { const c=[...answers]; c[i]=e.target.value; setAnswers(c); }} />
                    <button className="party-btn party-btn-primary party-btn-inline" onClick={() => sendAction({ type: 'SUBMIT_ANSWER', promptIndex: i, answer: answers[i] })}>Send</button>
                  </div>
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
                  <button key={a.id} className="player-vote-btn" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_VOTE', votedForId: a.id }); }}>{a.answer}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'WAITING' && <div className="player-look-tv"><div className="player-look-tv-icon">📺</div></div>}

        {/* ===== FAKER ===== */}
        {pd?.phase === 'TASK_DELIVERY' && state.gameType === 'the-faker' && (
          <div className={`player-role-card ${pd.role === 'FAKER' ? 'faker' : pd.role === 'ELIMINATED' ? 'eliminated' : 'innocent'}`}>
            <div className="player-role-title">{pd.role === 'ELIMINATED' ? 'Eliminated 💀' : pd.role === 'FAKER' ? 'You Are The Faker!' : 'Your Secret Task'}</div>
            <p className="player-role-instruction">{pd.instruction || pd.message}</p>
            {pd.prompt && <div className="player-task-box">"{pd.prompt}"</div>}
          </div>
        )}
        {pd?.showAction && <div className="player-waiting"><div style={{ fontSize: '5rem', animation: 'avatarPulse 0.5s infinite' }}>🏃</div><div className="player-waiting-title text-red">FREEZE!</div></div>}
        {pd?.phase === 'VOTING' && state.gameType === 'the-faker' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="player-vote-prompt text-red text-center mb-4 font-bold">Vote out The Faker!</div>
            {voted ? <div className="player-waiting">Voted!</div> : (
              <div className="player-faker-vote-grid">
                {pd.activePlayers.filter((pid:string) => pid !== me.id).map((pid:string) => (
                  <button key={pid} className="player-faker-vote-btn" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_VOTE', votedFor: pid }); }}>{state.players[pid]?.name}</button>
                ))}
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
              <div className="player-waiting"><div className="player-waiting-title">Answered!</div><div className="player-waiting-sub">Watch the TV...</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {pd.choices?.map((c: string, idx: number) => (
                  <button key={idx} className="player-trivia-choice" onClick={() => { 
                    setVoted(true); 
                    sendAction({ 
                      type: pd.phase === 'FINAL_ESCAPE' ? 'SUBMIT_ESCAPE_ANSWER' : 'SUBMIT_TRIVIA_ANSWER', 
                      answer: idx,
                      doubleDown: inputValue === 'true'
                    }); 
                  }}>
                    <div className="host-trivia-choice-letter">{['A','B','C','D'][idx]}</div> {c}
                  </button>
                ))}
              </div>
            )}
            {pd.flavor && <div className="player-flavor-msg" style={{ marginTop: '1rem' }}>{pd.flavor}</div>}
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
                      <button className="party-btn party-btn-primary" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer }); }}>GO</button>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '2rem', fontFamily: 'monospace', marginTop: '1rem' }}>{kfAnswer || '_'}</div>
                  </div>
                )}
                {pd.miniGame === 'password' && (
                  <div style={{ width: '100%' }}>
                    <div style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--party-text-muted)', fontStyle: 'italic' }}>Choose a door... one leads to safety.</div>
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} disabled={voted} className="player-numpad-btn" style={{ width: '64px', height: '64px', fontSize: '1.75rem' }} onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: n }); }}>🚪</button>
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
                      <button disabled={voted || !kfAnswer} className="party-btn party-btn-primary" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer.toUpperCase() }); }}>GO</button>
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
                      <button className="party-btn party-btn-primary" style={{ fontSize: '2rem', padding: '2rem 3rem' }} onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER' }); }}>⚡ TAP!</button>
                    ) : (
                      <div className="player-waiting"><div className="player-waiting-title">Tapped!</div></div>
                    )}
                  </div>
                )}
                {pd.miniGame === 'memory' && (
                  <div style={{ textAlign: 'center', width: '100%' }}>
                    <div style={{ marginBottom: '1rem', color: 'var(--party-text-muted)', fontSize: '0.9rem' }}>Type the FIRST symbol you saw</div>
                    <div className="player-answer-row">
                      <input type="text" className="party-input" value={kfAnswer} onChange={e => setKfAnswer(e.target.value)} placeholder="e.g. 🦇" maxLength={2} style={{ textAlign: 'center', fontSize: '2rem' }} />
                      <button disabled={voted || !kfAnswer} className="party-btn party-btn-primary" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: kfAnswer }); }}>GO</button>
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
                        onClick={() => { const bid = Math.min(parseInt(kfAnswer)||0, pd.maxBid); setVoted(true); sendAction({ type: 'SUBMIT_KILLING_FLOOR_ANSWER', answer: bid }); }}>BID</button>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '2rem', fontFamily: 'monospace', marginTop: '0.75rem', color: 'var(--party-yellow)' }}>${kfAnswer || '0'}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="player-waiting">
                <div style={{ fontSize: '3rem' }}>📺</div>
                <div className="player-waiting-title">Watch them suffer!</div>
                <div className="player-waiting-sub">The Killing Floor awaits...</div>
              </div>
            )}
          </div>
        )}
        {pd?.phase === 'KILLING_FLOOR_RESULTS' && state.gameType === 'trivia-death' && (
          <div className="player-waiting" style={{ gap: '1rem' }}>
            {pd.isOnFloor ? (
              <>
                <div style={{ fontSize: '4rem' }}>{pd.isDead ? '💀' : '🎉'}</div>
                <div className="player-waiting-title" style={{ color: pd.isDead ? 'var(--party-red)' : 'var(--party-green)' }}>
                  {pd.isDead ? 'You have been slain...' : 'You survived!'}
                </div>
                <div className="player-waiting-sub">{pd.isDead ? 'But as a ghost, you can still escape!' : 'Keep answering correctly!'}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '3rem' }}>👀</div>
                <div className="player-waiting-title">Look at the TV!</div>
              </>
            )}
          </div>
        )}


        {/* ===== BRACKET BATTLES ===== */}
        {pd?.phase === 'PROMPTING' && state.gameType === 'bracket-battles' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1rem', color: 'var(--party-cyan)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>🏆 Bracket Battles</div>
            <div className="player-prompt-box">"{pd.prompt}"</div>
            {voted ? <div className="player-waiting"><div className="player-waiting-title">Submitted!</div><div className="player-waiting-sub">Wait for the bracket...</div></div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input type="text" value={inputValue} onChange={e => setInputValue(e.target.value)} className="party-input" placeholder="Type your answer..." maxLength={40} autoFocus
                  style={{ textAlign: 'center', fontSize: '1.1rem', padding: '1rem' }} />
                <button onClick={() => { if(inputValue) { setVoted(true); sendAction({ type: 'SUBMIT_ANSWER', answer: inputValue }); setInputValue(''); } }} className="party-btn party-btn-primary"
                  style={{ padding: '1rem', fontSize: '1.1rem' }}>SUBMIT</button>
              </div>
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
                  <button key={e.id} className="player-vote-btn" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_PREDICTION', predictionId: e.id }); }}>{e.answer}</button>
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
                  <button key={a.id} className="player-vote-btn" onClick={() => { setVoted(true); sendAction({ type: 'SUBMIT_VOTE', voteId: a.id }); }}>{a.answer}</button>
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
          <div className="player-waiting"><div className="player-look-tv-icon">📺</div><div>Look at the TV!</div></div>
        )}

        {/* ===== READY SET BET ===== */}
        {pd?.phase === 'RACING' && state.gameType === 'ready-set-bet' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--party-radius)', padding: '0.75rem 1rem' }}>
              <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.2rem', color: 'var(--party-green)' }}>🏆 ${pd.money}</div>
              <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '1.1rem', color: 'var(--party-yellow)' }}>🪙 {5 - (pd.bets?.length || 0)} left</div>
            </div>
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
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, color: 'var(--party-red)', fontSize: '1.5rem' }}>BETTING CLOSED</div>
                <div style={{ marginTop: '0.5rem', color: 'var(--party-text-muted)' }}>Watch the TV!</div>
              </div>
            ) : (pd.bets?.length || 0) >= 5 ? (
              <div className="player-waiting">
                <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, color: 'var(--party-yellow)', fontSize: '1.25rem' }}>All Tokens Placed!</div>
                <div style={{ color: 'var(--party-text-muted)', marginTop: '0.5rem' }}>Wait for the race to finish...</div>
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
          <div className="player-waiting">
            <div style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: '2.5rem', color: pd.net > 0 ? 'var(--party-green)' : pd.net < 0 ? 'var(--party-red)' : '#fff' }}>
              {pd.net > 0 ? `+$${pd.net}` : pd.net < 0 ? `-$${Math.abs(pd.net)}` : 'EVEN'}
            </div>
            <div style={{ fontFamily: 'var(--party-font-display)', fontSize: '1.5rem', marginTop: '0.5rem' }}>Balance: ${pd.money}</div>
            <div style={{ color: 'var(--party-text-muted)', marginTop: '1rem' }}>Look at the TV.</div>
          </div>
        )}


        {/* ===== RESULTS ===== */}
        {(pd?.phase === 'QUESTION_RESULTS' || pd?.phase === 'RESULTS' || pd?.phase === 'ROUND_RESULTS') && (
          <div className="player-result-screen">
            <div className="player-look-tv-icon mt-6" style={{ fontSize: '2.5rem' }}>📺</div>
            <p className="text-center font-bold">{pd.message || (pd.correct !== undefined ? (pd.correct ? 'Correct! ✅' : pd.going_to_killing_floor ? 'WRONG! To the floor! 💀' : 'Wrong! ❌') : 'Look at the TV')}</p>
          </div>
        )}

        {state.phase === 'FINAL_RESULTS' && (
          <div className="player-result-screen">
            <div style={{ fontSize: '4rem', marginBottom: '0.75rem' }}>🏆</div>
            <div className="player-waiting-title">Game Over!</div>
            <p>Look at the TV.</p>
          </div>
        )}
      </div>
    </div>
  );
}
