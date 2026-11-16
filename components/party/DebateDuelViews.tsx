'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { VoterFaces } from './HostShow';

// Debate Duel's screens: the TV view for each phase, and the phone view for
// writing openings and rebuttals, judging, and seeing who won. The game itself
// is lib/party/games/debate-duel.ts.

type Player = { id: string; name: string; score: number; avatar?: string; avatarColor: string; left?: boolean };
type Side = 0 | 1;

const SIDE_COLOR = ['var(--party-cyan)', 'var(--party-pink)'] as const;
const MAX_ARGUMENT = 120; // the server trims free text to this

const SAFETY_ARGUMENTS = [
  'Scientists agree with me. I am the scientists.',
  'My grandmother believed this, and she lived to 103.',
  'If I am wrong, why am I so confident?',
  'Name one thing my opponent has ever been right about. Exactly.',
  'History will prove me right. Probably on a Tuesday.',
  'Ask yourself: what would a golden retriever choose?',
  'I did my own research. It took four minutes.',
  'The other side is literally what villains say.',
];
const safetyArgument = () => SAFETY_ARGUMENTS[Math.floor(Math.random() * SAFETY_ARGUMENTS.length)];

function Timer({ secondsLeft, pct, width = 500 }: { secondsLeft: number | null; pct: number; width?: number }) {
  if (secondsLeft === null) return null;
  const low = pct < 25;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', maxWidth: width, margin: '0 auto 1.25rem' }}>
      <div className="host-timer-bar-wrap" style={{ flex: 1, height: '8px', margin: 0 }}>
        <div className="host-timer-bar" style={{ width: `${pct}%`, background: low ? 'var(--party-red)' : 'var(--party-purple-lt)' }} />
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 900, fontFamily: 'monospace', color: low ? 'var(--party-red)' : 'var(--party-purple-lt)' }}>{Math.ceil(secondsLeft)}</div>
    </div>
  );
}

/** One side's opening and rebuttal. On the TV they're revealed one after the other. */
function SideColumn({ side, name, opening, rebuttal, reveal, children, highlight }: {
  side: Side; name: string; opening: string; rebuttal: string; reveal?: boolean; children?: ReactNode; highlight?: boolean;
}) {
  // Reveal order: opening A, opening B, rebuttal A, rebuttal B.
  const delay = (step: number) => (reveal ? { animationDelay: `${0.3 + step * 1.1}s` } : { animation: 'none' });
  return (
    <div className={`debate-side${highlight ? ' winner' : ''}`} style={{ '--debate-color': SIDE_COLOR[side] } as CSSProperties}>
      <div className="debate-side-name">{name}</div>
      <div className="debate-arg" style={delay(side)}>
        <div className="debate-arg-label">Opening</div>
        <div className="debate-arg-text">{opening}</div>
      </div>
      <div className="debate-arg rebuttal" style={delay(2 + side)}>
        <div className="debate-arg-label">Rebuttal</div>
        <div className="debate-arg-text">{rebuttal}</div>
      </div>
      {children}
    </div>
  );
}

// ─── TV ────────────────────────────────────────────────────────────────────────

