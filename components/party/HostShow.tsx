'use client';

import { useEffect, useRef, useState } from 'react';
import { line, loadPrefs, partyAudio, type Mood, type SoundPrefs } from './audio';

// Presentation layer for the TV: music, sound effects, a narrator, round title
// cards, flying reactions and a live scoreboard. It only watches game state;
// the games themselves are unchanged.

type Player = { id: string; name: string; score: number; avatar?: string; avatarColor: string; connected?: boolean };
type Reaction = { id: number; from: string; emoji: string; at: number };
type HostState = {
  gameType: string;
  phase: string;
  players: Record<string, Player>;
  playerOrder: string[];
  hostData: any;
  reactions?: Reaction[];
};

export const GAME_TITLES: Record<string, { title: string; tagline: string; color: string }> = {
  'quip-clash': { title: 'Quip Clash', tagline: 'Be funny. Get votes. Crush your friends.', color: 'var(--party-yellow)' },
  'the-faker': { title: 'The Faker', tagline: 'One of you has no idea what’s going on.', color: 'var(--party-red)' },
  'trivia-death': { title: 'Trivia Death', tagline: 'Answer right… or visit the Killing Floor.', color: 'var(--party-purple-lt)' },
  'bracket-battles': { title: 'Bracket Battles', tagline: 'Your answers fight to the death.', color: 'var(--party-cyan)' },
  'ready-set-bet': { title: 'Ready Set Bet', tagline: 'Bet big. Yell louder.', color: 'var(--party-green)' },
};

