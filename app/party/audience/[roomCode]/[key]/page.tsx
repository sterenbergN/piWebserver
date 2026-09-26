'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';

type Poll = { key: string; prompt: string; choices: { id: string; label: string }[]; myChoice: string | null };
type AudienceState = {
  roomCode: string;
  gameType: string;
  phase: string;
  me: { id: string; name: string; score: number };
  players: { id: string; name: string; score: number; avatarColor: string }[];
  audienceSize: number;
  audienceLeaders: { name: string; score: number }[];
  poll: Poll | null;
};

const POLL_HINT: Record<string, string> = {
  'quip-clash': 'Your favorite gets an audience bonus!',
  'bracket-battles': 'The audience majority counts as one vote.',
  'trivia-death': 'Play along — a point for every right answer.',
  'the-faker': 'Spot the faker for a point.',
  'ready-set-bet': 'Pick the winner for a point.',
};

export default function AudiencePage({ params }: { params: Promise<{ roomCode: string; key: string }> }) {
  const { roomCode, key } = use(params);
  const [state, setState] = useState<AudienceState | null>(null);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const sse = new EventSource(`/api/party/stream/audience?roomCode=${roomCode}&key=${key}`);
    sse.onopen = () => setReconnecting(false);
    sse.onerror = () => setReconnecting(true);
    sse.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }
      setReconnecting(false);
      if (data.error) { setError(data.error); sse.close(); } else setState(data);
    };
    return () => sse.close();
  }, [roomCode, key]);

  const vote = async (choice: string) => {
    setPending(choice);
    try {
      await fetch('/api/party/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId: key, action: { type: 'AUDIENCE_VOTE', choice } }),
      });
    } finally {
      setPending(null);
    }
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
      Joining the audience in {roomCode}…
    </div>
  );

  const standings = [...state.players].sort((a, b) => b.score - a.score);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--party-bg)' }}>
      <div className="player-header party-content" style={{ borderBottomColor: 'var(--party-cyan)' }}>
        <div>
          <div className="player-header-name" style={{ color: 'var(--party-cyan)' }}>{state.me.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)' }}>👀 Audience · {state.audienceSize} watching</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="player-header-score-label">Points</div>
          <div className="player-header-score">{state.me.score}</div>
        </div>
      </div>
      {reconnecting && (
        <div role="status" style={{ background: 'var(--party-yellow)', color: '#000', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', padding: '0.35rem' }}>Reconnecting…</div>
      )}

      <div className="player-body party-content">
        {state.poll ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '1rem' }}>
            <div style={{ textAlign: 'center', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--party-cyan)', fontWeight: 900 }}>Audience vote</div>
            <div className="player-vote-prompt-text text-center">{state.poll.prompt}</div>
            <div className={state.poll.choices.length > 4 ? 'player-faker-vote-grid' : ''} style={state.poll.choices.length > 4 ? undefined : { display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {state.poll.choices.map((c) => {
                const mine = state.poll!.myChoice === c.id;
                return (
                  <button key={c.id} className={state.poll!.choices.length > 4 ? 'player-faker-vote-btn' : 'player-vote-btn'} disabled={pending !== null}
                    aria-pressed={mine}
                    style={mine ? { outline: '3px solid var(--party-cyan)', outlineOffset: 2 } : undefined}
                    onClick={() => vote(c.id)}>
                    {mine ? '✓ ' : ''}{c.label}
                  </button>
                );
              })}
            </div>
            <p className="player-waiting-sub" style={{ textAlign: 'center' }}>
              {state.poll.myChoice ? 'Vote locked in — tap another to change it. ' : ''}{POLL_HINT[state.gameType] || ''}
            </p>
          </div>
        ) : (
          <div className="player-waiting">
            <div className="player-look-tv-icon">📺</div>
            <div className="player-waiting-title">{state.phase === 'LOBBY' ? "You're in the audience!" : 'Watch the TV'}</div>
            <p className="player-waiting-sub">{state.phase === 'LOBBY' ? 'Voting opens once the game starts.' : 'The next audience vote will pop up here.'}</p>
          </div>
        )}

        {standings.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div className="player-waiting-sub" style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Scoreboard</div>
            {standings.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--party-border)', fontSize: '0.9rem' }}>
                <span style={{ color: p.avatarColor, fontWeight: 700 }}>{i + 1}. {p.name}</span>
                <span>{p.score}</span>
              </div>
            ))}
          </div>
        )}
        {state.audienceLeaders.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div className="player-waiting-sub" style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Top of the audience</div>
            {state.audienceLeaders.map((a, i) => (
              <div key={a.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <span>{i + 1}. {a.name}</span><span>{a.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
