'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { VoterFaces } from './HostShow';
import { MAX_SWITCH_WORD, cleanSwitchWord, isSwitchable } from '@/lib/party/debate-words';

// Debate Duel's screens: the TV for each phase, the phone for writing a hot
// take, debating, picking a side, switching a word and heckling, and the heckle
// box the audience uses too. The game itself is lib/party/games/debate-duel.ts.

type Player = { id: string; name: string; score: number; avatar?: string; avatarColor: string; left?: boolean };
type Side = 0 | 1;
type SwitchInfo = { index: number; from: string; to: string; by: string; byName?: string | null };
type Heckle = { id: number; name: string; text: string };

const SIDE_LABEL = ['Pro', 'Con'] as const;
const SIDE_COLOR = ['var(--party-cyan)', 'var(--party-pink)'] as const;
const sideStyle = (side: Side) => ({ '--debate-color': SIDE_COLOR[side] } as CSSProperties);
const MAX_LINE = 120; // the server trims free text to this
const MAX_TOPIC = 100;
const QUICK_HECKLES = ['Objection!', 'Source?', 'Boo! 🍅', 'Wrong!', 'Says who?', 'Get to the point!', 'Louder!', 'Nobody believes you'];
const TOPIC_IDEAS = [
  'Socks should come in packs of three',
  'Every car horn should play a song',
  'Cats should be allowed to vote',
  'Breakfast is the worst meal',
  'Elevators need a dance floor',
];

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

/** The topic, with a switched word struck out and its replacement highlighted. */
function Topic({ words, sw, className = 'debate-motion', animate = false }: { words: string[]; sw?: SwitchInfo | null; className?: string; animate?: boolean }) {
  return (
    <div className={className}>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {sw && sw.index === i ? (
            <span className={`debate-switched${animate ? ' animate' : ''}`} key={`${i}-${sw.to}`}><s>{sw.from}</s> <span className="debate-switched-new">{w}</span></span>
          ) : w}
        </span>
      ))}
    </div>
  );
}

function Who({ p, side, size = '1.4rem' }: { p?: Player; side: Side; size?: string }) {
  return (
    <span style={{ fontFamily: 'var(--party-font-display)', fontWeight: 900, fontSize: size }}>
      <span style={{ color: SIDE_COLOR[side] }}>{SIDE_LABEL[side].toUpperCase()}</span>{' '}
      <span style={{ color: p?.avatarColor }}>{p?.avatar} {p?.name || '?'}</span>
    </span>
  );
}

/** "Debate 1 of 3 · Round 2", the topic, and who wrote it. */
function DebateHeader({ h, players, topicClass }: { h: any; players: Record<string, Player>; topicClass?: string }) {
  const author = players[h.author];
  return (
    <>
      <div className="debate-motion-label">
        {h.totalRounds > 1 ? `Round ${h.round} of ${h.totalRounds} · ` : ''}Debate {h.matchNumber} of {h.totalMatches}
        {h.debateRound ? ` · ${h.debateRound === 1 ? 'Opening speeches' : 'After the switch'}` : ''}
      </div>
      <Topic words={h.words} sw={h.switch} className={topicClass} />
      {author && <div className="debate-author">Hot take by {author.avatar} {author.name}{h.switch?.byName ? ` · switched by ${h.switch.byName}` : ''}</div>}
    </>
  );
}

// ─── TV ────────────────────────────────────────────────────────────────────────

