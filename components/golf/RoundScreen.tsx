'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useWakeLock } from '@/components/useWakeLock';
import { distance, formatDistance, offLine, unitFor } from '@/lib/golf/geo';
import { formatToPar, isComplete, newId, nextHole, playerFor, playerTotals, scoreName } from '@/lib/golf/round';
import type { Fairway, Fix, HoleScore, LatLon, Player, Putts, Round, RoundOp, Shot } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import GolfMap, { type MapLine, type MapPoint } from './GolfMap';
import { SyncStatus } from './Hub';
import { POOR_ACCURACY_M, useGps } from './useGps';
import { Seg, Sheet, Stepper, toParClass } from './ui';

const DETAILS_KEY = 'golf:details';
const now = () => new Date().toISOString();

export default function RoundScreen({ golf, me, go, popup, roundId, sunlight, setSunlight }: ScreenProps & { roundId: string }) {
  const round = golf.data.rounds.find((r) => r.id === roundId) || null;
  const [hole, setHole] = useState<number | null>(null);
  const [tab, setTab] = useState<'hole' | 'card' | 'map'>('hole');
  const [sheet, setSheet] = useState<'share' | 'finish' | 'menu' | null>(null);
  const [details, setDetails] = useState(() => { try { return localStorage.getItem(DETAILS_KEY) === '1'; } catch { return false; } });
  const finished = !!round?.finishedAt;
  const gps = useGps(!!round && !finished && tab !== 'card');
  useWakeLock(!!round && !finished && golf.data.user.keepAwake);

  // Open on the first hole that still needs a score.
  useEffect(() => { if (round && hole === null) setHole(finished ? 0 : nextHole(round)); }, [round, hole, finished]);

  if (!round) {
    return (
      <div className="golf-screen">
        <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
        <h1>Round not found</h1>
        <p className="golf-muted">It may have been deleted, or it&apos;s saved under another account.</p>
      </div>
    );
  }
  const h = Math.min(hole ?? 0, round.pars.length - 1);
  const course = golf.data.courses.find((c) => c.id === round.courseId) || null;
  const layout = course?.layouts.find((l) => l.id === round.layoutId) || null;
  const courseHole = layout?.holes[h] || null;
  const mine = playerFor(round, me);
  const unit = unitFor(round.sport, golf.data.user.units);
  const edit = (ops: RoundOp[]) => golf.edit(round.id, ops);
  const toggleDetails = () => { setDetails(!details); try { localStorage.setItem(DETAILS_KEY, details ? '0' : '1'); } catch { /* blocked */ } };

  return (
    <div className="golf-screen golf-round animate-fade-in">
      <header className="golf-round-head">
        <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
        <div className="golf-round-title">
          <h1>{round.courseName}</h1>
          <small>{[round.layoutName, `${round.pars.length} holes`, finished ? 'Finished' : null].filter(Boolean).join(' · ')}</small>
        </div>
        <SyncStatus golf={golf} />
        <button type="button" className="golf-icon-btn" aria-label="Round options" onClick={() => setSheet('menu')}>⋯</button>
      </header>

      <div className="golf-tabs" role="tablist">
        {(['hole', 'card', 'map'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'hole' ? `Hole ${h + 1}` : t === 'card' ? 'Scorecard' : 'Map'}</button>
        ))}
      </div>

      {tab === 'hole' && (
        <HoleView round={round} h={h} setHole={setHole} edit={edit} mine={mine} gps={gps} unit={unit} details={details} toggleDetails={toggleDetails}
          target={courseHole?.target || null} tee={courseHole?.tee || null} length={courseHole?.length}
          bag={golf.data.user} onFinish={() => setSheet('finish')}
          learn={(change) => { if (course && layout) golf.setHole(course.id, { layoutId: layout.id, n: h + 1, ...change }); }}
          go={go} popup={popup} />
      )}
      {tab === 'card' && <CardView round={round} onPick={(i) => { setHole(i); setTab('hole'); }} me={me} />}
      {tab === 'map' && (
        <HoleMap round={round} h={h} setHole={setHole} me={me} gps={gps.fix} rounds={golf.data.rounds} unit={unit}
          tee={courseHole?.tee || null} target={courseHole?.target || null}
          onMove={course && layout ? (change) => golf.setHole(course.id, { layoutId: layout.id, n: h + 1, ...change }) : null} />
      )}

      {sheet === 'menu' && (
        <Sheet title="Round" onClose={() => setSheet(null)}>
          <div className="golf-sheet-actions">
            {golf.mode === 'account' && <button type="button" className="golf-btn" onClick={() => setSheet('share')}>Let friends join</button>}
            <button type="button" className="golf-btn" aria-pressed={sunlight} onClick={() => setSunlight(!sunlight)}>☀️ Sunlight mode {sunlight ? 'on' : 'off'}</button>
            {finished
              ? <button type="button" className="golf-btn" onClick={() => { edit([{ type: 'finish', finished: false, at: now() }]); setSheet(null); }}>Reopen the round</button>
              : <button type="button" className="golf-btn" onClick={() => setSheet('finish')}>Finish the round</button>}
            {course && <button type="button" className="golf-btn" onClick={() => go(`course/${course.id}`)}>Course page</button>}
            <PlayersEditor round={round} edit={edit} />
            <button type="button" className="golf-btn is-danger" onClick={async () => {
              const leaving = golf.mode === 'account' && round.scorerId !== me;
              const ok = await popup.confirm(leaving
                ? { title: 'Leave this round?', message: 'It comes off your account and out of your stats. Your name stays on the card as a guest.', confirmLabel: 'Leave', danger: true }
                : { title: 'Delete this round?', message: round.players.some((p) => p.userId && p.userId !== me) ? 'It\'s deleted for everyone who joined it, too.' : 'This can\'t be undone.', confirmLabel: 'Delete', danger: true });
              if (!ok) return;
              golf.deleteRound(round.id);
              go('', true);
            }}>{golf.mode === 'account' && round.scorerId !== me ? 'Leave this round' : 'Delete this round'}</button>
          </div>
        </Sheet>
      )}
      {sheet === 'share' && <ShareSheet round={round} onClose={() => setSheet(null)} />}
      {sheet === 'finish' && (
        <Sheet title={finished ? 'Final scores' : 'Finish the round?'} onClose={() => setSheet(null)}>
          <Totals round={round} me={me} />
          {!isComplete(round) && <p className="golf-hint">Some holes have no score. They&apos;re left out, and an unfinished card doesn&apos;t count toward a handicap.</p>}
          {!finished && (
            <button type="button" className="golf-btn is-primary is-wide" onClick={() => { edit([{ type: 'finish', finished: true, at: now() }]); setSheet(null); setTab('card'); }}>Finish</button>
          )}
        </Sheet>
      )}
    </div>
  );
}

