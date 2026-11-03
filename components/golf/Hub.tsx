'use client';

import { useMemo, useState } from 'react';
import { formatToPar, playerFor, playerTotals } from '@/lib/golf/round';
import type { Round } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { OLD_TOOL_KEY } from './useGolf';
import { shortDate, sportIcon, sportName, toParClass } from './ui';

const signIn = () => window.dispatchEvent(new Event('site:sign-in'));

/** Player names in the old Tools scorecards on this phone, most rounds first. */
function oldToolNames(): string[] {
  try {
    const games = JSON.parse(localStorage.getItem(OLD_TOOL_KEY) || '[]');
    const counts = new Map<string, number>();
    for (const g of Array.isArray(games) ? games : []) for (const p of g?.players || []) if (p?.name) counts.set(p.name, (counts.get(p.name) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  } catch {
    return [];
  }
}

export function SyncStatus({ golf }: Pick<ScreenProps, 'golf'>) {
  if (golf.mode === 'device') return <span className="golf-chip">On this phone</span>;
  if (golf.offline) return <span className="golf-chip is-warn">{golf.waiting ? `Offline · ${golf.waiting} to send` : 'Offline'}</span>;
  if (golf.waiting) return <span className="golf-chip">Saving…</span>;
  return <span className="golf-chip is-ok">Saved</span>;
}

function RoundRow({ round, me, onOpen }: { round: Round; me: string; onOpen: () => void }) {
  const mine = playerFor(round, me) || round.players[0];
  const t = playerTotals(round, mine.id);
  return (
    <button type="button" className="golf-row" onClick={onOpen}>
      <span className="golf-row-icon" aria-hidden>{sportIcon(round.sport)}</span>
      <span className="golf-row-main">
        <strong>{round.courseName}</strong>
        <small>{shortDate(round.date)} · {round.pars.length} holes · {round.players.map((p) => p.name).join(', ')}</small>
      </span>
      <span className="golf-row-score">
        {t.played ? <><strong className={toParClass(t.toPar)}>{formatToPar(t.toPar)}</strong><small>{t.strokes}{t.played < round.pars.length ? ` thru ${t.played}` : ''}</small></> : <small>Not started</small>}
      </span>
    </button>
  );
}

export default function Hub({ golf, me, go, popup }: ScreenProps) {
  const [showAll, setShowAll] = useState(false);
  const [importName, setImportName] = useState('');
  const rounds = useMemo(() => [...golf.data.rounds].sort((a, b) => b.date.localeCompare(a.date)), [golf.data.rounds]);
  const ongoing = rounds.filter((r) => !r.finishedAt);
  const done = rounds.filter((r) => r.finishedAt);
  const names = useMemo(() => [...new Set([golf.name, ...oldToolNames()])], [golf.name]);

  const runImport = async (kind: 'device' | 'server') => {
    const meName = importName || (kind === 'server' ? golf.legacy?.names[0] : names[0]) || golf.name;
    try {
      const added = kind === 'device' ? await golf.importDevice(meName) : await golf.importServer(meName);
      await popup.showAlert({ title: 'Brought over', message: `${added} round${added === 1 ? '' : 's'} added to your account.` });
    } catch (e) {
      await popup.showAlert({ title: 'Not brought over', message: (e as Error).message });
    }
  };

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <h1>Golf &amp; disc golf</h1>
          <p className="golf-muted">Scorecards, real distances and your numbers over time.</p>
        </div>
        <SyncStatus golf={golf} />
      </header>

      {golf.mode === 'device' && (
        <div className="golf-banner">
          <span>Rounds are kept on this phone. Sign in to keep them with your account, play with friends and see them anywhere.</span>
          <button type="button" className="golf-btn is-small" onClick={signIn}>Sign in</button>
        </div>
      )}
      {golf.mode === 'account' && golf.deviceRounds > 0 && (
        <div className="golf-banner">
          <span>{golf.deviceRounds} round{golf.deviceRounds === 1 ? '' : 's'} on this phone from before you signed in (or from the old Tools scorecard).</span>
          {names.length > 1 && (
            <label className="golf-inline">Which player is you?
              <select value={importName || names[0]} onChange={(e) => setImportName(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select>
            </label>
          )}
          <button type="button" className="golf-btn is-small is-primary" onClick={() => runImport('device')}>Add to my account</button>
          <button type="button" className="golf-btn is-small" onClick={async () => {
            if (await popup.confirm({ title: 'Discard rounds on this phone?', message: 'They\'ll be gone from this phone. Rounds in your account stay.', confirmLabel: 'Discard', danger: true })) golf.dismissDevice();
          }}>Discard</button>
        </div>
      )}
      {golf.legacy && (
        <div className="golf-banner">
          <span>{golf.legacy.count} rounds from the old Tools scorecard are saved on the Pi.</span>
          {golf.legacy.names.length > 0 && (
            <label className="golf-inline">Which player is you?
              <select value={importName || golf.legacy.names[0]} onChange={(e) => setImportName(e.target.value)}>{golf.legacy.names.map((n) => <option key={n}>{n}</option>)}</select>
            </label>
          )}
          <button type="button" className="golf-btn is-small is-primary" onClick={() => runImport('server')}>Bring them over</button>
        </div>
      )}

      {ongoing.length > 0 && (
        <section className="golf-card">
          <h2>Still going</h2>
          {ongoing.map((r) => <RoundRow key={r.id} round={r} me={me} onOpen={() => go(`round/${r.id}`)} />)}
        </section>
      )}

      <div className="golf-start">
        <button type="button" className="golf-start-btn" onClick={() => go('new/golf')}><span aria-hidden>⛳</span>Golf round</button>
        <button type="button" className="golf-start-btn" onClick={() => go('new/disc')}><span aria-hidden>🥏</span>Disc golf round</button>
      </div>

      <nav className="golf-links" aria-label="Golf">
        <button type="button" className="golf-link" onClick={() => go('stats')}><span aria-hidden>📈</span>Stats</button>
        <button type="button" className="golf-link" onClick={() => go('bag')}><span aria-hidden>🎒</span>Bag &amp; settings</button>
        <button type="button" className="golf-link" onClick={() => go('find')}><span aria-hidden>🔎</span>Find a disc</button>
      </nav>

      <section className="golf-card">
        <h2>Rounds</h2>
        {done.length === 0 && <p className="golf-muted">Finished rounds show up here.</p>}
        {(showAll ? done : done.slice(0, 8)).map((r) => <RoundRow key={r.id} round={r} me={me} onOpen={() => go(`round/${r.id}`)} />)}
        {!showAll && done.length > 8 && <button type="button" className="golf-btn is-small" onClick={() => setShowAll(true)}>Show all {done.length}</button>}
      </section>

      {golf.data.courses.length > 0 && (
        <section className="golf-card">
          <h2>Courses</h2>
          {[...golf.data.courses].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <button key={c.id} type="button" className="golf-row" onClick={() => go(`course/${c.id}`)}>
              <span className="golf-row-icon" aria-hidden>{sportIcon(c.sport)}</span>
              <span className="golf-row-main"><strong>{c.name}</strong><small>{sportName(c.sport)} · {c.layouts.map((l) => `${l.name} (${l.holes.length})`).join(', ')}</small></span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
