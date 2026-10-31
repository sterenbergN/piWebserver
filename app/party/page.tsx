'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GameType } from '@/lib/party/types';
import { AVATARS } from '@/lib/party/avatars';
import { HowToPlayModal } from '@/components/party/PhoneExtras';
import GamePicker, { rememberHostedGame } from '@/components/party/GamePicker';

export default function PartyLobby() {
  const router = useRouter();
  const [tab, setTab] = useState<'join' | 'host'>('join');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastPlayed, setLastPlayed] = useState<{ roomCode: string; playerId: string; audience?: boolean } | null>(null);
  const [audienceOffer, setAudienceOffer] = useState(false);
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [lastHosted, setLastHosted] = useState<{ roomCode: string; hostId: string } | null>(null);
  const [guideGame, setGuideGame] = useState<GameType | null>(null);

  const [hostMode, setHostMode] = useState<'tv' | 'vip'>('tv');
  const [showAvatars, setShowAvatars] = useState(false);

  const chooseHostMode = (mode: 'tv' | 'vip') => {
    setHostMode(mode);
    try {
      localStorage.setItem('partyHostMode', mode);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetch('/api/party/admin-check').then(r => r.json()).then(d => setIsAdmin(d.isAdmin)).catch(() => {});
    // Prefill from a scanned QR code (?code=ABCD) and remember the last nickname.
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) setRoomCode(code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
    try {
      const savedName = localStorage.getItem('partyNickname');
      if (savedName) setPlayerName(savedName);
      if (localStorage.getItem('partyHostMode') === 'vip') setHostMode('vip');
      const savedAvatar = localStorage.getItem('partyAvatar');
      setAvatar(savedAvatar && (AVATARS as readonly string[]).includes(savedAvatar) ? savedAvatar : AVATARS[Math.floor(Math.random() * AVATARS.length)]);
      const recent = (key: string) => {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        return raw && Date.now() - raw.at < 6 * 60 * 60 * 1000 ? raw : null;
      };
      const played = recent('partyLastPlayed');
      if (played?.roomCode && played?.playerId) {
        fetch(`/api/party/join?roomCode=${encodeURIComponent(played.roomCode)}&playerId=${encodeURIComponent(played.playerId)}&audience=${played.audience === true}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.valid) setLastPlayed(played);
            else localStorage.removeItem('partyLastPlayed');
          })
          .catch(() => setLastPlayed(played));
      }
      const hosted = recent('partyLastHosted');
      if (hosted?.roomCode && hosted?.hostId) {
        fetch(`/api/party/join?roomCode=${encodeURIComponent(hosted.roomCode)}&hostId=${encodeURIComponent(hosted.hostId)}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.valid) setLastHosted(hosted);
            else localStorage.removeItem('partyLastHosted');
          })
          .catch(() => setLastHosted(hosted));
      }
    } catch { /* storage unavailable */ }
  }, []);

  const seatPath = (seat: { roomCode: string; playerId: string; audience?: boolean; hostId?: string }) => {
    if (seat.audience) return `/party/audience/${seat.roomCode}/${seat.playerId}`;
    const q = seat.hostId ? `?hostId=${encodeURIComponent(seat.hostId)}` : '';
    return `/party/player/${seat.roomCode}/${seat.playerId}${q}`;
  };

  const join = async (asAudience: boolean) => {
    if (!roomCode || !playerName) return;
    setLoading(true); setError(''); setAudienceOffer(false);
    try {
      const res = await fetch('/api/party/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: roomCode.toUpperCase(), playerName, asAudience, avatar }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to join room');
        // Full room or game already running: offer a seat in the audience instead.
        setAudienceOffer(data.audienceAvailable === true);
      } else {
        const seat = { roomCode: roomCode.toUpperCase(), playerId: data.playerId, audience: data.audience === true };
        try {
          localStorage.setItem('partyNickname', playerName.trim());
          localStorage.setItem('partyAvatar', avatar);
          localStorage.setItem('partyLastPlayed', JSON.stringify({ ...seat, at: Date.now() }));
        } catch { /* ignore */ }
        router.push(seatPath(seat));
      }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleJoin = (e: React.FormEvent) => { e.preventDefault(); join(false); };

  const handleHost = async (gameType: GameType) => {
    if (hostMode === 'vip' && !playerName.trim()) {
      setError('Enter your nickname above to host & play on your phone!');
      return;
    }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/party/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType, mode: hostMode === 'vip' ? 'phones' : 'tv' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to create room');
        setLoading(false);
        return;
      }

      rememberHostedGame(gameType);

      if (hostMode === 'vip') {
        const joinRes = await fetch('/api/party/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode: data.roomCode, playerName: playerName.trim(), avatar }),
        });
        const joinData = await joinRes.json();
        if (!joinRes.ok || joinData.error) {
          setError(joinData.error || 'Failed to join room as VIP');
          setLoading(false);
          return;
        }
        const seat = { roomCode: data.roomCode, playerId: joinData.playerId, hostId: data.hostId };
        try {
          localStorage.setItem('partyNickname', playerName.trim());
          localStorage.setItem('partyAvatar', avatar);
          localStorage.setItem(`host_${data.roomCode}`, data.hostId);
          localStorage.setItem('partyLastPlayed', JSON.stringify({ ...seat, at: Date.now() }));
        } catch { /* ignore */ }
        router.push(seatPath(seat));
      } else {
        try {
          localStorage.setItem(`host_${data.roomCode}`, data.hostId);
          localStorage.setItem('partyLastHosted', JSON.stringify({ roomCode: data.roomCode, hostId: data.hostId, at: Date.now() }));
        } catch { /* ignore */ }
        router.push(`/party/host/${data.roomCode}?hostId=${data.hostId}`);
      }
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
        <p className="party-logo-sub">Jackbox-style &amp; tabletop games for everyone</p>

        <div className="party-card" style={tab === 'host' ? { maxWidth: 'min(880px, 100%)' } : undefined}>
          <div className="party-tab-bar">
            <button className={`party-tab${tab === 'join' ? ' active' : ''}`} onClick={() => setTab('join')}>Join Game</button>
            <button className={`party-tab${tab === 'host' ? ' active' : ''}`} onClick={() => setTab('host')}>Host Game</button>
          </div>

          {error && <div className="party-error">⚠️ {error}</div>}
          {audienceOffer && (
            <button type="button" className="party-btn party-btn-primary" style={{ marginBottom: '1rem' }} disabled={loading} onClick={() => join(true)}>
              👀 Join the audience instead
            </button>
          )}

          {(lastPlayed || lastHosted) && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {lastPlayed && (
                <button type="button" className="party-btn party-btn-outline" style={{ flex: 1, fontSize: '0.85rem', padding: '0.6rem' }}
                  onClick={() => router.push(seatPath(lastPlayed))}>
                  ↩ Rejoin {lastPlayed.roomCode}
                </button>
              )}
              {lastHosted && (
                <button type="button" className="party-btn party-btn-outline" style={{ flex: 1, fontSize: '0.85rem', padding: '0.6rem' }}
                  onClick={() => router.push(`/party/host/${lastHosted.roomCode}?hostId=${lastHosted.hostId}`)}>
                  📺 Resume TV {lastHosted.roomCode}
                </button>
              )}
            </div>
          )}

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
                <input type="text" autoComplete="off" maxLength={16}
                  value={playerName} onChange={e => setPlayerName(e.target.value)}
                  className="party-input" style={{ fontSize: '1.25rem', fontWeight: 700, textAlign: 'center' }}
                  placeholder="Enter nickname..." required />
              </div>
              <div className="party-form-group">
                <label className="party-label">Pick your character {avatar}</label>
                <div className="party-avatar-grid" role="radiogroup" aria-label="Character">
                  {AVATARS.map(a => (
                    <button key={a} type="button" role="radio" aria-checked={avatar === a} className="party-avatar-option" onClick={() => setAvatar(a)}>{a}</button>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={loading || !roomCode || !playerName} className="party-btn party-btn-primary" style={{ marginTop: '0.5rem' }}>
                {loading ? 'Joining...' : 'Join Game 🚀'}
              </button>
              <button type="button" disabled={loading || !roomCode || !playerName} onClick={() => join(true)}
                style={{ background: 'none', border: 'none', color: 'var(--party-text-muted)', marginTop: '0.75rem', width: '100%', cursor: 'pointer', fontSize: '0.85rem' }}>
                or just watch &amp; vote in the audience →
              </button>
              <button
                type="button"
                onClick={() => setGuideGame('quip-clash')}
                className="party-btn party-btn-outline"
                style={{ marginTop: '0.85rem', width: '100%', fontSize: '0.85rem', padding: '0.55rem' }}
              >
                ❓ Browse Game Rules &amp; Scoring
              </button>
            </form>
          ) : (
            <div>
              <div className="party-form-group" style={{ marginBottom: '1rem' }}>
                <label className="party-label" style={{ textAlign: 'center' }}>How are you hosting?</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => chooseHostMode('tv')}
                    aria-pressed={hostMode === 'tv'}
                    style={{
                      padding: '0.65rem 0.5rem',
                      borderRadius: '12px',
                      border: `2px solid ${hostMode === 'tv' ? 'var(--party-purple-lt)' : 'var(--party-border)'}`,
                      background: hostMode === 'tv' ? 'rgba(168,85,247,0.2)' : 'rgba(0,0,0,0.25)',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    📺 Big Screen / TV
                    <div style={{ fontSize: '0.68rem', color: 'var(--party-text-muted)', fontWeight: 500, marginTop: '0.15rem' }}>
                      Dedicated TV display
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseHostMode('vip')}
                    aria-pressed={hostMode === 'vip'}
                    style={{
                      padding: '0.65rem 0.5rem',
                      borderRadius: '12px',
                      border: `2px solid ${hostMode === 'vip' ? 'var(--party-cyan)' : 'var(--party-border)'}`,
                      background: hostMode === 'vip' ? 'rgba(6,182,212,0.18)' : 'rgba(0,0,0,0.25)',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    📱 Phones Only (VIP)
                    <div style={{ fontSize: '0.68rem', color: 'var(--party-text-muted)', fontWeight: 500, marginTop: '0.15rem' }}>
                      No TV needed — host &amp; play
                    </div>
                  </button>
                </div>
              </div>

              {hostMode === 'vip' && (
                <div style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid var(--party-border)', borderRadius: '14px', padding: '0.9rem', marginBottom: '1.25rem' }}>
                  <div className="party-form-group" style={{ marginBottom: '0.75rem' }}>
                    <label className="party-label">Your VIP Nickname</label>
                    <input type="text" autoComplete="off" maxLength={16}
                      value={playerName} onChange={e => setPlayerName(e.target.value)}
                      className="party-input" style={{ fontSize: '1.1rem', fontWeight: 700, textAlign: 'center', padding: '0.65rem' }}
                      placeholder="Enter your nickname..." required />
                  </div>
                  <div className="party-form-group" style={{ marginBottom: 0 }}>
                    <button type="button" className="party-chip" aria-expanded={showAvatars} onClick={() => setShowAvatars(!showAvatars)}>
                      Your character: <span style={{ fontSize: '1.1rem' }}>{avatar}</span> {showAvatars ? '▴' : '▾'}
                    </button>
                    {showAvatars && (
                      <div className="party-avatar-grid" role="radiogroup" aria-label="Character" style={{ marginTop: '0.5rem' }}>
                        {AVATARS.map(a => (
                          <button key={a} type="button" role="radio" aria-checked={avatar === a} className="party-avatar-option" onClick={() => { setAvatar(a); setShowAvatars(false); }}>{a}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <GamePicker phonesOnly={hostMode === 'vip'} loading={loading} onHost={handleHost} onGuide={setGuideGame} />

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
      {guideGame && (
        <HowToPlayModal
          initialGameType={guideGame}
          onClose={() => setGuideGame(null)}
          onAction={tab === 'host' ? (g) => handleHost(g) : undefined}
          actionLabel={tab === 'host' ? 'Host This Game 🚀' : undefined}
          phonesOnly={tab === 'host' && hostMode === 'vip'}
        />
      )}
    </div>
  );
}
