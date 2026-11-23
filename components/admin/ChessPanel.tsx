'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PuzzlePoolInfo, RatingBucket } from '@/lib/chess/puzzles';

// Admin → Puzzles: the chess puzzles used for rest between sets. The bundled set
// ships with the site; more come from the Lichess puzzle dump, either on their
// own when someone runs low near their rating, or loaded here by hand.

type Player = { name: string; rating: number; games: number; solved: number; leftNear: number; solvedByBand: Record<string, number> };
type View = {
  pool: PuzzlePoolInfo;
  buckets: RatingBucket[];
  maxExtra: number;
  autoRefill: { threshold: number; window: number; cooldownMinutes: number; count: number; nextPossibleAt: string | null };
  players: Player[];
};
type Notice = { kind: 'success' | 'error'; text: string };

const RATINGS = Array.from({ length: 25 }, (_, i) => 400 + i * 100);
/** A band with fewer than this many puzzles is worth topping up. */
const THIN_BUCKET = 40;
/** Share of a band a player has used up before it's flagged. */
const USED_WARN = 0.5;
const USED_LOW = 0.8;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function ChessPanel() {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [count, setCount] = useState(250);
  const [minRating, setMinRating] = useState(600);
  const [maxRating, setMaxRating] = useState(2400);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/chess', { cache: 'no-store' });
      const json = await r.json();
      if (!r.ok || !json.success) throw new Error();
      setView(json);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch('/api/admin/chess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, minRating, maxRating }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || !json.success) throw new Error(json.error || 'Could not load puzzles from Lichess.');
      setNotice({ kind: 'success', text: `Added ${json.added} puzzle${json.added === 1 ? '' : 's'} (${minRating}–${maxRating}). The pool has ${json.pool?.total?.toLocaleString() ?? '?'} now.` });
      await load();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load puzzles from Lichess.' });
    } finally {
      setBusy(false);
    }
  };

  /** Aim the form at one band (and a little either side), e.g. a thin one. */
  const aimAt = (from: number) => {
    setMinRating(Math.max(400, from - 100));
    setMaxRating(Math.min(2800, from + 200));
  };

  if (!view) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>♟️ Chess puzzles</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load the puzzle pool.</div> : <p className="adm-muted">Loading…</p>}
      </section>
    );
  }

  const { pool, buckets, players, autoRefill } = view;
  const biggest = Math.max(1, ...buckets.map((b) => b.bundled + b.extra));
  const playersIn = (from: number) => players.filter((p) => p.rating - 50 >= from && p.rating - 50 < from + 100);
  // Bands anyone has used, plus the one each player's puzzles are aimed at.
  const usedBands = [...new Set([
    ...players.flatMap((p) => Object.keys(p.solvedByBand ?? {}).map(Number)),
    ...players.map((p) => Math.floor((p.rating - 50) / 100) * 100),
  ])].sort((a, b) => a - b);
  const bandTotal = (from: number) => { const b = buckets.find((x) => x.from === from); return b ? b.bundled + b.extra : 0; };
  const mostUsed = (p: Player) => Object.entries(p.solvedByBand ?? {})
    .map(([from, n]) => ({ from: Number(from), share: n / Math.max(1, bandTotal(Number(from))) }))
    .sort((a, b) => b.share - a.share)[0];
  const cooling = autoRefill.nextPossibleAt && new Date(autoRefill.nextPossibleAt).getTime() > Date.now();

  return (
    <section className="adm-card" aria-labelledby="chess-title">
      <div className="adm-card-head"><h2 id="chess-title">♟️ Chess puzzles</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        The puzzles in Workout’s rest panel and Rest games. Each person gets puzzles near their own Elo (aimed 50 below it, since it’s between sets),
        so what matters is how many are left around each player’s rating, not the total.
      </p>

      <div className="adm-stats">
        <div className="adm-stat"><div className="adm-stat-label">Puzzles</div><div className="adm-stat-value">{pool.total.toLocaleString()}</div><div className="adm-stat-sub">{pool.minRating}–{pool.maxRating} rating</div></div>
        <div className="adm-stat"><div className="adm-stat-label">Bundled</div><div className="adm-stat-value">{pool.bundled.toLocaleString()}</div><div className="adm-stat-sub">ship with the site</div></div>
        <div className="adm-stat"><div className="adm-stat-label">Loaded</div><div className="adm-stat-value">{pool.extra.toLocaleString()}</div><div className="adm-stat-sub">of {view.maxExtra.toLocaleString()} allowed</div></div>
        <div className="adm-stat"><div className="adm-stat-label">Last load</div><div className="adm-stat-value is-small">{pool.refilling ? 'Loading now…' : when(pool.lastRefillAt)}</div><div className="adm-stat-sub">{pool.lastRefillAt && !pool.refilling ? `${pool.lastRefillAdded} added` : ' '}</div></div>
      </div>
      {pool.lastError && <div role="status" className="adm-notice is-error" style={{ marginTop: '0.75rem', marginBottom: 0 }}>The last load failed: {pool.lastError}</div>}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Players</h3>
      {players.length === 0 ? (
        <p className="adm-muted">Nobody signed in has tried a puzzle yet.</p>
      ) : (
        <div className="adm-list">
          {players.map((p) => {
            const low = p.leftNear < autoRefill.threshold;
            return (
              <div key={p.name} className="adm-row">
                <div className="adm-row-main">
                  <strong>{p.name} · Elo {p.rating}</strong>
                  <div className="adm-row-sub">
                    {p.solved} solved of {p.games} tried
                    {(() => { const m = mostUsed(p); return m ? ` · most used: ${m.from}s, ${Math.round(m.share * 100)}% gone` : ''; })()}
                  </div>
                </div>
                <span style={{ color: low ? 'var(--danger)' : 'var(--muted)', fontSize: '0.85rem', textAlign: 'right' }}>
                  {p.leftNear.toLocaleString()} left near their level{low ? ' · low' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {players.length > 0 && usedBands.length > 0 && (<>
        <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Used up, by player</h3>
        <p className="adm-muted">Puzzles each player has solved in each band (solved ones aren’t offered to them again), out of what the band holds. Amber past half, red past {Math.round(USED_LOW * 100)}%: worth loading more there.</p>
        <div className="adm-chess-used" role="table" aria-label="Puzzles used up per player and rating band">
          <div role="row" className="adm-chess-used-row is-head" style={{ gridTemplateColumns: `4rem 4rem repeat(${players.length}, minmax(0, 1fr))` }}>
            <span role="columnheader">Rating</span>
            <span role="columnheader">Puzzles</span>
            {players.map((p) => <span role="columnheader" key={p.name}>{p.name}</span>)}
          </div>
          {usedBands.map((from) => {
            const total = bandTotal(from);
            return (
              <div role="row" key={from} className="adm-chess-used-row" style={{ gridTemplateColumns: `4rem 4rem repeat(${players.length}, minmax(0, 1fr))` }}>
                <button type="button" role="rowheader" className="adm-chess-band adm-link-btn" title="Aim the load form here" onClick={() => aimAt(from)}>{from}</button>
                <span role="cell" className="adm-chess-count">{total.toLocaleString()}</span>
                {players.map((p) => {
                  const used = p.solvedByBand?.[String(from)] ?? 0;
                  const share = used / Math.max(1, total);
                  const tone = share >= USED_LOW ? 'is-low' : share >= USED_WARN ? 'is-warn' : '';
                  const here = Math.floor((p.rating - 50) / 100) * 100 === from;
                  return (
                    <span role="cell" key={p.name} className={`adm-chess-used-cell ${tone}`} title={here ? `${p.name}'s puzzles are aimed here` : undefined}>
                      <span className="adm-chess-bar" aria-hidden><span style={{ width: `${Math.min(100, share * 100)}%` }} /></span>
                      {used ? `${used} · ${Math.round(share * 100)}%` : '—'}{here ? ' ◂' : ''}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="adm-muted" style={{ marginTop: '0.4rem' }}>◂ marks the band each player’s puzzles are aimed at right now.</p>
      </>)}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>By rating</h3>
      <p className="adm-muted">Each row is 100 points. Faded is bundled, solid is loaded. Pick a thin band to aim the load form at it.</p>
      <div className="adm-chess-buckets" role="table" aria-label="Puzzles per rating band">
        {buckets.map((b) => {
          const total = b.bundled + b.extra;
          const here = playersIn(b.from);
          return (
            <button key={b.from} type="button" role="row" className={`adm-chess-bucket${total < THIN_BUCKET ? ' is-thin' : ''}`} onClick={() => aimAt(b.from)}
              title={`${b.from}–${b.from + 99}: ${b.bundled} bundled, ${b.extra} loaded. Click to load around here.`}>
              <span role="cell" className="adm-chess-band">{b.from}</span>
              <span role="cell" className="adm-chess-bar" aria-hidden>
                <span style={{ width: `${(b.bundled / biggest) * 100}%`, opacity: 0.45 }} />
                <span style={{ width: `${(b.extra / biggest) * 100}%` }} />
              </span>
              <span role="cell" className="adm-chess-count">{total.toLocaleString()}{here.length > 0 && <em> ← {here.map((p) => p.name).join(', ')}</em>}</span>
            </button>
          );
        })}
      </div>

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Load more from Lichess</h3>
      <p className="adm-muted">
        Streams the Lichess puzzle database (free, CC0) and keeps short, well-rated puzzles spread evenly across the range. Takes up to half a minute.
      </p>
      <div className="adm-form">
        <label className="adm-field">
          How many
          <select value={count} disabled={busy} onChange={(e) => setCount(Number(e.target.value))}>
            {[100, 250, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="adm-field">
          From rating
          <select value={minRating} disabled={busy} onChange={(e) => { const v = Number(e.target.value); setMinRating(v); if (maxRating < v + 100) setMaxRating(v + 100); }}>
            {RATINGS.slice(0, -1).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="adm-field">
          To rating
          <select value={maxRating} disabled={busy} onChange={(e) => setMaxRating(Number(e.target.value))}>
            {RATINGS.filter((r) => r >= minRating + 100).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>
      <div className="adm-actions" style={{ marginTop: '0.75rem' }}>
        <button className="btn btn-primary" disabled={busy || pool.refilling || pool.extra >= view.maxExtra} onClick={() => void loadMore()}>
          {busy ? 'Loading from Lichess…' : pool.refilling ? 'A load is running…' : 'Load puzzles'}
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void load()}>Refresh</button>
      </div>
      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Automatic top-up</h3>
      <p className="adm-muted" style={{ marginBottom: 0 }}>
        Still on. When someone opens a puzzle with fewer than {autoRefill.threshold} unsolved ones within ±{autoRefill.window} of their level,
        the server quietly loads {autoRefill.count} more around their Elo, at most once every {autoRefill.cooldownMinutes} minutes.
        {cooling ? ` The next one can run after ${new Date(autoRefill.nextPossibleAt!).toLocaleTimeString()}.` : ''}
      </p>
    </section>
  );
}