function scoreOp(round: Round, player: Player, h: number, change: Partial<HoleScore> | null): RoundOp {
  const at = now();
  if (change === null) return { type: 'score', playerId: player.id, hole: h, score: null, at };
  const prev = round.scores[player.id]?.[h];
  const base: HoleScore = prev ? { ...prev } : { strokes: round.pars[h], at };
  return { type: 'score', playerId: player.id, hole: h, score: { ...base, ...change, at }, at };
}

type Gps = ReturnType<typeof useGps>;

function HoleView({ round, h, setHole, edit, mine, gps, unit, details, toggleDetails, target, tee, length, bag, onFinish, learn, go, popup }: {
  round: Round; h: number; setHole: (h: number) => void; edit: (ops: RoundOp[]) => void; mine: Player | null; gps: Gps; unit: ReturnType<typeof unitFor>;
  details: boolean; toggleDetails: () => void; target: LatLon | null; tee: LatLon | null; length?: number; bag: ScreenProps['golf']['data']['user'];
  onFinish: () => void; learn: (change: { tee?: LatLon; target?: LatLon }) => void; go: ScreenProps['go']; popup: ScreenProps['popup'];
}) {
  const par = round.pars[h];
  const last = h === round.pars.length - 1;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const toTarget = target && gps.fix ? distance(gps.fix, target) : null;

  return (
    <div
      className="golf-hole"
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start || (e.target as HTMLElement).closest('.golf-stepper, input, select, .golf-map')) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y)) setHole(Math.max(0, Math.min(round.pars.length - 1, h + (dx < 0 ? 1 : -1))));
      }}
    >
      <div className="golf-hole-head">
        <div>
          <h2>Hole {h + 1}</h2>
          <small className="golf-muted">{length ? `${length} ${round.sport === 'golf' ? 'yd' : 'ft'} · ` : ''}{round.si ? `stroke index ${round.si[h]}` : ''}</small>
        </div>
        <label className="golf-par">Par
          <Stepper label="Par" value={par} min={2} max={7} onChange={(v) => edit([{ type: 'par', hole: h, par: v, at: now() }])} />
        </label>
      </div>

      {!round.finishedAt && (
        <div className="golf-range">
          {toTarget !== null
            ? <><strong>{formatDistance(toTarget, unit)}</strong><span>to the {round.sport === 'golf' ? 'pin' : 'basket'}{gps.fix && gps.fix.acc > POOR_ACCURACY_M ? ` (GPS ±${formatDistance(gps.fix.acc, unit)})` : ''}</span></>
            : <span className="golf-muted">{gps.error || (target ? 'Finding you…' : `Tap “${round.sport === 'golf' ? 'Pin' : 'Basket'} is here” at the ${round.sport === 'golf' ? 'hole' : 'basket'} to see distances next time.`)}</span>}
        </div>
      )}

      <div className="golf-players">
        {round.players.map((p) => {
          const s = round.scores[p.id]?.[h] || null;
          const name = scoreName(s?.strokes, par);
          const t = playerTotals(round, p.id);
          return (
            <div key={p.id} className="golf-player">
              <div className="golf-player-top">
                <div className="golf-player-name">
                  <strong>{p.name}{p.id === mine?.id ? ' (you)' : ''}</strong>
                  <small className={t.played ? toParClass(t.toPar) : ''}>{t.played ? `${formatToPar(t.toPar)} · ${t.strokes} thru ${t.played}` : 'No scores yet'}</small>
                </div>
                <div className="golf-player-score">
                  {name && <span className={`golf-badge is-${name}`}>{name}</span>}
                  <Stepper big label={`${p.name} strokes`} value={s?.strokes} placeholder={par} onChange={(v) => edit([scoreOp(round, p, h, { strokes: v })])} />
                </div>
              </div>
              {details && <ScoreDetails round={round} player={p} h={h} score={s} edit={edit} />}
            </div>
          );
        })}
      </div>
      <button type="button" className="golf-btn is-quiet is-small" onClick={toggleDetails}>{details ? 'Hide putts and details' : round.sport === 'golf' ? 'Add putts, fairways, penalties' : 'Add putting circles, penalties'}</button>

      {mine && !round.finishedAt && (
        <ShotPanel round={round} h={h} player={mine} edit={edit} gps={gps} unit={unit} tee={tee} target={target} bag={bag} learn={learn} go={go} popup={popup} />
      )}

      <div className="golf-hole-nav">
        <button type="button" className="golf-btn" disabled={h === 0} onClick={() => setHole(h - 1)}>{h === 0 ? '← Back' : `← Hole ${h}`}</button>
        {last
          ? <button type="button" className="golf-btn is-primary" onClick={onFinish}>{round.finishedAt ? 'Final scores' : 'Finish round'}</button>
          : <button type="button" className="golf-btn is-primary" onClick={() => setHole(h + 1)}>Hole {h + 2} →</button>}
      </div>
    </div>
  );
}

