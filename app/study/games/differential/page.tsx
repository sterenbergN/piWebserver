'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { InlineMath } from '@/components/study/InlineMath';
import { Loading } from '@/components/study/Ui';
import { diffScore, diffShareText, type DiffCase, type DiffPlay } from '@/lib/study/practice';

// A case a day, one clue at a time. A wrong guess or asking for help shows the
// next clue, and the fewer it took, the more it's worth. Once today's is played,
// she's done for today unless she wants another.

type Stats = { played: number; solved: number; best: number; streak: number; left: number };
type Loaded = { puzzle: DiffCase | null; play: DiffPlay | null; stats: Stats };

function Case({ puzzle, onFinish, busy }: { puzzle: DiffCase; onFinish: (input: { cluesUsed: number; wrong: number; solved: boolean }) => void; busy: boolean }) {
  const [clues, setClues] = useState(1);
  const [crossed, setCrossed] = useState<string[]>([]);
  const worth = diffScore(clues, puzzle.clues.length, crossed.length, true);

  const guess = (option: string) => {
    if (option === puzzle.answer) {
      onFinish({ cluesUsed: clues, wrong: crossed.length, solved: true });
      return;
    }
    if (clues >= puzzle.clues.length) {
      onFinish({ cluesUsed: clues, wrong: crossed.length + 1, solved: false });
      return;
    }
    setCrossed([...crossed, option]);
    setClues(clues + 1);
  };

  return (
    <>
      <section className="sd-card">
        <div className="pr-clue-head">
          <span className="sd-count">Clue {clues} of {puzzle.clues.length}</span>
          <span className="sd-count">Worth {worth} points</span>
        </div>
        <ol className="pr-clues">
          {puzzle.clues.slice(0, clues).map((clue) => (
            <li key={clue.text} className="animate-fade-in">
              <span className="sd-setup-title">{clue.label}</span>
              <MathText>{clue.text}</MathText>
            </li>
          ))}
        </ol>
        {clues < puzzle.clues.length
          ? <button type="button" className="hb-small-btn sd-self-start" onClick={() => setClues(clues + 1)}>Next clue</button>
          : <button type="button" className="hb-text-btn sd-self-start" disabled={busy} onClick={() => onFinish({ cluesUsed: clues, wrong: crossed.length, solved: false })}>I’m stumped</button>}
      </section>
      <section className="sd-card">
        <h2>What is it?</h2>
        <div className="pr-options">
          {puzzle.options.map((option) => (
            <button key={option} type="button" className="pr-option" disabled={busy || crossed.includes(option)} onClick={() => guess(option)}>
              <InlineMath>{option}</InlineMath>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Result({ puzzle, play, stats, another }: { puzzle: DiffCase; play: DiffPlay; stats: Stats; another: () => void }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(diffShareText(play, puzzle.clues.length));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <section className="sd-card sd-done">
        <h2>{play.solved ? `Solved on clue ${play.cluesUsed} of ${puzzle.clues.length}` : 'This one got you'}</h2>
        <p className="pr-live-big"><InlineMath>{puzzle.answer}</InlineMath></p>
        {play.solved && <p className="hb-hint">{play.score} points{play.wrong ? `, with ${play.wrong} wrong guess${play.wrong === 1 ? '' : 'es'}` : ''}.</p>}
        <div className="sd-actions">
          <button type="button" className="hb-small-btn" onClick={share}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy my result'}</button>
        </div>
      </section>
      <section className="sd-card">
        <h2>All the clues</h2>
        <ol className="pr-clues">
          {puzzle.clues.map((clue) => (
            <li key={clue.text}>
              <span className="sd-setup-title">{clue.label}</span>
              <MathText>{clue.text}</MathText>
            </li>
          ))}
        </ol>
        {puzzle.explanation && <><h2>Why</h2><MathText>{puzzle.explanation}</MathText></>}
      </section>
      <section className="sd-card sd-done">
        <p className="hb-hint">That’s today’s case done. A new one tomorrow.</p>
        {stats.left > 0 && <button type="button" className="btn btn-secondary" onClick={another}>Play another ({stats.left} left)</button>}
      </section>
    </>
  );
}

export default function DifferentialPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = (query: string) => practiceGet<Loaded>(query).then((body) => {
    setLoaded(body);
    setState('ready');
  }).catch((e) => setState(e instanceof SignedOut ? 'signed-out' : 'error'));

  useEffect(() => { load('differential=1'); }, []);

  const finish = async (input: { cluesUsed: number; wrong: number; solved: boolean }) => {
    if (!loaded?.puzzle) return;
    setBusy(true);
    setError('');
    try {
      const body = await practicePost<{ play: DiffPlay; stats: Stats }>('finish-puzzle', { id: loaded.puzzle.id, ...input });
      setLoaded({ ...loaded, play: body.play, stats: body.stats });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that. Try again.');
    }
    setBusy(false);
  };

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to play">These are your own cases.</SignInPrompt></div>;
  const stats = loaded?.stats;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/games">← Games</Link>
          <h1>Differential</h1>
          <p>Fewer clues, more points.</p>
        </div>
      </header>
      {state === 'loading' && <Loading rows={2} />}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load today’s case.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
      {stats && stats.played > 0 && (
        <dl className="pr-stats">
          <div><dt>Streak</dt><dd>{stats.streak} day{stats.streak === 1 ? '' : 's'}</dd></div>
          <div><dt>Solved</dt><dd>{stats.solved} of {stats.played}</dd></div>
          <div><dt>Best</dt><dd>{stats.best}</dd></div>
        </dl>
      )}
      {loaded && !loaded.puzzle && (
        <section className="sd-card sd-done">
          <h2>{stats?.played ? 'You’ve played every case' : 'No cases yet'}</h2>
          <p className="hb-hint">Your AI writes these from your notes. A batch of ten lasts about a week and a half.</p>
          <Link className="btn btn-primary" href="/study/practice/add?kind=puzzle">Add cases</Link>
        </section>
      )}
      {loaded?.puzzle && (loaded.play && stats
        ? <Result key={loaded.puzzle.id} puzzle={loaded.puzzle} play={loaded.play} stats={stats} another={() => load('differential=1&another=1')} />
        : <Case key={loaded.puzzle.id} puzzle={loaded.puzzle} onFinish={finish} busy={busy} />)}
      {loaded?.puzzle && <Link className="hb-text-btn sd-self-start" href="/study/practice/add?kind=puzzle">Add more cases</Link>}
    </div>
  );
}
