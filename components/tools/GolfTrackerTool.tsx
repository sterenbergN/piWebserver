'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { MAX_PLAYERS, formatToPar, newGame, nextHole, normalizeGame, scoreName, summarize, type GolfGame } from '@/lib/tools/golf';

const LOCAL_KEY = 'golfGames';
const toParClass = (n: number) => (n < 0 ? 'tl-under' : n > 0 ? 'tl-over' : 'tl-even');
const CELL_CLASS = { eagle: 'tl-cell-eagle', birdie: 'tl-cell-birdie', par: '', bogey: 'tl-cell-bogey', double: 'tl-cell-double' } as const;

/** Rounds are saved on the Pi when signed in as admin, otherwise on this device. */
function useRounds() {
  const [games, setGames] = useState<GolfGame[] | null>(null);
  const [mode, setMode] = useState<'server' | 'local'>('local');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/tools/golf');
        const d = res.ok ? await res.json() : null;
        if (d?.success) { setMode('server'); setGames((d.games || []).map(normalizeGame).filter(Boolean)); return; }
      } catch { }
      try { setGames((JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as unknown[]).map(normalizeGame).filter(Boolean) as GolfGame[]); } catch { setGames([]); }
    })();
  }, []);

  const save = useCallback((next: GolfGame[]) => {
    setGames(next);
    if (mode === 'local') { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { } return; }
    // Typing a score shouldn't send a request per tap: save half a second after the last change.
    setSaveState('saving');
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      fetch('/api/tools/golf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ games: next }) })
        .then(r => setSaveState(r.ok ? 'saved' : 'error')).catch(() => setSaveState('error'));
    }, 500);
  }, [mode]);

  return { games, save, mode, saveState };
}

