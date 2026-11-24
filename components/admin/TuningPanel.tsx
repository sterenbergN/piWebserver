'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SiteTuning } from '@/lib/tuning/site';
import type { Suggestion } from '@/lib/tuning/suggest';
import type { RefillLogEntry } from '@/lib/chess/puzzles';

// Admin › Tuning: features that tune themselves from results. Each person's own values
// move on their own (quick math levels, chess puzzle difficulty, study test difficulty);
// the starting values for everyone and the puzzle top-up rules change only when a
// suggestion here is accepted.

type Change = { at: string; from: number; to: number };
type Person = {
  name: string;
  math: { streakUp: number; sample: number; changes: (Change & { dropRate: number })[] } | null;
  chess: { offset: number; sample: number; changes: (Change & { cleanRate: number })[] } | null;
};
type View = { tuning: SiteTuning; people: Person[]; suggestions: Suggestion[]; refills: RefillLogEntry[] };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function TuningPanel() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/tuning', { cache: 'no-store' });
    const json = await r.json().catch(() => ({}));
    if (r.ok && json.success) setView(json); else setError(json.error || 'Couldn’t load tuning.');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: 'accept' | 'dismiss', id: string) => {
    setBusy(id);
    setError('');
    const r = await fetch('/api/admin/tuning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) });
    const json = await r.json().catch(() => ({}));
    if (r.ok && json.success) setView(json); else setError(json.error || 'That didn’t work.');
    setBusy('');
  };

  if (!view) return <section className="adm-card"><div className="adm-card-head"><h2>🎚️ Tuning</h2></div>{error ? <div className="adm-notice is-error">{error}</div> : <p className="adm-muted">Loading…</p>}</section>;
  const t = view.tuning;

  return (
    <section className="adm-card" aria-labelledby="tuning-title">
      <div className="adm-card-head"><h2 id="tuning-title">🎚️ Tuning</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Some features adjust to how people do. Each person’s own settings move on their own, within limits: how many right in a row quick math
        needs to level up, how far below their Elo chess puzzles are aimed, and the next study test’s difficulty. The values everyone starts
        from change only when you accept a suggestion below.
      </p>

      <h3 className="adm-h3">Suggestions</h3>
      {error && <div className="adm-notice is-error">{error}</div>}
      {view.suggestions.length === 0 ? <p className="adm-muted">Nothing to suggest yet. Suggestions appear once people’s own settings have moved, or the puzzle top-up is struggling.</p> : (
        <div className="adm-list">
          {view.suggestions.map((s) => (
            <div key={s.id} className="adm-row">
              <div className="adm-row-main">
                <strong>{s.title}: {s.current} → {s.suggested}</strong>
                <div className="adm-row-sub">{s.why}</div>
              </div>
              <div className="adm-actions">
                <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('accept', s.id)}>{busy === s.id ? '…' : 'Accept'}</button>
                <button className="btn btn-secondary" disabled={!!busy} onClick={() => void act('dismiss', s.id)}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Starting values for everyone</h3>
      <div className="adm-stats">
        <div className="adm-stat"><div className="adm-stat-label">Quick math</div><div className="adm-stat-value">{t.mathStreakUp}</div><div className="adm-stat-sub">right in a row to level up</div></div>
        <div className="adm-stat"><div className="adm-stat-label">Chess aim</div><div className="adm-stat-value">{t.chessAimOffset}</div><div className="adm-stat-sub">below Elo</div></div>
        <div className="adm-stat"><div className="adm-stat-label">Top-up</div><div className="adm-stat-value">{t.refill.count}</div><div className="adm-stat-sub">puzzles when under {t.refill.threshold} left within ±{t.refill.window}, every {t.refill.cooldownMinutes} min at most</div></div>
      </div>

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Each person</h3>
      {view.people.length === 0 ? <p className="adm-muted">Nobody’s settings have started tuning yet. They do after a few quick math sprints or a dozen chess puzzles.</p> : (
        <div className="adm-list">
          {view.people.map((p) => {
            const m = p.math?.changes.at(-1);
            const c = p.chess?.changes.at(-1);
            return (
              <div key={p.name} className="adm-row">
                <div className="adm-row-main">
                  <strong>{p.name}</strong>
                  {p.math && <div className="adm-row-sub">Quick math: {p.math.streakUp} in a row{m ? ` (from ${m.from} on ${day(m.at)}: dropped back after ${Math.round(m.dropRate * 100)}% of level-ups)` : ` (not moved yet; ${p.math.sample} of 12 level-ups seen)`}</div>}
                  {p.chess && <div className="adm-row-sub">Chess: aimed {p.chess.offset} below Elo{c ? ` (from ${c.from} on ${day(c.at)}: ${Math.round(c.cleanRate * 100)}% solved cleanly)` : ` (not moved yet; ${p.chess.sample} of 12 puzzles seen)`}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view.refills.length > 0 && (<>
        <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Recent puzzle top-ups</h3>
        <ul className="adm-muted" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
          {view.refills.map((r) => <li key={r.at}>{day(r.at)} · {r.trigger === 'auto' ? `automatic${r.forRating ? ` (for Elo ${r.forRating})` : ''}` : 'by you'} · {r.error ? `failed: ${r.error}` : `${r.added} of ${r.requested} added`}</li>)}
        </ul>
      </>)}

      {t.log.length > 0 && (<>
        <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Changes you accepted</h3>
        <ul className="adm-muted" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
          {[...t.log].reverse().map((e) => <li key={e.at}>{day(e.at)} · {e.what}: {e.from} → {e.to}</li>)}
        </ul>
      </>)}
    </section>
  );
}
