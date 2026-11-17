'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { VoterFaces } from './HostShow';
import { MAX_SWITCH_WORD, cleanSwitchWord, isSwitchable } from '@/lib/party/debate-words';

// Debate Duel's screens: the TV for each phase, the phone for suggesting,
// pitching, switching, heckling and judging, and the heckle box the audience
// uses too. The game itself is lib/party/games/debate-duel.ts.

type Player = { id: string; name: string; score: number; avatar?: string; avatarColor: string; left?: boolean };
type Side = 0 | 1;
type SwitchInfo = { index: number; from: string; to: string; by: string | null; byName?: string | null };
type PitchSummary = { words: string[]; switch: SwitchInfo | null; typed: string[] };

const SIDE_LABEL = ['Pro', 'Con'] as const;
const SIDE_COLOR = ['var(--party-cyan)', 'var(--party-pink)'] as const;
const sideStyle = (side: Side) => ({ '--debate-color': SIDE_COLOR[side] } as CSSProperties);
const PITCH_SECONDS = 30;
const SWITCH_OPENS_AFTER = 8;
const MAX_LINE = 120; // the server trims free text to this
const QUICK_HECKLES = ['Objection!', 'Source?', 'Boo! 🍅', 'Wrong!', 'Says who?', 'Get to the point!', 'Louder!', 'Nobody believes you'];

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