export function DebateDuelHost({ state, secondsLeft, pct }: {
  state: { phase: string; players: Record<string, Player>; playerData: Record<string, any>; hostData: any };
  secondsLeft: number | null;
  pct: number;
}) {
  const h = state.hostData || {};
  const seated = Object.values(state.players).filter((p) => !p.left);

  if (state.phase === 'OPENING' || state.phase === 'REBUTTAL') {
    const opening = state.phase === 'OPENING';
    return (
      <div className="host-prompting phase-enter">
        {h.totalRounds > 1 && <div className="debate-motion-label">Round {h.round} of {h.totalRounds}</div>}
        <div className="host-phase-title">{opening ? 'Opening Statements' : 'Rebuttals'}</div>
        <p className="host-prompting-sub">
          {opening
            ? 'You’ve each been handed a side in two debates. Argue it on your phone!'
            : 'Read your opponent’s opening, then fire back!'}
        </p>
        <Timer secondsLeft={secondsLeft} pct={pct} width={600} />
        <div className="host-player-status-grid">
          {seated.map((p) => {
            const written: string[] = state.playerData[p.id]?.written || [];
            const done = written.filter(Boolean).length;
            return (
              <div key={p.id} className="host-player-status">
                <div className={`host-player-status-dot ${done === 2 ? 'done' : 'waiting'}`}>{done === 2 ? '✓' : `${done}/2`}</div>
                <span>{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (state.phase === 'VOTING' && h.sides) {
    return (
      <div className="debate-stage phase-enter">
        <Timer secondsLeft={secondsLeft} pct={pct} />
        <div className="debate-motion-label">Debate {h.debateNumber} of {h.totalDebates}</div>
        <div className="debate-motion">{h.motion}</div>
        <div className="debate-columns">
          <SideColumn side={0} name={h.sides[0]} opening={h.openings[0]} rebuttal={h.rebuttals[0]} reveal />
          <div className="debate-vs">VS</div>
          <SideColumn side={1} name={h.sides[1]} opening={h.openings[1]} rebuttal={h.rebuttals[1]} reveal />
        </div>
        <p className="host-prompting-sub" style={{ marginTop: '1.25rem', marginBottom: 0 }}>Vote on your phones: who argued better?</p>
      </div>
    );
  }

  if (state.phase === 'DEBATE_RESULTS' && h.sides) {
    return (
      <div className="debate-stage phase-enter">
        <div className="debate-motion-label">Debate {h.debateNumber} of {h.totalDebates}</div>
        <div className="debate-motion">{h.motion}</div>
        {h.winnerSide === null && <div className="debate-verdict">🤝 Dead heat!</div>}
        <div className="debate-columns">
          <SideResult side={0} h={h} players={state.players} />
          <div className="debate-vs">VS</div>
          <SideResult side={1} h={h} players={state.players} />
        </div>
      </div>
    );
  }

  return null;
}

function SideResult({ side, h, players }: { side: Side; h: any; players: Record<string, Player> }) {
  const pid: string = h.debaters?.[side];
  const p = players[pid];
  const won = h.winnerSide === side;
  // The room just read the arguments, so the verdict gets the space here.
  return (
    <div className={`debate-side debate-side-result${won ? ' winner' : ''}`} style={{ '--debate-color': SIDE_COLOR[side] } as CSSProperties}>
      <div className="debate-side-name">{h.sides[side]}</div>
      <div className="debate-result">
        <div className="debate-result-who" style={{ color: p?.avatarColor }}>{p?.avatar} {p?.name || 'Someone'}</div>
        <div className="debate-result-votes">
          <span className="host-result-votes-num">{h.tally?.[side] ?? 0}</span>
          <span className="host-result-votes-label">vote{h.tally?.[side] === 1 ? '' : 's'} · +{(h.points?.[side] ?? 0).toLocaleString()}</span>
        </div>
        <VoterFaces ids={h.voters?.[side]} players={players} />
        {h.micDrop === side && <div className="debate-badge">💥 MIC DROP</div>}
        {won && h.micDrop !== side && <div className="debate-badge">🏆 WINNER</div>}
        {h.audienceTally && (
          <div style={{ fontSize: '0.85rem', color: 'var(--party-cyan)', fontWeight: 800, marginTop: '0.5rem' }}>
            👀 {h.audienceTally[side] || 0} audience{h.audienceFavorite === side ? ' · favorite +250' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Phone ─────────────────────────────────────────────────────────────────────

export function DebateDuelPhone({ phase, pd, hd, players, meId, sendAction }: {
  phase: string;
  pd: any;
  hd: any;
  players: Record<string, Player>;
  meId: string;
  sendAction: (action: any) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState(['', '']);
  const [sending, setSending] = useState<number | null>(null);
  const [pendingVote, setPendingVote] = useState<Side | null>(null);

  if (pd?.phase === 'OPENING' || pd?.phase === 'REBUTTAL') {
    const opening = pd.phase === 'OPENING';
    const submit = async (slot: number) => {
      const text = drafts[slot].trim();
      if (!text) return;
      setSending(slot);
      await sendAction({ type: opening ? 'SUBMIT_OPENING' : 'SUBMIT_REBUTTAL', slot, text });
      setSending(null);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="debate-phone-heading">{opening ? '🎤 Opening statements' : '🔥 Rebuttals'}</div>
        {(pd.cards || []).map((card: any, slot: number) => {
          const mine: string = card.sides[card.mySide];
          const theirs: string = card.sides[1 - card.mySide];
          const written: string = pd.written?.[slot];
          return (
            <div key={slot} className="player-prompt-card debate-phone-card" style={{ '--debate-color': SIDE_COLOR[card.mySide as Side] } as CSSProperties}>
              <div className="player-prompt-num" style={{ color: 'var(--party-text-muted)' }}>Debate {slot + 1}</div>
              <div className="player-prompt-text" style={{ marginBottom: '0.6rem' }}>{card.motion}</div>
              <div className="debate-phone-sides">
                <span className="debate-chip mine">You argue: {mine}</span>
                <span className="debate-chip">vs {theirs}</span>
              </div>
              {!opening && (
                <div className="debate-phone-quote">
                  <div className="debate-arg-label">They said ({theirs})</div>
                  “{card.theirOpening}”
                </div>
              )}
              {written ? (
                <>
                  <div className="debate-phone-quote mine">“{written}”</div>
                  <div className="player-submitted-badge">✅ Submitted!</div>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); submit(slot); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <textarea
                    className="party-input debate-phone-input"
                    value={drafts[slot]}
                    maxLength={MAX_ARGUMENT}
                    rows={3}
                    autoFocus={slot === 0}
                    placeholder={!opening ? 'Hit back…' : mine === 'For' ? 'Why it’s true…' : mine === 'Against' ? 'Why it’s nonsense…' : `Why ${mine} wins…`}
                    onChange={(e) => { const next = [...drafts]; next[slot] = e.target.value; setDrafts(next); }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button type="button" className="party-safety-btn" style={{ margin: 0, whiteSpace: 'nowrap' }}
                      onClick={() => { const next = [...drafts]; next[slot] = safetyArgument(); setDrafts(next); }}>🛟 Safety argument</button>
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--party-text-muted)' }}>{drafts[slot].length}/{MAX_ARGUMENT}</span>
                    <button type="submit" disabled={!drafts[slot].trim() || sending === slot} className="party-btn party-btn-primary party-btn-inline">Send</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (phase === 'VOTING' && hd?.sides) {
    const iAmDebating = pd?.phase === 'WAITING';
    const chosen: Side | null = pd?.votedSide ?? pendingVote;
    const vote = async (side: Side) => {
      setPendingVote(side);
      if (!(await sendAction({ type: 'SUBMIT_VOTE', side }))) setPendingVote(null);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div className="debate-phone-heading">
          {iAmDebating ? '🤫 Your debate is on! Others are judging.' : chosen !== null ? '✅ Vote in! Waiting for the others…' : '⚖️ Who argued better?'}
        </div>
        <div className="player-prompt-box" style={{ marginBottom: 0 }}>{hd.motion}</div>
        {([0, 1] as Side[]).map((side) => {
          const body = (
            <>
              <div className="debate-side-name" style={{ fontSize: '1.15rem' }}>
                {hd.sides[side]}{iAmDebating && pd?.mySide === side ? ' (you)' : ''}
              </div>
              <div className="debate-phone-arg"><b>Opening:</b> {hd.openings[side]}</div>
              <div className="debate-phone-arg"><b>Rebuttal:</b> {hd.rebuttals[side]}</div>
            </>
          );
          const style = { '--debate-color': SIDE_COLOR[side] } as CSSProperties;
          if (iAmDebating || !pd?.canVote) return <div key={side} className="debate-phone-vote" style={style}>{body}</div>;
          return (
            <button key={side} type="button" disabled={chosen !== null}
              className={`debate-phone-vote${chosen === side ? ' chosen' : ''}`} style={style} onClick={() => vote(side)}>
              {body}
            </button>
          );
        })}
      </div>
    );
  }

  if (phase === 'DEBATE_RESULTS' && hd?.sides) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div className="player-prompt-box" style={{ marginBottom: 0 }}>{hd.motion}</div>
        {hd.winnerSide === null && <div className="debate-phone-heading">🤝 Dead heat!</div>}
        {([0, 1] as Side[]).map((side) => {
          const p = players[hd.debaters?.[side]];
          const won = hd.winnerSide === side;
          return (
            <div key={side} className={`debate-phone-vote${won ? ' chosen' : ''}`} style={{ '--debate-color': SIDE_COLOR[side] } as CSSProperties}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <span className="debate-side-name" style={{ fontSize: '1.05rem' }}>{hd.sides[side]}</span>
                <span style={{ fontWeight: 900, color: 'var(--party-yellow)' }}>
                  {hd.tally?.[side] ?? 0} vote{hd.tally?.[side] === 1 ? '' : 's'}{hd.micDrop === side ? ' 💥' : won ? ' 🏆' : ''}
                </span>
              </div>
              <div style={{ fontWeight: 900, color: p?.avatarColor }}>
                {p?.avatar} {p?.name}{p?.id === meId ? ' (you)' : ''} · +{(hd.points?.[side] ?? 0).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}