function PuttCircle({ label, value, max, onChange }: { label: string; value: Putts | undefined; max: number; onChange: (v: Putts | undefined) => void }) {
  const [made, tries] = value || [0, 0];
  return (
    <div className="golf-detail">
      <span>{label}</span>
      <div className="golf-putts">
        <label>made <Stepper label={`${label} made`} value={value ? made : null} min={0} max={tries || max} placeholder={0} onChange={(v) => onChange([v, Math.max(v, tries)])} /></label>
        <label>tried <Stepper label={`${label} tried`} value={value ? tries : null} min={0} max={max} placeholder={1} onChange={(v) => onChange(v === 0 ? undefined : [Math.min(made, v), v])} /></label>
      </div>
    </div>
  );
}

function ScoreDetails({ round, player, h, score, edit }: { round: Round; player: Player; h: number; score: HoleScore | null; edit: (ops: RoundOp[]) => void }) {
  const par = round.pars[h];
  const set = (change: Partial<HoleScore>) => edit([scoreOp(round, player, h, change)]);
  const strokes = score?.strokes ?? par;
  return (
    <div className="golf-details">
      {round.sport === 'golf' && (
        <div className="golf-detail"><span>Putts</span><Stepper label="Putts" value={score?.putts} min={0} max={strokes} placeholder={2} onChange={(v) => set({ putts: v })} /></div>
      )}
      {round.sport === 'golf' && par >= 4 && (
        <div className="golf-detail"><span>Tee shot</span>
          <Seg label="Fairway" value={(score?.fairway || '') as Fairway} onChange={(v) => set({ fairway: v })} options={[['left', '← Left'], ['hit', 'Fairway'], ['right', 'Right →'], ['short', 'Short']]} />
        </div>
      )}
      {round.sport === 'disc' && (
        <>
          <PuttCircle label="Circle 1 (inside 10 m)" value={score?.c1} max={strokes} onChange={(v) => set({ c1: v })} />
          <PuttCircle label="Circle 2 (10–20 m)" value={score?.c2} max={strokes} onChange={(v) => set({ c2: v })} />
        </>
      )}
      <div className="golf-detail"><span>Penalty strokes</span><Stepper label="Penalties" value={score?.penalties ?? null} min={0} max={strokes} placeholder={0} onChange={(v) => set({ penalties: v })} /></div>
      {score && <button type="button" className="golf-btn is-quiet is-small" onClick={() => edit([scoreOp(round, player, h, null)])}>Clear this hole</button>}
    </div>
  );
}

