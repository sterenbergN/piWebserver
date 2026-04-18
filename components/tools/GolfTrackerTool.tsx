'use client';

import { useState, useEffect } from 'react';

interface GolfGame {
  id: string;
  date: string;
  courseName: string;
  pars: number[];
  players: { name: string; scores: (number | null)[] }[];
}

const defaultGame = (): GolfGame => ({
  id: Date.now().toString(),
  date: new Date().toISOString(),
  courseName: 'New Course',
  pars: Array(18).fill(4),
  players: [
    { name: 'Player 1', scores: Array(18).fill(null) },
    { name: 'Player 2', scores: Array(18).fill(null) },
    { name: 'Player 3', scores: Array(18).fill(null) },
    { name: 'Player 4', scores: Array(18).fill(null) }
  ]
});

export default function GolfTrackerTool() {
  const [games, setGames] = useState<GolfGame[]>([]);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'admin' | 'local'>('local');

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/tools/golf');
        if (res.status === 401) throw new Error('not admin');
        const data = await res.json();
        if (data.success) { setAuthMode('admin'); setGames(data.games || []); return; }
      } catch {}
      setAuthMode('local');
      try { const l = localStorage.getItem('golfGames'); if (l) setGames(JSON.parse(l)); } catch {}
    };
    init();
  }, []);

  const saveGames = (next: GolfGame[]) => {
    setGames(next);
    if (authMode === 'admin') {
      fetch('/api/tools/golf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ games: next }) }).catch(console.error);
    } else {
      try { localStorage.setItem('golfGames', JSON.stringify(next)); } catch {}
    }
  };

  const createGame = () => {
    const g = defaultGame();
    saveGames([...games, g]);
    setActiveGameId(g.id);
  };

  const activeGame = games.find(g => g.id === activeGameId);
  const updateGame = (g: GolfGame) => saveGames(games.map(x => x.id === g.id ? g : x));

  // Totals helpers
  const sum = (arr: (number | null)[], s: number, e: number) =>
    arr.slice(s, e).reduce<number>((acc, v) => acc + (v || 0), 0);
  
  const relScore = (scores: (number | null)[], pars: number[]) => {
    let s = 0, p = 0;
    scores.forEach((v, i) => { if (v) { s += v; p += pars[i]; } });
    return s - p;
  };

  const fmtRel = (n: number) => n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`;
  const relColor = (n: number) => n > 0 ? '#fc8181' : n < 0 ? '#68d391' : 'var(--muted)';

  // Projected final score: average score-vs-par per played hole × 18
  const projected = (scores: (number | null)[], pars: number[]) => {
    const played = scores.map((v, i) => v ? { score: v, par: pars[i] } : null).filter(Boolean) as { score: number; par: number }[];
    if (played.length === 0) return null;
    const totalPar18 = pars.reduce((a, b) => a + b, 0);
    const avgDiffPerHole = played.reduce((a, h) => a + (h.score - h.par), 0) / played.length;
    const projectedScore = Math.round(totalPar18 + avgDiffPerHole * 18);
    const projectedRel = Math.round(avgDiffPerHole * 18);
    return { projectedScore, projectedRel, holesPlayed: played.length };
  };

  // ── Home screen ────────────────────────────────────────────────────────────
  if (!activeGame) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>⛳ Golf Score Tracker</h2>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          4 players · 18 holes · auto totals &nbsp;|&nbsp; sync: <span style={{ textTransform: 'uppercase' }}>{authMode}</span>
        </p>
        <button className="btn btn-primary" onClick={createGame} style={{ padding: '0.75rem 2rem', fontSize: '1.1rem', marginBottom: '2rem' }}>
          + New Round
        </button>
        {games.length > 0 && (
          <div style={{ textAlign: 'left' }}>
            <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--surface-border)', paddingBottom: '0.5rem', fontSize: '1rem', opacity: 0.7 }}>PREVIOUS ROUNDS</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {games.map(g => (
                <div key={g.id} className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
                  <div>
                    <strong>{g.courseName}</strong>
                    <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>{new Date(g.date).toLocaleDateString()}</div>
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => setActiveGameId(g.id)}>Resume →</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Scorecard view ──────────────────────────────────────────────────────────
  const g = activeGame;
  const totalPar = sum(g.pars, 0, 18);
  const frontPar = sum(g.pars, 0, 9);
  const backPar = sum(g.pars, 9, 18);

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem', flexShrink: 0 }} onClick={() => setActiveGameId(null)}>← Back</button>
        <input
          value={g.courseName}
          onChange={e => updateGame({ ...g, courseName: e.target.value })}
          style={{ flex: 1, minWidth: '120px', background: 'transparent', border: 'none', borderBottom: '2px dashed var(--surface-border)', fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--foreground)', textAlign: 'center', outline: 'none' }}
        />
        <div style={{ fontSize: '0.8rem', opacity: 0.5, flexShrink: 0 }}>{new Date(g.date).toLocaleDateString()}</div>
        <button
          className="btn btn-secondary"
          style={{ color: '#fc8181', fontSize: '0.8rem', padding: '0.4rem 0.75rem', flexShrink: 0 }}
          onClick={() => { if (confirm('Delete this round?')) { saveGames(games.filter(x => x.id !== g.id)); setActiveGameId(null); } }}
        >Delete</button>
      </div>

      {/* Player name editors */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', opacity: 0.5, marginBottom: '0.75rem', letterSpacing: '0.05em' }}>Player Names</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
          {g.players.map((p, pi) => (
            <input
              key={pi}
              value={p.name}
              onChange={e => {
                const players = g.players.map((pl, i) => i === pi ? { ...pl, name: e.target.value } : pl);
                updateGame({ ...g, players });
              }}
              style={{ background: 'var(--input-bg)', border: '1px solid var(--surface-border)', borderRadius: '8px', padding: '0.5rem 0.75rem', color: 'var(--foreground)', fontWeight: 600 }}
            />
          ))}
        </div>
      </div>

      {/* Scorecard — hole cards stacked vertically, mobile friendly */}
      {[{ label: 'FRONT 9', holes: [0,1,2,3,4,5,6,7,8], parTotal: frontPar },
        { label: 'BACK 9', holes: [9,10,11,12,13,14,15,16,17], parTotal: backPar }].map(section => (
        <div key={section.label} className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', opacity: 0.5, marginBottom: '1rem', letterSpacing: '0.05em' }}>{section.label} — Par {section.parTotal}</div>
          
          {/* Table: rows are holes, columns are par + players */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', textAlign: 'left', minWidth: '50px' }}>Hole</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', color: 'var(--accent-light)', minWidth: '60px' }}>Par</th>
                  {g.players.map((p, pi) => (
                    <th key={pi} style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', minWidth: '80px' }}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.holes.map(hi => {
                  const holeNum = hi + 1;
                  const par = g.pars[hi];
                  return (
                    <tr key={hi} style={{ background: hi % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                      {/* Hole # */}
                      <td style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--surface-border)', fontWeight: 600, opacity: 0.7 }}>{holeNum}</td>

                      {/* Par input */}
                      <td style={{ padding: '0.2rem', border: '1px solid var(--surface-border)' }}>
                        <input
                          type="number"
                          value={par || ''}
                          onChange={e => {
                            const pars = [...g.pars]; pars[hi] = parseInt(e.target.value) || 0;
                            updateGame({ ...g, pars });
                          }}
                          style={{ width: '100%', background: 'none', border: 'none', color: 'var(--accent-light)', textAlign: 'center', fontWeight: 'bold', padding: '0.6rem 0', fontSize: '0.95rem' }}
                        />
                      </td>

                      {/* Player scores */}
                      {g.players.map((p, pi) => {
                        const score = p.scores[hi];
                        const diff = score && par ? score - par : null;
                        const bgColor = diff === null ? 'transparent'
                          : diff <= -2 ? 'rgba(66,153,225,0.25)'  // eagle or better
                          : diff === -1 ? 'rgba(104,211,145,0.2)' // birdie
                          : diff === 0 ? 'transparent'             // par
                          : diff === 1 ? 'rgba(252,129,129,0.2)'  // bogey
                          : 'rgba(229,62,62,0.25)';               // double+
                        return (
                          <td key={pi} style={{ padding: '0.2rem', border: '1px solid var(--surface-border)', background: bgColor }}>
                            <input
                              type="number"
                              value={score || ''}
                              onChange={e => {
                                const players = g.players.map((pl, i) => {
                                  if (i !== pi) return pl;
                                  const scores = [...pl.scores]; scores[hi] = parseInt(e.target.value) || null;
                                  return { ...pl, scores };
                                });
                                updateGame({ ...g, players });
                              }}
                              placeholder="—"
                              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--foreground)', textAlign: 'center', padding: '0.6rem 0', fontSize: '0.95rem' }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Section subtotal row */}
                <tr style={{ background: 'rgba(255,255,255,0.07)', fontWeight: 'bold' }}>
                  <td style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', fontSize: '0.8rem', opacity: 0.6 }}>SUBTOTAL</td>
                  <td style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', color: 'var(--accent-light)', textAlign: 'center' }}>{section.parTotal}</td>
                  {g.players.map((p, pi) => {
                    const sub = sum(p.scores, section.holes[0], section.holes[section.holes.length - 1] + 1);
                    const subPar = sum(g.pars, section.holes[0], section.holes[section.holes.length - 1] + 1);
                    const rel = sub ? sub - subPar : 0;
                    return (
                      <td key={pi} style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--surface-border)', textAlign: 'center' }}>
                        {sub || '—'}
                        {sub > 0 && <span style={{ marginLeft: '0.3rem', fontSize: '0.75rem', color: relColor(rel) }}>({fmtRel(rel)})</span>}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Grand totals */}
      <div className="glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', opacity: 0.5, letterSpacing: '0.05em', marginBottom: '1rem' }}>ROUND TOTALS — Par {totalPar}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
          {g.players.map((p, pi) => {
            const total = sum(p.scores, 0, 18);
            const rel = relScore(p.scores, g.pars);
            const proj = projected(p.scores, g.pars);
            const holesLeft = 18 - (proj?.holesPlayed ?? 0);
            return (
              <div key={pi} style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.4rem' }}>{p.name}</div>
                {/* Actual total */}
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{total || '—'}</div>
                {total > 0 && (
                  <div style={{ fontSize: '0.9rem', color: relColor(rel), fontWeight: 600 }}>{fmtRel(rel)}</div>
                )}
                {/* Projected */}
                {proj && holesLeft > 0 && (
                  <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--surface-border)', fontSize: '0.78rem' }}>
                    <div style={{ opacity: 0.5, marginBottom: '0.2rem' }}>Projected ({holesLeft} left)</div>
                    <div style={{ fontWeight: 600, fontFamily: 'monospace', color: relColor(proj.projectedRel) }}>
                      ~{proj.projectedScore} ({fmtRel(proj.projectedRel)})
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