/** Hide the website chrome so the TV / phone shows only the game. */
export function useImmersive(className: 'party-tv' | 'party-phone') {
  useEffect(() => {
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [className]);
}

function moodFor(state: HostState): Mood {
  if (state.phase === 'LOBBY') return 'lobby';
  if (state.phase === 'FINAL_RESULTS') return 'results';
  if (['KILLING_FLOOR', 'TIEBREAKER', 'FINAL_ESCAPE'].includes(state.phase)) return 'tense';
  if (state.gameType === 'the-faker' && ['VOTING', 'ACTION'].includes(state.phase)) return 'tense';
  return 'play';
}

const names = (state: HostState, ids: string[]) => ids.map((id) => state.players[id]?.name).filter(Boolean).join(' and ');

/** What the narrator says and which title card (if any) to show on entering a phase. */
function onPhase(state: HostState, prevPhase: string): { say?: string; card?: { title: string; subtitle?: string }; sfx?: Parameters<typeof partyAudio.sfx>[0] } {
  const h = state.hostData || {};
  const g = GAME_TITLES[state.gameType];
  const starting = prevPhase === 'LOBBY';
  const intro = starting ? { title: g.title, subtitle: g.tagline } : undefined;
  switch (`${state.gameType}:${state.phase}`) {
    case 'quip-clash:PROMPTING':
      return { card: intro || { title: 'Next Round!', subtitle: 'New prompts on your phones' }, sfx: 'whoosh',
        say: line(['Check your phones and write something funny. The dumber, the better.', 'Prompts are out! You have one minute to be hilarious.', 'Write your answers. Remember: your mother might be watching.']) };
    case 'quip-clash:VOTING':
      return { sfx: 'slam', say: `${h.prompt || ''}` };
    case 'quip-clash:ROUND_RESULTS': {
      if (h.quipLash) return { sfx: 'cheer', say: line(['Quiplash! {name} took every single vote!', 'Total domination by {name}!'], { name: state.players[h.quipLash]?.name || '' }) };
      const tally: Record<string, number> = h.tally || {};
      const ids = Object.keys(tally);
      const best = Math.max(0, ...ids.map((id) => tally[id]));
      const winners = ids.filter((id) => tally[id] === best);
      if (best === 0) return { sfx: 'boo', say: line(['Nobody voted. Brutal.', 'Silence. The crowd has spoken, by not speaking.']) };
      return { sfx: 'ding', say: winners.length > 1 ? 'It’s a tie!' : line(['{name} wins that one!', 'The crowd goes for {name}!', 'Point to {name}!'], { name: names(state, winners) }) };
    }
    case 'the-faker:TASK_DELIVERY':
      return { card: intro || { title: `Round ${h.round || ''}`, subtitle: 'Secret tasks incoming' }, sfx: 'whoosh', say: 'Everyone has a secret task. Except one of you. Don’t say it out loud!' };
    case 'the-faker:ACTION':
      return { sfx: 'slam', say: 'Three. Two. One. Go! And freeze!' };
    case 'the-faker:VOTING':
      return { sfx: 'whoosh', say: line(['Who’s faking it? Vote on your phones.', 'Point fingers. Vote out the faker.']) };
    case 'the-faker:RESULTS': {
      const faker = state.players[h.fakerId]?.name || 'someone';
      return h.fakerCaught
        ? { sfx: 'cheer', say: line(['Busted! {name} was the faker!', 'Caught red-handed! It was {name}!'], { name: faker }) }
        : { sfx: 'boo', say: line(['The faker got away! It was {name} all along.', '{name} fooled you all.'], { name: faker }) };
    }
    case 'trivia-death:QUESTION':
      return { card: intro, sfx: starting ? 'whoosh' : 'tick', say: h.question || '' };
    case 'trivia-death:QUESTION_RESULTS':
      return { sfx: 'ding' };
    case 'trivia-death:KILLING_FLOOR':
      return { card: { title: 'The Killing Floor', subtitle: h.miniGameName }, sfx: 'buzzer', say: line(['Welcome… to the Killing Floor.', 'Uh oh. Someone’s going to the Killing Floor.']) };
    case 'trivia-death:KILLING_FLOOR_RESULTS':
      return { sfx: (h.dead || []).length ? 'boo' : 'cheer', say: (h.dead || []).length ? `Rest in peace, ${names(state, h.dead)}.` : 'Everybody survived. Boring!' };
    case 'trivia-death:FINAL_ESCAPE':
      return { card: { title: 'The Final Escape', subtitle: 'First one out wins' }, sfx: 'whoosh', say: 'This is it. The final escape. Run!' };
    case 'bracket-battles:PROMPTING':
      return { card: intro, sfx: 'whoosh', say: 'Answer your prompt. Your answer is about to fight for its life.' };
    case 'bracket-battles:PREDICTION':
      return { card: { title: 'The Bracket', subtitle: 'Pick your champion' }, sfx: 'slam', say: 'The bracket is set! Predict the champion on your phones.' };
    case 'bracket-battles:MATCHUP': {
      const [a, b] = h.answers || [];
      return { sfx: 'slam', say: a && b ? `${h.prompt || ''}. ${a.answer}… versus… ${b.answer}!` : '' };
    }
    case 'bracket-battles:TIEBREAKER':
      return { sfx: 'buzzer', say: 'It’s a tie! Mash those buttons!' };
    case 'bracket-battles:MATCH_RESULT':
      return { sfx: 'ding', say: h.winner ? `${h.winner.answer} advances!` : '' };
    case 'ready-set-bet:RACING':
      return { card: intro || { title: h.message || 'Next Race' }, sfx: 'whoosh', say: line(['And they’re off!', 'Place your bets! And they’re off!']) };
    case 'ready-set-bet:RACE_RESULTS':
      return { sfx: 'fanfare', say: 'And that’s the race!' };
  }
  if (state.phase === 'FINAL_RESULTS') {
    const top = Object.values(state.players).sort((a, b) => b.score - a.score)[0];
    return { card: { title: 'Final Results' }, sfx: 'drumroll', say: top ? line(['And the winner is… {name}!', 'Your champion: {name}!'], { name: top.name }) : '' };
  }
  return {};
}

/** Drive music, narration, sfx and title cards from game state changes. */
export function useShowDirector(state: HostState | null, secondsLeft: number | null) {
  const [prefs, setPrefsState] = useState<SoundPrefs>({ music: true, sfx: true, voice: true });
  const [soundOn, setSoundOn] = useState(false);
  const [card, setCard] = useState<{ title: string; subtitle?: string; key: number } | null>(null);
  const prevPhase = useRef<string | null>(null);
  const prevHostKey = useRef('');
  const knownPlayers = useRef<Set<string> | null>(null);
  const lastTick = useRef<number | null>(null);

  useEffect(() => {
    const p = loadPrefs();
    setPrefsState(p);
    partyAudio.prefs = p;
  }, []);

  const enableSound = () => {
    partyAudio.unlock();
    setSoundOn(true);
    if (state) partyAudio.music(moodFor(state));
    partyAudio.say('Welcome to the party!');
  };

  const setPrefs = (next: SoundPrefs) => {
    setPrefsState(next);
    partyAudio.setPrefs(next);
    if (next.music && state) partyAudio.resumeMusic();
  };

  // New players: a pop and a welcome.
  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.playerOrder);
    if (knownPlayers.current) {
      const fresh = state.playerOrder.filter((id) => !knownPlayers.current!.has(id));
      if (fresh.length && soundOn) {
        partyAudio.sfx('pop');
        partyAudio.say(line(['Welcome, {name}!', '{name} has entered the building.', 'Look who showed up. It’s {name}!', 'Hello {name}. Prepare to lose.'], { name: names(state, fresh) }));
      }
    }
    knownPlayers.current = ids;
  }, [state, soundOn]);

  // Phase changes (and new prompts/matches within a phase).
  useEffect(() => {
    if (!state) return;
    const hostKey = `${state.phase}|${state.hostData?.prompt || ''}|${state.hostData?.matchId ?? ''}|${state.hostData?.round ?? ''}|${state.hostData?.question || ''}`;
    if (prevPhase.current === null) { prevPhase.current = state.phase; prevHostKey.current = hostKey; return; }
    if (hostKey === prevHostKey.current) return;
    const from = prevPhase.current;
    prevPhase.current = state.phase;
    prevHostKey.current = hostKey;
    partyAudio.music(moodFor(state));
    const cue = onPhase(state, from);
    if (cue.card) {
      const key = Date.now();
      setCard({ ...cue.card, key });
      setTimeout(() => setCard((c) => (c?.key === key ? null : c)), 2600);
    }
    if (cue.sfx) partyAudio.sfx(cue.sfx);
    if (cue.say) setTimeout(() => partyAudio.say(cue.say!), cue.card ? 600 : 250);
  }, [state]);

  // Countdown ticks for the last five seconds, and a buzzer at zero.
  useEffect(() => {
    if (secondsLeft === null) { lastTick.current = null; return; }
    const s = Math.ceil(secondsLeft);
    if (s === lastTick.current) return;
    lastTick.current = s;
    if (s <= 5 && s > 0) partyAudio.sfx('tick');
    if (s === 0) partyAudio.sfx('buzzer');
  }, [secondsLeft]);

  return { prefs, setPrefs, soundOn, enableSound, card };
}