function ShotPanel({ round, h, player, edit, gps, unit, tee, target, bag, learn, go, popup }: {
  round: Round; h: number; player: Player; edit: (ops: RoundOp[]) => void; gps: Gps; unit: ReturnType<typeof unitFor>;
  tee: LatLon | null; target: LatLon | null; bag: ScreenProps['golf']['data']['user']; learn: (c: { tee?: LatLon; target?: LatLon }) => void;
  go: ScreenProps['go']; popup: ScreenProps['popup'];
}) {
  const [busy, setBusy] = useState(false);
  const [gear, setGear] = useState('');
  const shots = round.shots.filter((s) => s.playerId === player.id && s.hole === h && !s.deleted);
  const open = shots.find((s) => !s.to && !s.lost) || null;
  const gearList = round.sport === 'golf' ? bag.clubs : bag.discs.filter((d) => d.inBag);

  /** A reading good enough to use, or null if they chose to wait. */
  const fix = async (): Promise<Fix | null> => {
    try {
      const f = await gps.best();
      if (f.acc > POOR_ACCURACY_M && !(await popup.confirm({ title: 'GPS is rough here', message: `It's only good to about ${formatDistance(f.acc, unit)} right now. Use it anyway?`, confirmLabel: 'Use it', cancelLabel: 'Wait' }))) return null;
      return f;
    } catch (e) {
      await popup.showAlert({ title: 'No GPS', message: (e as Error).message });
      return null;
    }
  };

  const begin = async (kind: Shot['kind']) => {
    setBusy(true);
    try {
      let from: Fix | null;
      if (kind === 'drive' && tee) from = { ...tee, acc: 3, at: now() };
      else from = await fix();
      if (!from) return;
      // The first drive on a hole nobody has mapped tells the course where its tee is.
      if (kind === 'drive' && !tee) learn({ tee: { lat: from.lat, lon: from.lon } });
      const shot: Shot = { id: newId(10), playerId: player.id, hole: h, kind, from, at: now() };
      if (gear) shot[round.sport === 'golf' ? 'clubId' : 'discId'] = gear;
      edit([{ type: 'shot', shot }]);
    } finally {
      setBusy(false);
    }
  };

  const land = async (shot: Shot) => {
    setBusy(true);
    try {
      const to = await fix();
      if (to) edit([{ type: 'shot', shot: { ...shot, to, at: now() } }]);
    } finally {
      setBusy(false);
    }
  };

  const markTarget = async () => {
    setBusy(true);
    try {
      const f = await fix();
      if (f) learn({ target: { lat: f.lat, lon: f.lon } });
    } finally {
      setBusy(false);
    }
  };

  const gearName = (s: Shot) => (round.sport === 'golf' ? bag.clubs.find((c) => c.id === s.clubId)?.name : bag.discs.find((d) => d.id === s.discId)?.name);

  return (
    <section className="golf-shots" aria-label="Shots">
      {open ? (
        <div className="golf-open-shot">
          <p><strong>{open.kind === 'drive' ? 'Drive' : 'Shot'} marked{gearName(open) ? ` (${gearName(open)})` : ''}.</strong> Walk to where it {round.sport === 'golf' ? 'stopped' : 'landed'}, then tap Here.</p>
          {gps.fix && <p className="golf-muted">{formatDistance(distance(open.from, gps.fix), unit)} so far</p>}
          <div className="golf-row-actions">
            <button type="button" className="golf-btn is-primary" disabled={busy} onClick={() => land(open)}>{busy ? 'Reading GPS…' : 'Here'}</button>
            {round.sport === 'disc' && <button type="button" className="golf-btn" onClick={() => { edit([{ type: 'shot', shot: { ...open, lost: true, at: now() } }]); go(`find/${round.id}/${open.id}`); }}>Can&apos;t find it</button>}
            <button type="button" className="golf-btn is-quiet" onClick={() => edit([{ type: 'shot', shot: { ...open, deleted: true, at: now() } }])}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {gearList.length > 0 && (
            <select className="golf-input is-small" value={gear} onChange={(e) => setGear(e.target.value)} aria-label={round.sport === 'golf' ? 'Club' : 'Disc'}>
              <option value="">{round.sport === 'golf' ? 'Club (optional)' : 'Disc (optional)'}</option>
              {gearList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <div className="golf-row-actions">
            {!shots.some((s) => s.kind === 'drive') && <button type="button" className="golf-btn" disabled={busy} onClick={() => begin('drive')}>📍 Mark drive</button>}
            <button type="button" className="golf-btn" disabled={busy} onClick={() => begin('approach')}>📍 Mark a shot</button>
            <button type="button" className="golf-btn is-quiet" disabled={busy} onClick={markTarget}>{round.sport === 'golf' ? '⛳ Pin is here' : '🧺 Basket is here'}</button>
          </div>
        </>
      )}
      {shots.filter((s) => s.to || s.lost).map((s) => {
        const d = s.to ? distance(s.from, s.to) : null;
        const side = s.to && target && s.kind === 'drive' ? offLine(s.from, target, s.to).offline : null;
        return (
          <div key={s.id} className="golf-shot">
            <span>{s.kind === 'drive' ? 'Drive' : 'Shot'}{gearName(s) ? ` · ${gearName(s)}` : ''}</span>
            <strong>{s.lost ? 'Lost' : formatDistance(d!, unit)}</strong>
            {side !== null && Math.abs(side) >= 1 && <small>{formatDistance(Math.abs(side), unit)} {side > 0 ? 'right' : 'left'}</small>}
            {s.lost && <button type="button" className="golf-btn is-small" onClick={() => go(`find/${round.id}/${s.id}`)}>Search</button>}
            <button type="button" className="golf-icon-btn" aria-label="Remove this shot" onClick={() => edit([{ type: 'shot', shot: { ...s, deleted: true, at: now() } }])}>✕</button>
          </div>
        );
      })}
    </section>
  );
}

function CardView({ round, onPick, me }: { round: Round; onPick: (h: number) => void; me: string }) {
  const n = round.pars.length;
  const halves = n === 18 ? [[0, 9, 'Out'], [9, 18, 'In']] as const : null;
  const cols: ({ kind: 'hole'; i: number } | { kind: 'sum'; from: number; to: number; label: string })[] = [];
  for (let i = 0; i < n; i++) {
    cols.push({ kind: 'hole', i });
    if (halves && i === 8) cols.push({ kind: 'sum', from: 0, to: 9, label: 'Out' });
  }
  if (halves) cols.push({ kind: 'sum', from: 9, to: 18, label: 'In' });
  cols.push({ kind: 'sum', from: 0, to: n, label: 'Total' });
  return (
    <div className="golf-card-wrap">
      <table className="golf-scorecard">
        <thead>
          <tr><th scope="col">Hole</th>{cols.map((c, k) => <th key={k} scope="col" className={c.kind === 'sum' ? 'is-sum' : ''}>{c.kind === 'hole' ? c.i + 1 : c.label}</th>)}</tr>
          <tr className="is-par"><th scope="row">Par</th>{cols.map((c, k) => <td key={k} className={c.kind === 'sum' ? 'is-sum' : ''}>{c.kind === 'hole' ? round.pars[c.i] : round.pars.slice(c.from, c.to).reduce((a, b) => a + b, 0)}</td>)}</tr>
        </thead>
        <tbody>
          {round.players.map((p) => (
            <tr key={p.id} className={p.userId === me ? 'is-me' : ''}>
              <th scope="row">{p.name}</th>
              {cols.map((c, k) => {
                if (c.kind === 'sum') {
                  const t = playerTotals(round, p.id, c.from, c.to);
                  return <td key={k} className="is-sum">{t.played ? t.strokes : ''}</td>;
                }
                const s = round.scores[p.id]?.[c.i];
                const name = scoreName(s?.strokes, round.pars[c.i]);
                return <td key={k}><button type="button" className={`golf-cell${name ? ` is-${name}` : ''}`} aria-label={`Hole ${c.i + 1}, ${p.name}: ${s?.strokes ?? 'no score'}`} onClick={() => onPick(c.i)}>{s?.strokes ?? '·'}</button></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Totals round={round} me={me} />
    </div>
  );
}

function Totals({ round, me }: { round: Round; me: string }) {
  const rows = round.players
    .map((p) => ({ p, t: playerTotals(round, p.id) }))
    .sort((a, b) => (b.t.played ? 1 : 0) - (a.t.played ? 1 : 0) || a.t.toPar - b.t.toPar);
  return (
    <ol className="golf-totals">
      {rows.map(({ p, t }) => (
        <li key={p.id} className={p.userId === me ? 'is-me' : ''}>
          <span>{p.name}</span>
          <strong className={t.played ? toParClass(t.toPar) : ''}>{t.played ? formatToPar(t.toPar) : '–'}</strong>
          <small>{t.played ? `${t.strokes}${t.played < round.pars.length ? ` thru ${t.played}` : ''}${t.putts !== null ? ` · ${t.putts} putts` : ''}` : ''}</small>
        </li>
      ))}
    </ol>
  );
}

function HoleMap({ round, h, setHole, me, gps, rounds, unit, tee, target, onMove }: {
  round: Round; h: number; setHole: (h: number) => void; me: string; gps: Fix | null; rounds: Round[]; unit: ReturnType<typeof unitFor>;
  tee: LatLon | null; target: LatLon | null; onMove: ((c: { tee?: LatLon; target?: LatLon }) => void) | null;
}) {
  const shots = round.shots.filter((s) => s.hole === h && !s.deleted);
  // Your drives on this hole in other rounds on the same course and layout.
  const old = useMemo(() => rounds
    .filter((r) => r.id !== round.id && r.courseId && r.courseId === round.courseId && r.layoutId === round.layoutId)
    .flatMap((r) => { const p = playerFor(r, me); return p ? r.shots.filter((s) => s.playerId === p.id && s.hole === h && s.kind === 'drive' && s.to && !s.deleted) : []; }),
  [rounds, round.id, round.courseId, round.layoutId, me, h]);

  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  if (tee) points.push({ id: 'tee', at: tee, tone: 'tee', label: 'T', onDrag: onMove ? (p) => onMove({ tee: p }) : undefined });
  if (target) points.push({ id: 'target', at: target, tone: 'target', label: round.sport === 'golf' ? '⛳' : '🧺', onDrag: onMove ? (p) => onMove({ target: p }) : undefined });
  if (tee && target) lines.push({ id: 'hole', points: [tee, target], tone: 'hole', dashed: true });
  for (const s of old) {
    lines.push({ id: `old-${s.id}`, points: [s.from, s.to!], tone: 'old' });
    points.push({ id: `old-end-${s.id}`, at: s.to!, tone: 'old' });
  }
  for (const s of shots) {
    const player = round.players.find((p) => p.id === s.playerId);
    if (s.to) {
      lines.push({ id: s.id, points: [s.from, s.to], tone: 'shot' });
      points.push({ id: `end-${s.id}`, at: s.to, tone: 'shot', label: `${player?.name}: ${formatDistance(distance(s.from, s.to), unit)}` });
    } else {
      points.push({ id: `start-${s.id}`, at: s.from, tone: 'shot', label: `${player?.name}: ${s.lost ? 'lost' : 'in the air'}` });
    }
  }
  const fit = [tee, target, ...shots.flatMap((s) => [s.from, s.to])].filter((p): p is LatLon => !!p);

  return (
    <div className="golf-hole-map">
      <div className="golf-hole-nav is-top">
        <button type="button" className="golf-btn is-small" disabled={h === 0} onClick={() => setHole(h - 1)}>←</button>
        <strong>Hole {h + 1} · par {round.pars[h]}</strong>
        <button type="button" className="golf-btn is-small" disabled={h === round.pars.length - 1} onClick={() => setHole(h + 1)}>→</button>
      </div>
      <GolfMap points={points} lines={lines} me={gps} fit={fit.length ? fit : gps ? [gps] : undefined} fitKey={`${round.id}-${h}-${fit.length ? 'h' : gps ? 'me' : ''}`} className="is-tall" />
      <p className="golf-hint">
        {onMove ? 'Drag the tee or the target to fix where they are. ' : ''}
        {old.length ? `Faint lines are your drives here in other rounds (${old.length}).` : 'Your drives here in other rounds will show up faintly.'}
      </p>
    </div>
  );
}

function ShareSheet({ round, onClose }: { round: Round; onClose: () => void }) {
  const [qr, setQr] = useState('');
  const link = typeof window !== 'undefined' ? `${window.location.origin}/golf#join/${round.id}/${round.joinCode}` : '';
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')); }, [link]);
  return (
    <Sheet title="Let friends join" onClose={onClose}>
      <p className="golf-muted">Friends with an account scan this or open the link, then pick their name. Their scores count in their own stats, and they can score from their phone too.</p>
      {qr && <img className="golf-qr" src={qr} alt="QR code for joining this round" width={220} height={220} />}
      <p className="golf-code" aria-label="Join code">{round.joinCode}</p>
      <button type="button" className="golf-btn is-wide" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); }}>Copy the link</button>
    </Sheet>
  );
}

function PlayersEditor({ round, edit }: { round: Round; edit: (ops: RoundOp[]) => void }) {
  const [names, setNames] = useState(() => round.players.map((p) => p.name));
  const [extra, setExtra] = useState('');
  const changed = names.some((n, i) => n.trim() && n.trim() !== round.players[i]?.name) || extra.trim();
  const save = () => {
    const players = round.players.map((p, i) => ({ ...p, name: names[i]?.trim() || p.name }));
    if (extra.trim()) players.push({ id: newId(8), name: extra.trim() });
    edit([{ type: 'players', players, at: now() }]);
    setExtra('');
  };
  return (
    <details className="golf-players-edit">
      <summary>Players</summary>
      {round.players.map((p, i) => (
        <input key={p.id} className="golf-input" value={names[i] ?? ''} maxLength={40} aria-label={`Player ${i + 1} name`} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
      ))}
      {round.players.length < 8 && <input className="golf-input" value={extra} maxLength={40} placeholder="Add a player" onChange={(e) => setExtra(e.target.value)} />}
      <button type="button" className="golf-btn is-small" disabled={!changed} onClick={save}>Save players</button>
    </details>
  );
}