export function DebateDuelHost({ state, secondsLeft, pct }: {
  state: { phase: string; players: Record<string, Player>; playerData: Record<string, any>; hostData: any };
  secondsLeft: number | null;
  pct: number;
}) {
  const h = state.hostData || {};
  const players = state.players;
  const seated = Object.values(players).filter((p) => !p.left);
  const debaters: string[] = h.debaters || [];

  if (state.phase === 'TOPIC') {
    return (
      <div className="host-prompting phase-enter">
        {h.totalRounds > 1 && <div className="debate-motion-label">Round {h.round} of {h.totalRounds}</div>}
        <div className="host-phase-title">Write a Hot Take</div>
        <p className="host-prompting-sub">
          {h.again ? 'Nobody’s written one yet! Every debate needs a topic from you.' : 'A goofy opinion someone will have to defend. Type it on your phone!'}
        </p>
        <Timer secondsLeft={secondsLeft} pct={pct} width={600} />
        <div className="host-player-status-grid">
          {seated.map((p) => {
            const done = Boolean(state.playerData[p.id]?.topic);
            return (
              <div key={p.id} className="host-player-status">
                <div className={`host-player-status-dot ${done ? 'done' : 'waiting'}`}>{done ? '✓' : p.name.charAt(0)}</div>
                <span>{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!h.words) return null;
  const floor = <CrowdFloor crowd={h.crowd || {}} debaters={debaters} players={players} />;

  if (state.phase === 'UP_NEXT') {
    const side = h.speakerSide as Side;
    return (
      <div className="debate-stage phase-enter">
        <DebateHeader h={h} players={players} />
        <div className="debate-columns debate-lineup">
          {([0, 1] as Side[]).map((s) => (
            <div key={s} className={`debate-side debate-side-result${s === side ? ' up' : ' dim'}`} style={sideStyle(s)}>
              <div className="debate-side-name">{SIDE_LABEL[s]}</div>
              <div className="debate-result-who" style={{ color: players[debaters[s]]?.avatarColor }}>{players[debaters[s]]?.avatar} {players[debaters[s]]?.name}</div>
              {s === side && <div className="debate-badge">🎤 UP NEXT</div>}
            </div>
          )).flatMap((el, i) => (i ? [<div key="vs" className="debate-vs">VS</div>, el] : [el]))}
        </div>
        <div className="debate-getready">
          {players[h.speakerId]?.name}, argue {SIDE_LABEL[side].toUpperCase()} out loud. Starting in {secondsLeft !== null ? Math.ceil(secondsLeft) : ''}…
        </div>
        {floor}
      </div>
    );
  }

  if (state.phase === 'PITCH') {
    const side = h.speakerSide as Side;
    return (
      <div className="debate-stage debate-pitch phase-enter" style={sideStyle(side)}>
        <HeckleColumns heckles={h.heckles || []}>
          <div className="debate-speaker">
            <Who p={players[h.speakerId]} side={side} size="clamp(1.4rem, 2.6vw, 2.2rem)" />
            <div className={`debate-clock${secondsLeft !== null && secondsLeft <= 5 ? ' low' : ''}`}>{secondsLeft !== null ? Math.ceil(secondsLeft) : ''}</div>
          </div>
          <DebateHeader h={h} players={players} topicClass="debate-motion debate-motion-live" />
          {h.typed?.length > 0 && (
            <div className="debate-typed">
              {h.typed.map((t: string, i: number) => <div key={i} className="debate-typed-line">“{t}”</div>)}
            </div>
          )}
        </HeckleColumns>
        {floor}
      </div>
    );
  }

  if (state.phase === 'SWITCH') {
    return (
      <div className="debate-stage phase-enter">
        {/* The title's gradient text would paint over the emoji, so it keeps its own colours. */}
        <div className="host-phase-title"><span className="host-emoji">🔀</span> Switch It Up!</div>
        <DebateHeader h={h} players={players} />
        <p className="host-prompting-sub" style={{ marginTop: '1rem' }}>
          Pick a word on your phone and change it. One edit gets chosen, and the debaters go again on whatever it becomes.
        </p>
        <Timer secondsLeft={secondsLeft} pct={pct} />
        <div className="debate-getready">{h.proposed || 0} of {seated.length} in</div>
        {floor}
      </div>
    );
  }

  if (state.phase === 'SWITCH_REVEAL') {
    const others = (h.options || []).filter((o: any) => !o.chosen);
    return (
      <div className="debate-stage phase-enter">
        <div className="debate-switch-line hit" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', marginBottom: '0.75rem' }}>
          {h.switch ? `🔀 Switched by ${h.switch.byName}!` : '🤷 Nobody switched it. Same topic, round two!'}
        </div>
        <Topic words={h.words} sw={h.switch} className="debate-motion debate-motion-live" animate />
        {others.length > 0 && (
          <div className="debate-other-edits">
            <div className="debate-arg-label">What it could have been</div>
            {others.slice(0, 4).map((o: any, i: number) => <div key={i} className="debate-other-edit">“{o.text}” <span>· {o.byName}</span></div>)}
          </div>
        )}
        {floor}
      </div>
    );
  }

  if (state.phase === 'VERDICT') {
    return (
      <div className="debate-stage phase-enter">
        <div className="host-phase-title">{h.mode === 'rate' ? 'Rate the Debate' : 'Final Call!'}</div>
        <DebateHeader h={h} players={players} />
        <p className="host-prompting-sub" style={{ marginTop: '1rem' }}>
          {h.mode === 'rate' ? 'Debaters: rate each other on your phones!' : 'Lock in your side on your phone. Where you stand is your vote.'}
        </p>
        <Timer secondsLeft={secondsLeft} pct={pct} />
        {floor}
      </div>
    );
  }

  if (state.phase === 'VERDICT_RESULTS') {
    return (
      <div className="debate-stage phase-enter">
        <DebateHeader h={h} players={players} />
        {h.winnerSide === null && <div className="debate-verdict">🤝 Dead heat!</div>}
        <div className="debate-columns" style={{ marginTop: '1rem' }}>
          {([0, 1] as Side[]).map((s) => {
            const p = players[debaters[s]];
            const won = h.winnerSide === s;
            return (
              <div key={s} className={`debate-side debate-side-result${won ? ' winner' : ''}`} style={sideStyle(s)}>
                <div className="debate-side-name">{SIDE_LABEL[s]}</div>
                <div className="debate-result-who" style={{ color: p?.avatarColor }}>{p?.avatar} {p?.name}</div>
                <div className="debate-result-votes">
                  <span className="host-result-votes-num">{h.mode === 'rate' ? `${'★'.repeat(h.tally[s])}${'☆'.repeat(5 - h.tally[s])}` : h.tally[s]}</span>
                  <span className="host-result-votes-label">{h.mode === 'rate' ? '' : `on their side · `}+{(h.points?.[s] ?? 0).toLocaleString()}</span>
                </div>
                <VoterFaces ids={h.voters?.[s]} players={players} />
                {h.micDrop === s && <div className="debate-badge">💥 MIC DROP</div>}
                {won && h.micDrop !== s && <div className="debate-badge">🏆 WINNER</div>}
                {h.audienceTally && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--party-cyan)', fontWeight: 800, marginTop: '0.5rem' }}>
                    👀 {h.audienceTally[s] || 0} audience{h.audienceFavorite === s ? ' · favorite +250' : ''}
                  </div>
                )}
              </div>
            );
          }).flatMap((el, i) => (i ? [<div key="vs" className="debate-vs">VS</div>, el] : [el]))}
        </div>
      </div>
    );
  }

  return null;
}

/**
 * The room's floor: everyone not debating stands on the Pro side, the Con
 * side, or in the middle, and runs across as they change their mind.
 */
function CrowdFloor({ crowd, debaters, players }: { crowd: Record<string, Side>; debaters: string[]; players: Record<string, Player> }) {
  const people = Object.values(players).filter((p) => !p.left && !debaters.includes(p.id));
  if (!people.length) return null;
  const groups: Record<'0' | '1' | 'mid', Player[]> = { 0: [], 1: [], mid: [] };
  for (const p of people) groups[crowd[p.id] === 0 ? 0 : crowd[p.id] === 1 ? 1 : 'mid'].push(p);
  // Where each person stands: rows of four, filling in from the outer edge of their side.
  const spot = (group: '0' | '1' | 'mid', i: number) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = group === '0' ? 4 + col * 8 : group === '1' ? 92 - col * 8 : 42 + (i % 3) * 8;
    return { left: `${x}%`, top: `${18 + row * 34}%` };
  };
  return (
    <div className="debate-floor">
      <div className="debate-floor-zone pro" style={sideStyle(0)}><span>PRO</span><b>{groups[0].length}</b></div>
      <div className="debate-floor-zone mid"><span>Undecided</span></div>
      <div className="debate-floor-zone con" style={sideStyle(1)}><span>CON</span><b>{groups[1].length}</b></div>
      {(['0', '1', 'mid'] as const).flatMap((g) => groups[g].map((p, i) => (
        <div key={p.id} className="debate-floor-person" style={{ ...spot(g, i), borderColor: p.avatarColor }} title={p.name}>
          <span className="debate-floor-avatar">{p.avatar || p.name.charAt(0)}</span>
          <span className="debate-floor-name">{p.name}</span>
        </div>
      )))}
    </div>
  );
}

const HECKLE_SHOWN_MS = 7000;
const HECKLES_PER_SIDE = 4;

/** Heckles from the last few seconds, newest last (the server only keeps a list, so the age is tracked here). */
function useFreshHeckles(heckles: Heckle[]): Heckle[] {
  const [arrived, setArrived] = useState<Record<number, number>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = Date.now();
    setArrived((prev) => {
      const missing = heckles.filter((hk) => !(hk.id in prev));
      return missing.length ? { ...prev, ...Object.fromEntries(missing.map((hk) => [hk.id, at])) } : prev;
    });
    setNow(at);
    if (!heckles.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [heckles]);
  return heckles.filter((hk) => hk.id in arrived && now - arrived[hk.id] < HECKLE_SHOWN_MS);
}

/** Heckles pop up in the columns either side of the speaker (never over them), then fade away. */
function HeckleColumns({ heckles, children }: { heckles: Heckle[]; children: ReactNode }) {
  const fresh = useFreshHeckles(heckles);
  const column = (odd: number) => (
    <div className="debate-heckle-col" aria-live="polite">
      {fresh.filter((hk) => hk.id % 2 === odd).slice(-HECKLES_PER_SIDE).map((hk) => (
        <div key={hk.id} className="debate-heckle" style={{ '--tilt': `${((hk.id * 7) % 7) - 3}deg` } as CSSProperties}>
          <span className="debate-heckle-name">{hk.name}</span>{hk.text}
        </div>
      ))}
    </div>
  );
  return (
    <div className="debate-pitch-grid">
      {column(1)}
      <div className="debate-pitch-center">{children}</div>
      {column(0)}
    </div>
  );
}

/** The latest heckles on a debater's phone: ammo for their argument. */
function HeckleFeed({ heckles }: { heckles: Heckle[] }) {
  const fresh = useFreshHeckles(heckles).slice(-3);
  if (!fresh.length) return null;
  return (
    <div className="debate-heckle-feed" aria-live="polite">
      {fresh.map((hk) => <div key={hk.id} className="debate-heckle small"><span className="debate-heckle-name">{hk.name}</span>{hk.text}</div>)}
    </div>
  );
}

// ─── Heckling (players and audience) ───────────────────────────────────────────

export function HeckleBox({ speaker, proposition, onSend }: { speaker: string; proposition?: string; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [cooling, setCooling] = useState(false);
  const [sent, setSent] = useState(0);

  const send = async (value: string) => {
    const t = value.trim();
    if (!t || cooling) return;
    setCooling(true);
    if (await onSend(t)) { setSent((n) => n + 1); setText(''); }
    setTimeout(() => setCooling(false), 2500);
  };

  return (
    <div className="debate-heckle-box">
      <div className="debate-phone-heading">📢 Heckle {speaker}!</div>
      {proposition && <div className="debate-phone-quote" style={{ textAlign: 'center' }}>{proposition}</div>}
      <div className="debate-quick-heckles">
        {QUICK_HECKLES.map((q) => (
          <button key={q} type="button" className="debate-chip" disabled={cooling} onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} style={{ display: 'flex', gap: '0.5rem' }}>
        <input className="party-input" style={{ padding: '0.7rem 0.9rem' }} value={text} maxLength={60} placeholder="Shout something…" enterKeyHint="send"
          onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim() || cooling} className="party-btn party-btn-primary party-btn-inline">Send</button>
      </form>
      {sent > 0 && <div className="player-waiting-sub" style={{ textAlign: 'center' }}>{cooling ? 'On the TV! Catch your breath…' : `${sent} heckle${sent === 1 ? '' : 's'} sent`}</div>}
    </div>
  );
}

// ─── Phone ─────────────────────────────────────────────────────────────────────

/** Pro or Con: tap to move to that side of the floor (tap again to change your mind). */
function SidePicker({ current, onPick, lockLabel }: { current: Side | null; onPick: (side: Side) => void; lockLabel?: boolean }) {
  return (
    <div className="debate-side-picker">
      {([0, 1] as Side[]).map((s) => (
        <button key={s} type="button" className={`debate-side-btn${current === s ? ' on' : ''}`} style={sideStyle(s)} onClick={() => onPick(s)} aria-pressed={current === s}>
          {lockLabel ? `🔒 Lock in ${SIDE_LABEL[s].toUpperCase()}` : current === s ? `✓ I’m ${SIDE_LABEL[s].toUpperCase()}` : `I’m ${SIDE_LABEL[s].toUpperCase()}`}
        </button>
      ))}
    </div>
  );
}

export function DebateDuelPhone({ phase, pd, hd, players, meId, secondsLeft, sendAction }: {
  phase: string;
  pd: any;
  hd: any;
  players: Record<string, Player>;
  meId: string;
  secondsLeft: number | null;
  sendAction: (action: any) => Promise<boolean>;
}) {
  const [topic, setTopic] = useState('');
  const [line, setLine] = useState('');
  const [pickedWord, setPickedWord] = useState<number | null>(null);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  // Optimistic: the side shows as picked straight away, then the server confirms.
  const [mySideChoice, setMySideChoice] = useState<Side | null>(null);
  const [idea] = useState(() => TOPIC_IDEAS[Math.floor(Math.random() * TOPIC_IDEAS.length)]);

  const debaters: string[] = hd?.debaters || [];
  const mySide: Side | null = pd?.mySide ?? null;
  const standing: Side | null = hd?.crowd?.[meId] ?? mySideChoice;
  const pickSide = (side: Side) => { setMySideChoice(side); sendAction({ type: 'SUBMIT_SIDE', side }); };
  const secs = secondsLeft !== null ? Math.ceil(secondsLeft) : '';

  if (pd?.phase === 'TOPIC') {
    if (pd.topic) {
      return (
        <div className="debate-phone-center">
          <div className="debate-phone-heading">🔥 Your hot take is in</div>
          <div className="player-prompt-box debate-phone-prop">{pd.topic}</div>
          <p className="player-waiting-sub">Someone might have to defend it. Maybe you.</p>
        </div>
      );
    }
    return (
      <div className="debate-phone-center">
        <div className="debate-phone-heading">🔥 Write a hot take</div>
        <p className="player-waiting-sub" style={{ marginTop: 0 }}>A goofy opinion worth arguing about. It becomes a debate topic.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (topic.trim()) sendAction({ type: 'SUBMIT_TOPIC', text: topic.trim() }); }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
          <textarea className="party-input debate-phone-input" value={topic} maxLength={MAX_TOPIC} rows={3} autoFocus
            placeholder={`e.g. ${idea}`} onChange={(e) => setTopic(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--party-text-muted)' }}>{topic.length}/{MAX_TOPIC}</span>
            <button type="submit" disabled={!topic.trim()} className="party-btn party-btn-primary party-btn-inline" style={{ marginLeft: 'auto' }}>Submit</button>
          </div>
        </form>
      </div>
    );
  }

  if (!hd?.words) return null;
  const topicBox = <Topic words={hd.words} sw={hd.switch} className="player-prompt-box debate-phone-prop" />;

  if (phase === 'UP_NEXT') {
    const side = hd.speakerSide as Side;
    const me = hd.speakerId === meId;
    return (
      <div className="debate-phone-center" style={sideStyle(side)}>
        <div className="debate-motion-label">Debate {hd.matchNumber} of {hd.totalMatches} · {hd.debateRound === 1 ? 'Opening speeches' : 'After the switch'}</div>
        {me ? (
          <>
            <div className="debate-phone-big">🎤 You’re up!</div>
            <div className="debate-chip mine" style={{ fontSize: '1rem' }}>Argue {SIDE_LABEL[side].toUpperCase()}</div>
          </>
        ) : (
          <div className="debate-phone-heading"><Who p={players[hd.speakerId]} side={side} size="1.15rem" /> is up next</div>
        )}
        {topicBox}
        {mySide === null ? (
          <>
            <p className="player-waiting-sub">Which side are you on? Change it any time.</p>
            <SidePicker current={standing} onPick={pickSide} />
          </>
        ) : (
          <p className="player-waiting-sub">{me ? `Talk out loud for ${hd.debateRound === 1 ? 30 : 20} seconds. Win the room over!` : 'You’re in this debate. Watch your rival, then it’s your turn.'}</p>
        )}
      </div>
    );
  }

  if (phase === 'PITCH') {
    const side = hd.speakerSide as Side;
    if (hd.speakerId === meId) {
      return (
        <div className="debate-phone-center" style={sideStyle(side)}>
          <div className="debate-phone-big">🎤 TALK! <span style={{ color: SIDE_COLOR[side] }}>{SIDE_LABEL[side].toUpperCase()}</span></div>
          <div className="debate-clock small">{secs}</div>
          {topicBox}
          <HeckleFeed heckles={hd.heckles || []} />
          <details className="debate-type-instead">
            <summary>Can’t talk? Type it instead</summary>
            {(hd.typed || []).map((t: string, i: number) => <div key={i} className="debate-phone-quote mine">“{t}”</div>)}
            <form onSubmit={async (e) => { e.preventDefault(); if (!line.trim()) return; if (await sendAction({ type: 'SUBMIT_PITCH_LINE', text: line.trim() })) setLine(''); }}
              style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="party-input" style={{ padding: '0.7rem 0.9rem' }} value={line} maxLength={MAX_LINE} placeholder="Your point…" enterKeyHint="send" onChange={(e) => setLine(e.target.value)} />
              <button type="submit" disabled={!line.trim()} className="party-btn party-btn-primary party-btn-inline">Send</button>
            </form>
          </details>
          <button type="button" className="party-btn party-btn-outline" style={{ marginTop: '0.5rem' }} onClick={() => sendAction({ type: 'SUBMIT_PITCH_DONE' })}>✋ I rest my case</button>
        </div>
      );
    }
    if (mySide !== null) {
      return (
        <div className="debate-phone-center">
          <div className="debate-phone-heading"><Who p={players[hd.speakerId]} side={side} size="1.1rem" /> is talking · {secs}s</div>
          {topicBox}
          <HeckleFeed heckles={hd.heckles || []} />
          <p className="player-waiting-sub">Your turn’s coming. The heckles are fair game to use.</p>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div className="debate-phone-heading" style={sideStyle(side)}><Who p={players[hd.speakerId]} side={side} size="1.1rem" /> is talking · {secs}s</div>
        {topicBox}
        <SidePicker current={standing} onPick={pickSide} />
        <HeckleBox speaker={players[hd.speakerId]?.name || 'them'} onSend={(text) => sendAction({ type: 'SUBMIT_HECKLE', text })} />
      </div>
    );
  }

  if (phase === 'SWITCH') {
    const sendSwitch = async () => {
      const word = cleanSwitchWord(replacement);
      if (pickedWord === null || !word) return;
      setBusy(true);
      await sendAction({ type: 'SUBMIT_SWITCH', index: pickedWord, word });
      setBusy(false);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div className="debate-phone-heading">🔀 Switch it up!</div>
        {pd?.proposed ? (
          <>
            {topicBox}
            <p className="player-waiting-sub" style={{ textAlign: 'center' }}>You’re in! One edit gets picked…</p>
          </>
        ) : (
          <div className="debate-switch-card">
            <div className="debate-arg-label" style={{ textAlign: 'center' }}>Tap a word, then change it · {secs}s</div>
            <div className="debate-word-picker">
              {hd.words.map((w: string, i: number) => {
                const can = isSwitchable(w);
                return (
                  <button key={i} type="button" disabled={!can} className={`debate-word${can ? ' can' : ''}${pickedWord === i ? ' picked' : ''}`}
                    onClick={() => { setPickedWord(i); setReplacement(''); }}>
                    {w}
                  </button>
                );
              })}
            </div>
            {pickedWord !== null && (
              <form onSubmit={(e) => { e.preventDefault(); sendSwitch(); }} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <input className="party-input" style={{ padding: '0.7rem 0.9rem' }} value={replacement} maxLength={MAX_SWITCH_WORD} autoFocus
                  placeholder={`Instead of “${hd.words[pickedWord]}”…`} enterKeyHint="send" onChange={(e) => setReplacement(e.target.value)} />
                <button type="submit" disabled={!cleanSwitchWord(replacement) || busy} className="party-btn party-btn-primary party-btn-inline">Switch!</button>
              </form>
            )}
            <button type="button" className="party-safety-btn" style={{ display: 'block', margin: '0.6rem auto 0' }} onClick={() => sendAction({ type: 'SUBMIT_SWITCH', pass: true })}>Leave it as it is</button>
          </div>
        )}
        {mySide === null && <SidePicker current={standing} onPick={pickSide} />}
      </div>
    );
  }

  if (phase === 'SWITCH_REVEAL') {
    return (
      <div className="debate-phone-center">
        <div className="debate-phone-heading">{hd.switch ? `🔀 Switched by ${hd.switch.byName}!` : '🤷 Same topic, round two!'}</div>
        <Topic words={hd.words} sw={hd.switch} className="player-prompt-box debate-phone-prop" animate />
        {mySide !== null
          ? <p className="player-waiting-sub">Argue {SIDE_LABEL[mySide].toUpperCase()} on this. Think fast!</p>
          : <SidePicker current={standing} onPick={pickSide} />}
      </div>
    );
  }

  if (phase === 'VERDICT') {
    const chosen = pd?.chosen ?? pending;
    if (pd?.canRate && mySide !== null) {
      const other = (1 - mySide) as Side;
      const rate = async (n: number) => { setPending(n); if (!(await sendAction({ type: 'SUBMIT_RATING', stars: n }))) setPending(null); };
      return (
        <div className="debate-phone-center" style={sideStyle(other)}>
          <div className="debate-phone-heading">⭐ Rate <Who p={players[debaters[other]]} side={other} size="1.1rem" /></div>
          {topicBox}
          <div className="debate-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" disabled={chosen !== null} className={chosen !== null && n <= chosen ? 'on' : ''}
                onClick={() => rate(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}>★</button>
            ))}
          </div>
          <p className="player-waiting-sub">{chosen !== null ? 'Rated! Waiting for theirs…' : 'Be honest. They’re rating you too.'}</p>
        </div>
      );
    }
    if (pd?.canVote) {
      const lock = async (side: Side) => { setPending(side); if (!(await sendAction({ type: 'SUBMIT_VOTE', side }))) setPending(null); };
      return (
        <div className="debate-phone-center">
          <div className="debate-phone-heading">{chosen !== null ? `🔒 Locked in: ${SIDE_LABEL[chosen as Side].toUpperCase()}` : '⚖️ Final call! Who won you over?'}</div>
          {topicBox}
          {chosen === null && (
            <>
              <p className="player-waiting-sub">{standing !== null ? `You’re standing with ${SIDE_LABEL[standing].toUpperCase()}.` : 'You haven’t picked a side yet.'}</p>
              <SidePicker current={standing} onPick={lock} lockLabel />
            </>
          )}
        </div>
      );
    }
    return (
      <div className="debate-phone-center">
        <div className="player-look-tv-icon">⚖️</div>
        <div className="debate-phone-heading">{mySide !== null ? 'The room is making up its mind…' : 'The debaters are rating each other…'}</div>
      </div>
    );
  }

  if (phase === 'VERDICT_RESULTS') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {topicBox}
        {hd.winnerSide === null && <div className="debate-phone-heading">🤝 Dead heat!</div>}
        {([0, 1] as Side[]).map((s) => {
          const p = players[debaters[s]];
          const won = hd.winnerSide === s;
          return (
            <div key={s} className={`debate-phone-vote${won ? ' chosen' : ''}`} style={sideStyle(s)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <Who p={p} side={s} size="1.05rem" />
                <span style={{ fontWeight: 900, color: 'var(--party-yellow)', whiteSpace: 'nowrap' }}>
                  {hd.mode === 'rate' ? '★'.repeat(hd.tally?.[s] ?? 0) || '—' : `${hd.tally?.[s] ?? 0} on side`}{hd.micDrop === s ? ' 💥' : won ? ' 🏆' : ''}
                </span>
              </div>
              <div style={{ fontWeight: 800, color: 'var(--party-text-muted)' }}>{p?.id === meId ? 'You · ' : ''}+{(hd.points?.[s] ?? 0).toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}
