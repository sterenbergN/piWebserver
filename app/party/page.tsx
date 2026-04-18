'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GameType } from '@/lib/party/types';

export default function PartyLobby() {
  const router = useRouter();
  const [tab, setTab] = useState<'join' | 'host'>('join');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/party/admin-check').then(r => r.json()).then(d => setIsAdmin(d.isAdmin)).catch(() => {});
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode || !playerName) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/party/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: roomCode.toUpperCase(), playerName }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || 'Failed to join room'); }
      else { router.push(`/party/player/${roomCode.toUpperCase()}/${data.playerId}`); }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleHost = async (gameType: GameType) => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/party/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || 'Failed to create room'); setLoading(false); }
      else { localStorage.setItem(`host_${data.roomCode}`, data.hostId); router.push(`/party/host/${data.roomCode}?hostId=${data.hostId}`); }
    } catch { setError('Network error. Please try again.'); setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="party-bg">
        <div className="party-bg-orb party-bg-orb-1" />
        <div className="party-bg-orb party-bg-orb-2" />
        <div className="party-bg-orb party-bg-orb-3" />
      </div>

      <div className="party-content party-lobby">
        <div className="party-logo">🎉 Party!</div>
        <p className="party-logo-sub">Jackbox-style games for everyone</p>

        <div className="party-card">
          <div className="party-tab-bar">
            <button className={`party-tab${tab === 'join' ? ' active' : ''}`} onClick={() => setTab('join')}>Join Game</button>
            <button className={`party-tab${tab === 'host' ? ' active' : ''}`} onClick={() => setTab('host')}>Host Game</button>
          </div>

          {error && <div className="party-error">⚠️ {error}</div>}

          {tab === 'join' ? (
            <form onSubmit={handleJoin}>
              <div className="party-form-group">
                <label className="party-label">Room Code</label>
                <input type="text" autoComplete="off" autoCapitalize="characters" maxLength={4}
                  value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())}
                  className="party-input code-input" placeholder="ABCD" required />
              </div>
              <div className="party-form-group">
                <label className="party-label">Your Nickname</label>
                <input type="text" autoComplete="off" maxLength={12}
                  value={playerName} onChange={e => setPlayerName(e.target.value)}
                  className="party-input" style={{ fontSize: '1.25rem', fontWeight: 700, textAlign: 'center' }}
                  placeholder="Enter nickname..." required />
              </div>
              <button type="submit" disabled={loading || !roomCode || !playerName} className="party-btn party-btn-primary" style={{ marginTop: '0.5rem' }}>
                {loading ? 'Joining...' : 'Join Game 🚀'}
              </button>
            </form>
          ) : (
            <div>
              <p style={{ color: 'var(--party-text-muted)', fontSize: '0.9rem', marginBottom: '1rem', textAlign: 'center', fontFamily: 'var(--party-font-body)' }}>
                Pick a game to host on the big screen:
              </p>
              <button onClick={() => handleHost('quip-clash')} disabled={loading} className="party-game-card yellow">
                <h3 style={{ color: 'var(--party-yellow)' }}>⚡ Quip Clash</h3>
                <p>Answer hilarious prompts and vote for the funniest response!</p>
                <div className="badges"><span className="badge">3–8 Players</span><span className="badge">Comedy</span></div>
              </button>
              <button onClick={() => handleHost('the-faker')} disabled={loading} className="party-game-card red">
                <h3 style={{ color: 'var(--party-red)' }}>🕵️ The Faker</h3>
                <p>3 rounds — everyone gets a task <em>except</em> The Faker. Vote out the impostor!</p>
                <div className="badges"><span className="badge">3–8 Players</span><span className="badge">Deception</span><span className="badge">3 Rounds</span></div>
              </button>
              <button onClick={() => handleHost('trivia-death')} disabled={loading} className="party-game-card purple">
                <h3 style={{ color: 'var(--party-purple-lt)' }}>💀 Trivia Death</h3>
                <p>Answer trivia or face the Killing Floor. Die and become a ghost — or escape!</p>
                <div className="badges"><span className="badge">3–8 Players</span><span className="badge">Trivia</span><span className="badge">Survival</span></div>
              </button>
              <button onClick={() => handleHost('bracket-battles')} disabled={loading} className="party-game-card cyan">
                <h3 style={{ color: 'var(--party-cyan)' }}>🏆 Bracket Battles</h3>
                <p>Submit crazy answers — they battle tournament-style and the crowd votes for a champion!</p>
                <div className="badges"><span className="badge">3–16 Players</span><span className="badge">Tournament Comedy</span><span className="badge">Betting</span></div>
              </button>
              <button onClick={() => handleHost('ready-set-bet')} disabled={loading} className="party-game-card green">
                <h3 style={{ color: 'var(--party-green)' }}>🐎 Ready Set Bet</h3>
                <p>Bet in real-time as dice-powered horses race to the finish. 4 races, live odds!</p>
                <div className="badges"><span className="badge">1–16 Players</span><span className="badge">Party Racing</span><span className="badge">Prop Bets</span></div>
              </button>

              <div className="party-divider" />
              {isAdmin && (
                <button onClick={() => router.push('/party/admin')} className="party-btn party-btn-outline" style={{ fontSize: '0.8rem' }}>
                  ⚙️ Manage Prompts
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