function Setup({ onStart, onCancel }: { onStart: (g: GolfGame) => void; onCancel?: () => void }) {
  const [course, setCourse] = useState('');
  const [holes, setHoles] = useState<9 | 18>(18);
  const [names, setNames] = useState<string[]>(() => {
    try { const last = localStorage.getItem('golfLastPlayers'); if (last) return JSON.parse(last); } catch { }
    return ['', ''];
  });
  const start = () => {
    try { localStorage.setItem('golfLastPlayers', JSON.stringify(names)); } catch { }
    onStart(newGame(holes, names, course));
  };
  return (
    <section className="tl-card animate-fade-in">
      <h2>New round</h2>
      <p className="tl-sub">Every hole starts as par 4 — change it on each hole as you play.</p>
      <span className="tl-label">Course</span>
      <input value={course} onChange={e => setCourse(e.target.value)} placeholder="e.g. Hermann Park" />
      <span className="tl-label">Holes</span>
      <div className="tl-seg" role="group" aria-label="Holes">
        {([9, 18] as const).map(h => <button key={h} aria-pressed={holes === h} onClick={() => setHoles(h)}>{h} holes</button>)}
      </div>
      <span className="tl-label">Players</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {names.map((n, i) => (
          <div key={i} className="tl-row">
            <input value={n} onChange={e => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Player ${i + 1}`} aria-label={`Player ${i + 1} name`} style={{ flex: 1 }} />
            <button className="tl-icon-btn" onClick={() => setNames(names.filter((_, j) => j !== i))} disabled={names.length <= 1} aria-label={`Remove player ${i + 1}`}>✕</button>
          </div>
        ))}
        {names.length < MAX_PLAYERS && <button className="btn btn-secondary" onClick={() => setNames([...names, ''])}>+ Add player</button>}
      </div>
      <div className="tl-row" style={{ marginTop: '1.25rem' }}>
        {onCancel && <button className="btn btn-secondary tl-btn" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary tl-btn" style={{ flex: 2 }} onClick={start}>Tee off ⛳</button>
      </div>
    </section>
  );
}

export default function GolfTrackerTool() {
  const { confirm, popup } = useSitePopup();
  const { games, save, mode, saveState } = useRounds();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [hole, setHole] = useState(0);
  const [view, setView] = useState<'hole' | 'card'>('hole');

  if (!games) return <section className="tl-card"><p className="tl-muted" style={{ margin: 0 }}>Loading rounds…</p>{popup}</section>;
  const game = games.find(g => g.id === activeId) || null;

  const open = (g: GolfGame) => { setActiveId(g.id); setHole(nextHole(g)); setView('hole'); setSettingUp(false); };
  const update = (g: GolfGame) => save(games.map(x => (x.id === g.id ? g : x)));

  // ── Rounds list / setup ───────────────────────────────────────────────────
  if (!game) {
    if (settingUp || games.length === 0) {
      return <>{<Setup onStart={g => { save([g, ...games]); open(g); }} onCancel={games.length ? () => setSettingUp(false) : undefined} />}{popup}</>;
    }
    return (
      <section className="tl-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <h2>⛳ Golf scores</h2>
            <div className="tl-muted" style={{ fontSize: '0.85rem' }}>{mode === 'server' ? 'Saved on the server' : 'Saved on this device'}</div>
          </div>
          <button className="btn btn-primary tl-btn" onClick={() => setSettingUp(true)}>+ New round</button>
        </div>
        {games.map(g => {
          const leader = g.players.map(p => ({ p, s: summarize(p, g.pars) })).filter(x => x.s.played).sort((a, b) => a.s.toPar - b.s.toPar)[0];
          return (
            <button key={g.id} className="tl-round" onClick={() => open(g)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{g.courseName}</strong>
                <span className="tl-muted" style={{ fontSize: '0.82rem' }}>
                  {new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {g.pars.length} holes · {g.players.map(p => p.name).join(', ')}
                </span>
              </span>
              {leader && <span className={toParClass(leader.s.toPar)} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{leader.p.name.split(' ')[0]} {formatToPar(leader.s.toPar)}</span>}
              <span className="tl-muted" aria-hidden>›</span>
            </button>
          );
        })}
        {popup}
      </section>
    );
  }

  // ── Round ─────────────────────────────────────────────────────────────────
  const holes = game.pars.length;
  const par = game.pars[hole];
  const setPar = (p: number) => update({ ...game, pars: game.pars.map((x, i) => (i === hole ? p : x)) });
  const setScore = (pi: number, s: number | null) => update({ ...game, players: game.players.map((p, i) => (i === pi ? { ...p, scores: p.scores.map((x, h) => (h === hole ? s : x)) } : p)) });
  const bump = (pi: number, delta: number) => {
    const current = game.players[pi].scores[hole];
    // First tap starts at par, so most holes take one tap.
    setScore(pi, current === null ? par + (delta > 0 ? 0 : -1) : Math.min(15, Math.max(1, current + delta)));
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete round?', message: `Delete ${game.courseName} (${new Date(game.date).toLocaleDateString()})?`, confirmLabel: 'Delete', danger: true }))) return;
    save(games.filter(g => g.id !== game.id));
    setActiveId(null);
  };
  const leaderboard = game.players.map((p, i) => ({ p, i, s: summarize(p, game.pars) })).sort((a, b) => (a.s.played ? a.s.toPar : 99) - (b.s.played ? b.s.toPar : 99));
  const nine = holes === 18 ? [[0, 9, 'Out'], [9, 18, 'In']] as const : [[0, 9, 'Total']] as const;

  return (
    <>
      <section className="tl-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="tl-icon-btn" onClick={() => setActiveId(null)} aria-label="All rounds">‹</button>
          <input value={game.courseName} onChange={e => update({ ...game, courseName: e.target.value })} aria-label="Course name" style={{ flex: 1, fontWeight: 700, fontSize: '1.05rem' }} />
          <button className="tl-icon-btn" onClick={remove} aria-label="Delete round" style={{ color: 'var(--danger)' }}>🗑</button>
        </div>
        <div className="tl-muted" style={{ fontSize: '0.78rem', marginTop: '0.4rem', textAlign: 'right' }}>
          {mode === 'server' ? (saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '⚠️ Not saved — check your connection' : 'Saved') : 'Saved on this device'}
        </div>
        <div className="tl-seg" role="group" aria-label="View" style={{ marginTop: '0.6rem' }}>
          <button aria-pressed={view === 'hole'} onClick={() => setView('hole')}>Hole by hole</button>
          <button aria-pressed={view === 'card'} onClick={() => setView('card')}>Scorecard</button>
        </div>
      </section>

      {view === 'hole' ? (
        <section className="tl-card">
          <div className="tl-hole-head">
            <button className="tl-icon-btn" onClick={() => setHole(h => Math.max(0, h - 1))} disabled={hole === 0} aria-label="Previous hole">‹</button>
            <div className="tl-hole-num">
              <span className="tl-muted" style={{ fontSize: '0.8rem' }}>Hole</span>
              <strong>{hole + 1}<span className="tl-muted" style={{ fontSize: '1rem', fontWeight: 400 }}> / {holes}</span></strong>
            </div>
            <button className="tl-icon-btn" onClick={() => setHole(h => Math.min(holes - 1, h + 1))} disabled={hole === holes - 1} aria-label="Next hole">›</button>
          </div>
          <div className="tl-seg" role="group" aria-label="Par for this hole" style={{ margin: '0.9rem 0 1rem' }}>
            {[3, 4, 5, 6].map(p => <button key={p} aria-pressed={par === p} onClick={() => setPar(p)}>Par {p}</button>)}
          </div>

          {game.players.map((p, pi) => {
            const s = p.scores[hole];
            const sum = summarize(p, game.pars);
            const name = scoreName(s, par);
            return (
              <div key={pi} className="tl-player">
                <div className="tl-player-name">
                  <strong>{p.name}</strong>
                  <span className={sum.played ? toParClass(sum.toPar) : ''}>{sum.played ? `${formatToPar(sum.toPar)} thru ${sum.played}` : 'No score yet'}</span>
                </div>
                <button className="tl-score-btn" onClick={() => bump(pi, -1)} aria-label={`${p.name}: one fewer stroke`}>−</button>
                <div className="tl-score" aria-live="polite">
                  <strong>{s ?? '–'}</strong>
                  <span className={s ? toParClass(s - par) : 'tl-muted'}>{name ? name[0].toUpperCase() + name.slice(1) : 'tap +'}</span>
                </div>
                <button className="tl-score-btn" onClick={() => bump(pi, 1)} aria-label={`${p.name}: one more stroke`}>+</button>
              </div>
            );
          })}

          {hole < holes - 1 ? (
            <button className="btn btn-primary tl-btn tl-btn-block" style={{ marginTop: '1rem' }} onClick={() => setHole(hole + 1)}>Next hole ›</button>
          ) : (
            <button className="btn btn-primary tl-btn tl-btn-block" style={{ marginTop: '1rem' }} onClick={() => setView('card')}>See the scorecard</button>
          )}
        </section>
      ) : (
        <section className="tl-card">
          <div className="tl-card-scroll">
            <table className="tl-scorecard">
              <thead>
                <tr>
                  <th scope="col">Hole</th>
                  {game.pars.map((_, h) => <th key={h} scope="col">{h + 1}</th>)}
                  {nine.map(([, , label]) => <th key={label} scope="col" className="is-total">{label}</th>)}
                  {holes === 18 && <th scope="col" className="is-total">Tot</th>}
                </tr>
                <tr>
                  <th scope="row">Par</th>
                  {game.pars.map((p, h) => <td key={h} className="tl-muted">{p}</td>)}
                  {nine.map(([from, to, label]) => <td key={label} className="is-total">{game.pars.slice(from, to).reduce((a, b) => a + b, 0)}</td>)}
                  {holes === 18 && <td className="is-total">{game.pars.reduce((a, b) => a + b, 0)}</td>}
                </tr>
              </thead>
              <tbody>
                {game.players.map((p, pi) => {
                  const total = summarize(p, game.pars);
                  return (
                    <tr key={pi}>
                      <th scope="row" title={p.name}>{p.name}</th>
                      {p.scores.map((s, h) => {
                        const name = scoreName(s, game.pars[h]);
                        return (
                          <td key={h} className={name ? CELL_CLASS[name] : ''}>
                            <button onClick={() => { setHole(h); setView('hole'); }} aria-label={`${p.name}, hole ${h + 1}: ${s ?? 'no score'}`}>{s ?? '·'}</button>
                          </td>
                        );
                      })}
                      {nine.map(([from, to, label]) => { const s = summarize(p, game.pars, from, to); return <td key={label} className="is-total">{s.played ? s.strokes : '–'}</td>; })}
                      {holes === 18 && <td className="is-total">{total.played ? total.strokes : '–'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tl-muted" style={{ fontSize: '0.78rem', margin: '0.5rem 0 0' }}>Tap a score to edit that hole. Green = birdie, blue = eagle, red = bogey or worse.</p>
        </section>
      )}

      <section className="tl-card">
        <span className="tl-label">Leaderboard</span>
        {leaderboard.map(({ p, i, s }, rank) => (
          <div key={i} className="tl-result" style={{ marginTop: rank ? '0.4rem' : 0 }}>
            <span>{s.played ? `${rank + 1}. ` : ''}{p.name}</span>
            <span style={{ textAlign: 'right' }}>
              <strong className={s.played ? toParClass(s.toPar) : 'tl-muted'}>{s.played ? formatToPar(s.toPar) : '–'}</strong>
              <span className="tl-muted" style={{ display: 'block', fontSize: '0.78rem' }}>
                {s.played ? `${s.strokes} strokes · thru ${s.played}${s.projected ? ` · on pace for ${s.projected}` : ''}` : 'not started'}
              </span>
            </span>
          </div>
        ))}
      </section>
      {popup}
    </>
  );
}