export function SoundBar({ prefs, setPrefs, soundOn, enableSound }: Pick<ReturnType<typeof useShowDirector>, 'prefs' | 'setPrefs' | 'soundOn' | 'enableSound'>) {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const btn = (on: boolean): React.CSSProperties => ({
    background: on ? 'rgba(255,255,255,0.15)' : 'transparent', border: '1px solid var(--party-border)', color: '#fff',
    borderRadius: 999, padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem', opacity: on ? 1 : 0.55,
  });
  return (
    <div className="party-soundbar">
      {!soundOn ? (
        <button onClick={enableSound} className="party-sound-cta">🔊 Tap to turn on sound &amp; narrator</button>
      ) : (
        <>
          <button style={btn(prefs.music)} onClick={() => setPrefs({ ...prefs, music: !prefs.music })} aria-pressed={prefs.music}>🎵 Music</button>
          <button style={btn(prefs.sfx)} onClick={() => setPrefs({ ...prefs, sfx: !prefs.sfx })} aria-pressed={prefs.sfx}>💥 Effects</button>
          <button style={btn(prefs.voice)} onClick={() => setPrefs({ ...prefs, voice: !prefs.voice })} aria-pressed={prefs.voice}>🎙️ Narrator</button>
        </>
      )}
      <button style={btn(fullscreen)} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
        {fullscreen ? '🗗 Exit full screen' : '⛶ Full screen'}
      </button>
    </div>
  );
}

