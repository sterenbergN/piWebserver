'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDistance, unitFor } from '@/lib/golf/geo';
import { formatToPar, playerFor } from '@/lib/golf/round';
import { golfStats, pct, roundsFor, summarizeThrows, throwsFor, type Rate } from '@/lib/golf/stats';
import type { Round, Sport } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { Seg, shortDate } from './ui';

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };
const round1 = (n: number) => Math.round(n * 10) / 10;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="golf-tile">
      <small>{label}</small>
      <strong>{value}</strong>
      {sub && <span>{sub}</span>}
    </div>
  );
}

const rateText = (r: Rate) => (r.tries ? `${pct(r)}%` : '–');
const rateSub = (r: Rate, what: string) => (r.tries ? `${r.made} of ${r.tries} ${what}` : 'Not tracked yet');

/** GIR: on the green when (strokes - putts) <= (par - 2); holes without putts entered are excluded. */
function teeToGreenStats(rounds: Round[], userId: string) {
  const greens: Rate = { made: 0, tries: 0 };
  const scrambling: Rate = { made: 0, tries: 0 };
  let putts = 0;
  let puttGreens = 0;
  for (const r of rounds) {
    const player = playerFor(r, userId);
    if (!player) continue;
    const scores = r.scores[player.id] || [];
    scores.forEach((sc, i) => {
      if (!sc || typeof sc.putts !== 'number' || !Number.isFinite(sc.putts)) return;
      const par = r.pars[i];
      if (typeof par !== 'number' || !Number.isFinite(par)) return;
      const gir = (sc.strokes - sc.putts) <= (par - 2);
      greens.tries++;
      if (gir) {
        greens.made++;
        puttGreens++;
        putts += sc.putts;
      } else {
        scrambling.tries++;
        if (sc.strokes <= par) scrambling.made++;
      }
    });
  }
  return {
    greens,
    scrambling,
    puttsPerGreen: puttGreens ? Math.round((putts / puttGreens) * 100) / 100 : null,
  };
}

