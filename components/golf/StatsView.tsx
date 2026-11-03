'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDistance, unitFor } from '@/lib/golf/geo';
import { formatToPar } from '@/lib/golf/round';
import { golfStats, pct, roundsFor, summarizeThrows, throwsFor, type Rate } from '@/lib/golf/stats';
import type { Sport } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { Seg, shortDate } from './ui';

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };

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

export default function StatsView({ golf, me, go }: ScreenProps) {
  const sports = useMemo(() => [...new Set(golf.data.rounds.filter((r) => r.finishedAt).map((r) => r.sport))], [golf.data.rounds]);
  const [sport, setSport] = useState<Sport>(sports[0] || 'golf');
  const [courseId, setCourseId] = useState('');
  const played = useMemo(() => roundsFor(golf.data.rounds, me, sport), [golf.data.rounds, me, sport]);
  const courseOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const r of played) if (r.courseId) ids.set(r.courseId, r.courseName);
    return [...ids.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [played]);
  const s = useMemo(() => golfStats(golf.data.rounds, me, sport, courseId || undefined), [golf.data.rounds, me, sport, courseId]);
  const unit = unitFor(sport, golf.data.user.units);
  const throws = useMemo(() => throwsFor(roundsFor(golf.data.rounds, me, sport, courseId || undefined), me, golf.data.courses), [golf.data.rounds, golf.data.courses, me, sport, courseId]);
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

  const holes: 9 | 18 = s.average[18].rounds >= s.average[9].rounds ? 18 : 9;
  const trend = s.trend.filter((p) => p.holes === holes).map((p) => ({ label: shortDate(p.date), toPar: p.toPar, detail: `${p.strokes} at ${p.courseName}` }));
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
        <Seg label="Sport" value={sport} onChange={(v) => { setSport(v); setCourseId(''); }} options={[['golf', '⛳ Golf'], ['disc', '🥏 Disc golf']]} />
        {courseOptions.length > 1 && (
          <select className="golf-input is-small" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
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
            {s.average[18].rounds > 0 && <Tile label="18-hole average" value={String(s.average[18].strokes)} sub={`${formatToPar(s.average[18].toPar!)} · best ${s.best[18] ? formatToPar(s.best[18].toPar) : '–'}`} />}
            {s.average[9].rounds > 0 && <Tile label="9-hole average" value={String(s.average[9].strokes)} sub={`${formatToPar(s.average[9].toPar!)} · best ${s.best[9] ? formatToPar(s.best[9].toPar) : '–'}`} />}
            {sport === 'golf' && <Tile label="Handicap (estimate)" value={hcp === null ? '–' : hcp < 0 ? `+${-hcp}` : String(hcp)} sub={hcp === null ? `${s.handicap.length} of 3 rated rounds` : `from ${s.handicap.length} rated rounds`} />}
            {s.penaltiesPerRound !== null && <Tile label="Penalties a round" value={String(s.penaltiesPerRound)} />}
          </div>

          {trend.length > 1 && (
            <section className="golf-card">
              <h2>Score to par, {holes}-hole rounds</h2>
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
              {[3, 4, 5].filter((p) => s.byPar[p] !== undefined && s.byPar[p] !== null).map((p) => <Tile key={p} label={`Par ${p}s`} value={`${s.byPar[p]! > 0 ? '+' : ''}${s.byPar[p]}`} sub="a hole, on average" />)}
            </div>
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
                <Tile label="Greens in regulation" value={rateText(s.greens)} sub={rateSub(s.greens, 'holes with putts')} />
                <Tile label="Scrambling" value={rateText(s.scrambling)} sub={s.scrambling.tries ? `par or better after missing ${s.scrambling.tries} greens` : 'Needs putts entered'} />
                <Tile label="Putts a round" value={s.puttsPerRound === null ? '–' : String(s.puttsPerRound)} sub={s.puttsPerGreen === null ? undefined : `${s.puttsPerGreen} per green hit`} />
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