export function TitleCard({ card, color }: { card: { title: string; subtitle?: string; key: number }; color?: string }) {
  return (
    <div key={card.key} className="party-title-card" role="status">
      <div className="party-title-card-inner">
        <div className="party-title-card-title" style={{ color }}>{card.title}</div>
        {card.subtitle && <div className="party-title-card-sub">{card.subtitle}</div>}
      </div>
    </div>
  );
}

/** Emoji reactions from phones, floating up the TV. */
export function ReactionLayer({ reactions, players }: { reactions?: Reaction[]; players: Record<string, Player> }) {
  const [shown, setShown] = useState<(Reaction & { left: number })[]>([]);
  const seen = useRef<number>(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const list = reactions || [];
    // On first load, skip reactions that happened before the TV connected.
    if (seen.current === Number.POSITIVE_INFINITY) { seen.current = list[list.length - 1]?.id || 0; return; }
    const fresh = list.filter((r) => r.id > seen.current && Date.now() - r.at < 5000);
    if (!fresh.length) return;
    seen.current = list[list.length - 1].id;
    const added = fresh.map((r) => ({ ...r, left: 5 + Math.random() * 85 }));
    setShown((prev) => [...prev, ...added].slice(-40));
    const ids = new Set(added.map((a) => a.id));
    setTimeout(() => setShown((prev) => prev.filter((r) => !ids.has(r.id))), 3200);
  }, [reactions]);

  return (
    <div className="party-reaction-layer" aria-hidden>
      {shown.map((r) => (
        <div key={r.id} className="party-reaction" style={{ left: `${r.left}%` }}>
          <span className="party-reaction-emoji">{r.emoji}</span>
          <span className="party-reaction-from">{players[r.from]?.avatar || '👀'}</span>
        </div>
      ))}
    </div>
  );
}

/** Bottom strip of everyone's score; changes pop a "+N". */
export function ScoreTicker({ players, order }: { players: Record<string, Player>; order: string[] }) {
  const prev = useRef<Record<string, number>>({});
  const [bumps, setBumps] = useState<Record<string, { n: number; key: number }>>({});

  useEffect(() => {
    const next: Record<string, { n: number; key: number }> = {};
    for (const id of order) {
      const was = prev.current[id];
      const now = players[id]?.score ?? 0;
      if (was !== undefined && now > was) next[id] = { n: now - was, key: Date.now() + Math.random() };
      prev.current[id] = now;
    }
    if (Object.keys(next).length) {
      setBumps((b) => ({ ...b, ...next }));
      setTimeout(() => setBumps((b) => {
        const copy = { ...b };
        for (const id of Object.keys(next)) if (copy[id]?.key === next[id].key) delete copy[id];
        return copy;
      }), 2200);
    }
  }, [players, order]);

  const ranked = [...order].filter((id) => players[id]).sort((a, b) => players[b].score - players[a].score);
  return (
    <div className="party-score-ticker">
      {ranked.map((id, i) => {
        const p = players[id];
        return (
          <div key={id} className="party-score-chip" style={{ borderColor: p.avatarColor, opacity: p.connected === false ? 0.5 : 1 }}>
            <span className="party-score-rank">{i + 1}</span>
            <span className="party-score-avatar">{p.avatar || p.name.charAt(0)}</span>
            <span className="party-score-name">{p.name}</span>
            <span className="party-score-value">{p.score}</span>
            {bumps[id] && <span key={bumps[id].key} className="party-score-bump">+{bumps[id].n}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Faces of the players who voted for something, popping in one by one. */
export function VoterFaces({ ids, players }: { ids?: string[]; players: Record<string, Player> }) {
  if (!ids?.length) return null;
  return (
    <div className="party-voter-faces">
      {ids.map((id, i) => (
        <span key={id} className="party-voter-face" title={players[id]?.name} style={{ animationDelay: `${0.4 + i * 0.18}s`, borderColor: players[id]?.avatarColor }}>
          {players[id]?.avatar || players[id]?.name.charAt(0) || '?'}
        </span>
      ))}
    </div>
  );
}