/** Average score to par across 9-hole segments (Front 9, Back 9, Holes 19-24 / 19-27, etc.). */
function stretchSummaries(rounds: Round[], userId: string) {
  if (!rounds.some((r) => r.pars.length > 9)) return [];
  const buckets = new Map<string, { label: string; order: number; holeCount: number; sums: number[] }>();
  for (const r of rounds) {
    const n = r.pars.length;
    if (n <= 9) continue;
    const player = playerFor(r, userId);
    if (!player) continue;
    const scores = r.scores[player.id] || [];
    const segs: [string, string, number, number, number][] = [
      ['0-9', 'Front 9', 1, 0, Math.min(9, n)],
      ['9-18', n >= 18 ? 'Back 9' : `Holes 10–${n}`, 2, 9, Math.min(18, n)],
    ];
    if (n > 18) {
      const end = Math.min(27, n);
      segs.push([`18-${end}`, `Holes 19–${end}`, 3, 18, end]);
    }
    if (n > 27) {
      segs.push([`27-${n}`, `Holes 28–${n}`, 4, 27, n]);
    }
    for (const [key, label, order, from, to] of segs) {
      const len = to - from;
      if (len <= 0) continue;
      let sum = 0;
      let played = 0;
      for (let i = from; i < to; i++) {
        const sc = scores[i];
        if (!sc) break;
        sum += sc.strokes - r.pars[i];
        played++;
      }
      if (played === len) {
        const entry = buckets.get(key) || { label, order, holeCount: len, sums: [] };
        entry.sums.push(sum);
        buckets.set(key, entry);
      }
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map((b) => ({
      label: b.label,
      avgToPar: round1(b.sums.reduce((a, x) => a + x, 0) / b.sums.length),
      holeCount: b.holeCount,
    }));
}

export default function StatsView({ golf, me, go }: ScreenProps) {
  const sports = useMemo(() => [...new Set(golf.data.rounds.filter((r) => r.finishedAt).map((r) => r.sport))], [golf.data.rounds]);
  const [sport, setSport] = useState<Sport>(sports[0] || 'golf');
  const [courseId, setCourseId] = useState('');
  const [trendHolesState, setTrendHolesState] = useState<number | null>(null);
  const played = useMemo(() => roundsFor(golf.data.rounds, me, sport), [golf.data.rounds, me, sport]);
  const filteredRounds = useMemo(
    () => (courseId ? played.filter((r) => r.courseId === courseId) : played),
    [played, courseId],
  );
  const courseOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const r of played) if (r.courseId) ids.set(r.courseId, r.courseName);
    return [...ids.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [played]);
  const s = useMemo(() => golfStats(golf.data.rounds, me, sport, courseId || undefined), [golf.data.rounds, me, sport, courseId]);
  const teeToGreen = useMemo(() => teeToGreenStats(filteredRounds, me), [filteredRounds, me]);
  const stretches = useMemo(() => stretchSummaries(filteredRounds, me), [filteredRounds, me]);
  const unit = unitFor(sport, golf.data.user.units);
  const throws = useMemo(() => throwsFor(filteredRounds, me, golf.data.courses), [filteredRounds, golf.data.courses, me]);
  const drives = summarizeThrows(throws.filter((t) => t.kind === 'drive'));
  const byGear = useMemo(() => {
    const names = new Map<string, string>([...golf.data.user.clubs.map((c) => [c.id, c.name] as const), ...golf.data.user.discs.map((d) => [d.id, d.name] as const)]);
    const groups = new Map<string, typeof throws>();
    for (const t of throws) {
      const id = t.clubId || t.discId;
      if (id) groups.set(id, [...(groups.get(id) || []), t]);
    }
    return [...groups.entries()].map(([id, list]) => ({ name: names.get(id) || 'Removed from bag', ...summarizeThrows(list)! })).sort((a, b) => b.average - a.average);
  }, [throws, golf.data.user]);

  const byHoleCount = useMemo(() => {
    const map = new Map<number, typeof s.trend>();
    for (const p of s.trend) {
      const list = map.get(p.holes);
      if (list) list.push(p);
      else map.set(p.holes, [p]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => b - a)
      .map(([holeCount, list]) => ({
        holes: holeCount,
        rounds: list,
        avgStrokes: round1(list.reduce((sum, p) => sum + p.strokes, 0) / list.length),
        avgToPar: round1(list.reduce((sum, p) => sum + p.toPar, 0) / list.length),
        best: list.reduce((b, p) => (p.toPar < b.toPar ? p : b), list[0]),
      }));
  }, [s.trend]);
  const trendGroups = byHoleCount.filter((g) => g.rounds.length > 1);
  const defaultTrendHoles = trendGroups.reduce<typeof trendGroups[number] | null>(
    (best, g) => (!best || g.rounds.length > best.rounds.length || (g.rounds.length === best.rounds.length && g.holes > best.holes) ? g : best),
    null,
  )?.holes ?? null;
  const holes = trendGroups.some((g) => g.holes === trendHolesState) ? trendHolesState : defaultTrendHoles;
  const trend = (trendGroups.find((g) => g.holes === holes)?.rounds || []).map((p) => ({
    label: shortDate(p.date),
    toPar: p.toPar,
    detail: `${p.strokes} at ${p.courseName}`,
  }));
  const hcp = s.handicap.at(-1)?.index ?? null;
  const spreadRows: [string, number][] = [
    ['Birdie or better', s.spread.ace + s.spread.albatross + s.spread.eagle + s.spread.birdie],
    ['Par', s.spread.par],
    ['Bogey', s.spread.bogey],
    ['Double', s.spread.double],
    ['Worse', s.spread.worse],
  ];

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
          <h1>Stats</h1>
        </div>
      </header>

      <div className="golf-filters">
        <Seg label="Sport" value={sport} onChange={(v) => { setSport(v); setCourseId(''); setTrendHolesState(null); }} options={[['golf', '⛳ Golf'], ['disc', '🥏 Disc golf']]} />
        {courseOptions.length > 1 && (
          <select className="golf-input is-small" value={courseId} onChange={(e) => { setCourseId(e.target.value); setTrendHolesState(null); }} aria-label="Course">
            <option value="">Every course</option>
            {courseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {s.rounds === 0 ? (
        <p className="golf-card golf-muted">Finish a round and its numbers show up here.</p>
      ) : (
        <>
          <div className="golf-tiles">
            <Tile label="Rounds" value={String(s.rounds)} sub={`${s.holes} holes`} />
            {byHoleCount.map((g) => (
              <Tile key={g.holes} label={`${g.holes}-hole average`} value={String(g.avgStrokes)} sub={`${formatToPar(g.avgToPar)} · best ${formatToPar(g.best.toPar)}`} />
            ))}
            {sport === 'golf' && <Tile label="Handicap (estimate)" value={hcp === null ? '–' : hcp < 0 ? `+${-hcp}` : String(hcp)} sub={hcp === null ? `${s.handicap.length} of 3 rated rounds` : `from ${s.handicap.length} rated rounds`} />}
            {s.penaltiesPerRound !== null && <Tile label="Penalties a round" value={String(s.penaltiesPerRound)} />}
          </div>

          {trend.length > 1 && holes !== null && (
            <section className="golf-card">
              <div className="golf-head">
                <h2>Score to par, {holes}-hole rounds</h2>
                {trendGroups.length > 1 && (
                  <Seg label="Round length" value={String(holes)} onChange={(v) => setTrendHolesState(Number(v))} options={trendGroups.map((g) => [String(g.holes), `${g.holes} holes`])} />
                )}
              </div>
              <div className="golf-chart" role="img" aria-label={`Score to par in each ${holes}-hole round`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} stroke="var(--surface-border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} tick={{ fill: 'var(--muted)', fontSize: 10 }} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(v) => formatToPar(Number(v))} allowDecimals={false} width={40} />
                    <ReferenceLine y={0} stroke="var(--muted)" strokeWidth={1} />
                    <Tooltip cursor={{ stroke: 'var(--surface-border)' }} contentStyle={tooltipStyle} formatter={(value, _n, item) => [`${formatToPar(Number(value))} · ${(item?.payload as { detail: string }).detail}`, '']} separator="" />
                    <Line type="monotone" dataKey="toPar" stroke="var(--accent-light)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent-light)', stroke: 'var(--card-bg)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="golf-card">
            <h2>Scoring</h2>
            <div className="golf-tiles is-small">
              {[2, 3, 4, 5, 6, 7].filter((p) => s.byPar[p] !== undefined && s.byPar[p] !== null).map((p) => <Tile key={p} label={`Par ${p}s`} value={`${s.byPar[p]! > 0 ? '+' : ''}${s.byPar[p]}`} sub="a hole, on average" />)}
            </div>
            {stretches.length > 0 && (
              <div className="golf-tiles is-small">
                {stretches.map((st) => (
                  <Tile key={st.label} label={st.label} value={formatToPar(st.avgToPar)} sub={`avg over ${st.holeCount} holes`} />
                ))}
              </div>
            )}
            <div className="golf-bars">
              {spreadRows.map(([label, n]) => (
                <div key={label} className="golf-bar-row">
                  <span>{label}</span>
                  <div className="golf-bar"><span style={{ width: `${s.holes ? (n / s.holes) * 100 : 0}%` }} /></div>
                  <strong>{s.holes ? Math.round((n / s.holes) * 100) : 0}%</strong>
                </div>
              ))}
            </div>
          </section>

          {sport === 'golf' ? (
            <section className="golf-card">
              <h2>Tee to green</h2>
              <div className="golf-tiles is-small">
                {(() => { const f = s.fairways; const n = f.hit + f.left + f.right + f.short; return <Tile label="Fairways" value={n ? `${Math.round((f.hit / n) * 100)}%` : '–'} sub={n ? `missed ${f.left} left, ${f.right} right, ${f.short} short` : 'Not tracked yet'} />; })()}
                <Tile label="Greens in regulation" value={rateText(teeToGreen.greens)} sub={rateSub(teeToGreen.greens, 'holes with putts')} />
                <Tile label="Scrambling" value={rateText(teeToGreen.scrambling)} sub={teeToGreen.scrambling.tries ? `par or better after missing ${teeToGreen.scrambling.tries} greens` : 'Needs putts entered'} />
                <Tile label="Putts a round" value={s.puttsPerRound === null ? '–' : String(s.puttsPerRound)} sub={teeToGreen.puttsPerGreen === null ? undefined : `${teeToGreen.puttsPerGreen} per green hit`} />
              </div>
            </section>
          ) : (
            <section className="golf-card">
              <h2>Putting</h2>
              <div className="golf-tiles is-small">
                <Tile label="Circle 1 (inside 10 m)" value={rateText(s.c1)} sub={rateSub(s.c1, 'putts')} />
                <Tile label="Circle 2 (10–20 m)" value={rateText(s.c2)} sub={rateSub(s.c2, 'putts')} />
              </div>
              {s.trend.some((p) => p.vsCourse !== null) && (
                <p className="golf-hint">Against your own average on the same course: {s.trend.filter((p) => p.vsCourse !== null).slice(-5).map((p) => `${p.vsCourse! > 0 ? '+' : ''}${p.vsCourse}`).join(', ')} (last five).</p>
              )}
            </section>
          )}

          <section className="golf-card">
            <h2>Distances</h2>
            {!drives && !byGear.length && <p className="golf-muted">Mark drives and shots during a round and how far they go shows up here.</p>}
            {drives && (
              <p>
                Drives: <strong>{formatDistance(drives.average, unit)}</strong> on average, longest {formatDistance(drives.longest, unit)}, from {drives.count}.
                {drives.leftRight.average !== null && <> Misses: {drives.leftRight.left} left, {drives.leftRight.right} right; on average {formatDistance(Math.abs(drives.leftRight.average), unit)} {drives.leftRight.average > 0 ? 'right' : 'left'} of the line.</>}
              </p>
            )}
            {byGear.length > 0 && (
              <table className="golf-table">
                <thead><tr><th scope="col">{sport === 'golf' ? 'Club' : 'Disc'}</th><th scope="col">Average</th><th scope="col">Longest</th><th scope="col">Shots</th></tr></thead>
                <tbody>{byGear.map((g) => <tr key={g.name}><th scope="row">{g.name}</th><td>{formatDistance(g.average, unit)}</td><td>{formatDistance(g.longest, unit)}</td><td>{g.count}</td></tr>)}</tbody>
              </table>
            )}
          </section>

          {sport === 'golf' && s.handicap.length > 0 && (
            <section className="golf-card">
              <h2>Rated rounds</h2>
              <p className="golf-hint">A World Handicap System estimate: each hole is capped at net double bogey, the best 8 of your last 20 differentials count, and two 9-hole rounds make one 18. It skips the playing-conditions adjustment, so it can differ a little from an official index.</p>
              <table className="golf-table">
                <thead><tr><th scope="col">Date</th><th scope="col">Holes</th><th scope="col">Differential</th><th scope="col">Index after</th></tr></thead>
                <tbody>{[...s.handicap].reverse().slice(0, 20).map((h) => <tr key={h.roundId}><th scope="row">{shortDate(h.date)}</th><td>{h.holes}</td><td>{h.differential}</td><td>{h.index ?? '–'}</td></tr>)}</tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