/** The proposition, with a switched word struck out and its replacement highlighted. */
function Proposition({ words, sw, className = 'debate-motion' }: { words: string[]; sw?: SwitchInfo | null; className?: string }) {
  return (
    <div className={className}>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {sw && sw.index === i ? (
            <span className="debate-switched" key={`${i}-${sw.to}`}><s>{sw.from}</s> <span className="debate-switched-new">{w}</span></span>
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

function switchLine(sw: SwitchInfo | null | undefined, elapsed: number | null) {
  if (sw) return sw.byName ? `🔀 SWITCHED by ${sw.byName}!` : '🔀 SWITCHED! The house changed the topic.';
  if (elapsed !== null && elapsed < SWITCH_OPENS_AFTER) return `🔀 The switch opens in ${Math.ceil(SWITCH_OPENS_AFTER - elapsed)}…`;
  return '🔀 The switch is open! Swap a word on your phone.';
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
  const label = h.totalMatches ? (
    <div className="debate-motion-label">
      {h.totalRounds > 1 ? `Round ${h.round} of ${h.totalRounds} · ` : ''}Debate {h.matchNumber} of {h.totalMatches}
    </div>
  ) : null;

  if (state.phase === 'SUGGEST') {
    return (
      <div className="host-prompting phase-enter">
        {h.totalRounds > 1 && <div className="debate-motion-label">Round {h.round} of {h.totalRounds}</div>}
        <div className="host-phase-title">Feed the Debate</div>
        <p className="host-prompting-sub">Type two things, people or places on your phone. They’ll turn up in the debates…</p>
        <Timer secondsLeft={secondsLeft} pct={pct} width={600} />
        <div className="host-player-status-grid">
          {seated.map((p) => {
            const done = (state.playerData[p.id]?.written || []).filter(Boolean).length;
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

  if (state.phase === 'UP_NEXT' && h.proposition) {
    const side = h.speakerSide as Side;
    return (
      <div className="debate-stage phase-enter">
        {label}
        <Proposition words={h.proposition} />
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
      </div>
    );
  }

  if (state.phase === 'PITCH' && h.words) {
    const side = h.speakerSide as Side;
    const elapsed = secondsLeft !== null ? PITCH_SECONDS - secondsLeft : null;
    return (
      <div className="debate-stage debate-pitch phase-enter" style={sideStyle(side)}>
        {label}
        <HeckleColumns heckles={h.heckles || []}>
          <div className="debate-speaker">
            <Who p={players[h.speakerId]} side={side} size="clamp(1.4rem, 2.6vw, 2.2rem)" />
            <div className={`debate-clock${secondsLeft !== null && secondsLeft <= 5 ? ' low' : ''}`}>{secondsLeft !== null ? Math.ceil(secondsLeft) : ''}</div>
          </div>
          <Proposition words={h.words} sw={h.switch} className="debate-motion debate-motion-live" />
          <div className={`debate-switch-line${h.switch ? ' hit' : ''}`} key={h.switch ? 'hit' : 'wait'}>{switchLine(h.switch, elapsed)}</div>
          {h.typed?.length > 0 && (
            <div className="debate-typed">
              {h.typed.map((t: string, i: number) => <div key={i} className="debate-typed-line">“{t}”</div>)}
            </div>
          )}
        </HeckleColumns>
      </div>
    );
  }

  if ((state.phase === 'VERDICT' || state.phase === 'VERDICT_RESULTS') && h.pitches) {
    const results = state.phase === 'VERDICT_RESULTS';
    return (
      <div className="debate-stage phase-enter">
        {label}
        <Proposition words={h.proposition} />
        {!results && <Timer secondsLeft={secondsLeft} pct={pct} />}
        {results && h.winnerSide === null && <div className="debate-verdict">🤝 Dead heat!</div>}
        <div className="debate-columns">
          {([0, 1] as Side[]).map((s) => {
            const p = players[debaters[s]];
            const pitch: PitchSummary = h.pitches[s];
            const won = results && h.winnerSide === s;
            return (
              <div key={s} className={`debate-side debate-side-result${won ? ' winner' : ''}`} style={sideStyle(s)}>
                <div className="debate-side-name">{SIDE_LABEL[s]}</div>
                <div className="debate-result-who" style={{ color: p?.avatarColor }}>{p?.avatar} {p?.name}</div>
                <div className="debate-argued">
                  argued: <Proposition words={pitch.words} sw={pitch.switch} className="debate-argued-text" />
                </div>
                {results && (
                  <>
                    <div className="debate-result-votes">
                      <span className="host-result-votes-num">{h.mode === 'rate' ? `${'★'.repeat(h.tally[s])}${'☆'.repeat(5 - h.tally[s])}` : h.tally[s]}</span>
                      <span className="host-result-votes-label">{h.mode === 'rate' ? '' : `vote${h.tally[s] === 1 ? '' : 's'} · `}+{(h.points?.[s] ?? 0).toLocaleString()}</span>
                    </div>
                    <VoterFaces ids={h.voters?.[s]} players={players} />
                    {h.micDrop === s && <div className="debate-badge">💥 MIC DROP</div>}
                    {won && h.micDrop !== s && <div className="debate-badge">🏆 WINNER</div>}
                    {h.audienceTally && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--party-cyan)', fontWeight: 800, marginTop: '0.5rem' }}>
                        👀 {h.audienceTally[s] || 0} audience{h.audienceFavorite === s ? ' · favorite +250' : ''}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          }).flatMap((el, i) => (i ? [<div key="vs" className="debate-vs">VS</div>, el] : [el]))}
        </div>
        {!results && (
          <p className="host-prompting-sub" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
            {h.mode === 'rate' ? 'Debaters: rate each other’s pitch on your phones!' : 'Vote on your phones: who argued it better?'}
          </p>
        )}
      </div>
    );
  }

  return null;
}

type Heckle = { id: number; name: string; text: string };
const HECKLE_SHOWN_MS = 7000;
const HECKLES_PER_SIDE = 4;

/** Heckles pop up in the columns either side of the speaker (never over them), then fade away. */
function HeckleColumns({ heckles, children }: { heckles: Heckle[]; children: ReactNode }) {
  // When each heckle first arrived here, so old ones can go (the server only keeps a list).
  const seen = useRef(new Map<number, number>());
  const [now, setNow] = useState(() => Date.now());
  for (const hk of heckles) if (!seen.current.has(hk.id)) seen.current.set(hk.id, Date.now());
  useEffect(() => {
    if (!heckles.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [heckles.length]);

  const fresh = heckles.filter((hk) => now - (seen.current.get(hk.id) ?? now) < HECKLE_SHOWN_MS);
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

export function DebateDuelPhone({ phase, pd, hd, players, meId, secondsLeft, sendAction }: {
  phase: string;
  pd: any;
  hd: any;
  players: Record<string, Player>;
  meId: string;
  secondsLeft: number | null;
  sendAction: (action: any) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState(['', '']);
  const [line, setLine] = useState('');
  const [pickedWord, setPickedWord] = useState<number | null>(null);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  // A switch that lands (anyone's) closes the picker.
  useEffect(() => { if (hd?.switch) setPickedWord(null); }, [hd?.switch]);

  const debaters: string[] = hd?.debaters || [];
  const mySide: Side | null = pd?.mySide ?? null;

  if (pd?.phase === 'SUGGEST') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="debate-phone-heading">💡 Feed the debate</div>
        <p className="player-waiting-sub" style={{ marginTop: 0 }}>Two things, people or places. The sillier the better. They might end up in your own debate!</p>
        {[0, 1].map((slot) => (
          <div key={slot} className="player-prompt-card" style={{ marginBottom: 0 }}>
            {pd.written?.[slot] ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 800 }}>{pd.written[slot]}</span><span>✅</span>
              </div>
            ) : (
              <form className="player-answer-row" onSubmit={(e) => { e.preventDefault(); if (drafts[slot].trim()) sendAction({ type: 'SUBMIT_SUGGESTION', slot, text: drafts[slot].trim() }); }}>
                <input className="party-input" style={{ padding: '0.7rem 0.9rem' }} value={drafts[slot]} maxLength={30} autoFocus={slot === 0}
                  placeholder={slot === 0 ? 'e.g. traffic cones' : 'e.g. my landlord'} enterKeyHint="send"
                  onChange={(e) => { const next = [...drafts]; next[slot] = e.target.value; setDrafts(next); }} />
                <button type="submit" disabled={!drafts[slot].trim()} className="party-btn party-btn-primary party-btn-inline">Add</button>
              </form>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (phase === 'UP_NEXT' && hd?.proposition) {
    const side = hd.speakerSide as Side;
    const me = hd.speakerId === meId;
    return (
      <div className="debate-phone-center" style={sideStyle(side)}>
        <div className="debate-motion-label">Debate {hd.matchNumber} of {hd.totalMatches}</div>
        {me ? (
          <>
            <div className="debate-phone-big">🎤 You’re up!</div>
            <div className="debate-chip mine" style={{ fontSize: '1rem' }}>Argue {SIDE_LABEL[side].toUpperCase()}</div>
          </>
        ) : (
          <div className="debate-phone-heading"><Who p={players[hd.speakerId]} side={side} size="1.15rem" /> is up next</div>
        )}
        <Proposition words={hd.proposition} className="player-prompt-box debate-phone-prop" />
        <p className="player-waiting-sub">
          {me ? 'Talk out loud for 30 seconds. Partway through, the room will switch a word. Keep going!'
            : mySide !== null ? 'You’re in this debate. Watch your rival, then it’s your turn.'
            : 'Get your heckles ready, and watch for the switch.'}
        </p>
      </div>
    );
  }

  if (phase === 'PITCH' && hd?.words) {
    const side = hd.speakerSide as Side;
    const speaking = hd.speakerId === meId;
    const elapsed = secondsLeft !== null ? PITCH_SECONDS - secondsLeft : null;
    const switchOpen = !hd.switch && elapsed !== null && elapsed >= SWITCH_OPENS_AFTER;
    const canSwitch = mySide === null; // debaters can't sabotage

    if (speaking) {
      return (
        <div className="debate-phone-center" style={sideStyle(side)}>
          <div className="debate-phone-big">🎤 TALK! <span style={{ color: SIDE_COLOR[side] }}>{SIDE_LABEL[side].toUpperCase()}</span></div>
          <div className="debate-clock small">{secondsLeft !== null ? Math.ceil(secondsLeft) : ''}</div>
          <Proposition words={hd.words} sw={hd.switch} className="player-prompt-box debate-phone-prop" />
          {hd.switch && <div className="debate-switch-line hit" style={{ fontSize: '1rem' }}>🔀 Switched! Keep arguing {SIDE_LABEL[side]}!</div>}
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

    const sendSwitch = async () => {
      const word = cleanSwitchWord(replacement);
      if (pickedWord === null || !word) return;
      setBusy(true);
      const ok = await sendAction({ type: 'SUBMIT_SWITCH', index: pickedWord, word });
      setBusy(false);
      if (ok) { setPickedWord(null); setReplacement(''); }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div className="debate-phone-heading" style={sideStyle(side)}><Who p={players[hd.speakerId]} side={side} size="1.1rem" /> is talking · {secondsLeft !== null ? Math.ceil(secondsLeft) : ''}s</div>
        {canSwitch ? (
          <div className="debate-switch-card">
            <div className="debate-arg-label" style={{ textAlign: 'center' }}>
              {hd.switch ? switchLine(hd.switch, elapsed) : switchOpen ? '🔀 Switch it! Tap a word to replace' : switchLine(null, elapsed)}
            </div>
            <div className="debate-word-picker">
              {hd.words.map((w: string, i: number) => {
                const can = switchOpen && isSwitchable(w);
                const switched = hd.switch?.index === i;
                return (
                  <button key={i} type="button" disabled={!can}
                    className={`debate-word${can ? ' can' : ''}${pickedWord === i ? ' picked' : ''}${switched ? ' switched' : ''}`}
                    onClick={() => { setPickedWord(i); setReplacement(''); }}>
                    {w}
                  </button>
                );
              })}
            </div>
            {switchOpen && pickedWord !== null && (
              <form onSubmit={(e) => { e.preventDefault(); sendSwitch(); }} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <input className="party-input" style={{ padding: '0.7rem 0.9rem' }} value={replacement} maxLength={MAX_SWITCH_WORD} autoFocus
                  placeholder={`Instead of “${hd.words[pickedWord]}”…`} enterKeyHint="send" onChange={(e) => setReplacement(e.target.value)} />
                <button type="submit" disabled={!cleanSwitchWord(replacement) || busy} className="party-btn party-btn-primary party-btn-inline">Switch!</button>
              </form>
            )}
          </div>
        ) : (
          <Proposition words={hd.words} sw={hd.switch} className="player-prompt-box debate-phone-prop" />
        )}
        <HeckleBox speaker={players[hd.speakerId]?.name || 'them'} onSend={(text) => sendAction({ type: 'SUBMIT_HECKLE', text })} />
      </div>
    );
  }

  if (phase === 'VERDICT' && hd?.pitches) {
    const chosen = pd?.chosen ?? pending;
    const choose = async (action: any, value: number) => {
      setPending(value);
      if (!(await sendAction(action))) setPending(null);
    };

    if (pd?.canRate && mySide !== null) {
      const other = (1 - mySide) as Side;
      return (
        <div className="debate-phone-center" style={sideStyle(other)}>
          <div className="debate-phone-heading">⭐ Rate <Who p={players[debaters[other]]} side={other} size="1.1rem" />’s pitch</div>
          <Proposition words={hd.pitches[other].words} sw={hd.pitches[other].switch} className="player-prompt-box debate-phone-prop" />
          <div className="debate-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" disabled={chosen !== null} className={chosen !== null && n <= chosen ? 'on' : ''}
                onClick={() => choose({ type: 'SUBMIT_RATING', stars: n }, n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}>★</button>
            ))}
          </div>
          <p className="player-waiting-sub">{chosen !== null ? 'Rated! Waiting for theirs…' : 'Be honest. They’re rating you too.'}</p>
        </div>
      );
    }

    if (pd?.canVote) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="debate-phone-heading">{chosen !== null ? '✅ Vote in! Waiting for the others…' : '⚖️ Who argued it better?'}</div>
          {([0, 1] as Side[]).map((s) => (
            <button key={s} type="button" disabled={chosen !== null} className={`debate-phone-vote${chosen === s ? ' chosen' : ''}`} style={sideStyle(s)}
              onClick={() => choose({ type: 'SUBMIT_VOTE', side: s }, s)}>
              <Who p={players[debaters[s]]} side={s} size="1.15rem" />
              <Proposition words={hd.pitches[s].words} sw={hd.pitches[s].switch} className="debate-phone-arg" />
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="debate-phone-center">
        <div className="player-look-tv-icon">⚖️</div>
        <div className="debate-phone-heading">{mySide !== null ? 'The room is judging you…' : 'The debaters are rating each other…'}</div>
      </div>
    );
  }

  if (phase === 'VERDICT_RESULTS' && hd?.pitches) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <Proposition words={hd.proposition} className="player-prompt-box debate-phone-prop" />
        {hd.winnerSide === null && <div className="debate-phone-heading">🤝 Dead heat!</div>}
        {([0, 1] as Side[]).map((s) => {
          const p = players[debaters[s]];
          const won = hd.winnerSide === s;
          return (
            <div key={s} className={`debate-phone-vote${won ? ' chosen' : ''}`} style={sideStyle(s)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <Who p={p} side={s} size="1.05rem" />
                <span style={{ fontWeight: 900, color: 'var(--party-yellow)', whiteSpace: 'nowrap' }}>
                  {hd.mode === 'rate' ? '★'.repeat(hd.tally?.[s] ?? 0) || '—' : `${hd.tally?.[s] ?? 0} vote${hd.tally?.[s] === 1 ? '' : 's'}`}{hd.micDrop === s ? ' 💥' : won ? ' 🏆' : ''}
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
