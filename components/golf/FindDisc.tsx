'use client';

import { useMemo, useState } from 'react';
import { bearing, distance, formatDistance, unitFor } from '@/lib/golf/geo';
import { angleSpread, distanceSpread, searchArea, whereInArea, type Feel } from '@/lib/golf/lost-disc';
import { playerFor } from '@/lib/golf/round';
import { roundsFor, throwsFor } from '@/lib/golf/stats';
import type { Disc, Fix, LatLon } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import GolfMap, { type MapLine, type MapPoint } from './GolfMap';
import { useCompass } from './useCompass';
import { useGps } from './useGps';
import { Seg } from './ui';

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compassWord = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const now = () => new Date().toISOString();

/**
 * Where a lost disc probably is. Opened from a shot marked "Can't find it" (the throw's
 * start and disc are known), or on its own (start where you stand, or tap the map).
 */
export default function FindDisc({ golf, me, go, popup, roundId, shotId }: ScreenProps & { roundId?: string; shotId?: string }) {
  const round = roundId ? golf.data.rounds.find((r) => r.id === roundId) || null : null;
  const shot = round?.shots.find((s) => s.id === shotId) || null;
  const gps = useGps(true);
  const compass = useCompass();
  const user = golf.data.user;
  const discs = user.discs;
  const [discId, setDiscId] = useState(shot?.discId || discs.find((d) => d.inBag)?.id || '');
  const [fromPick, setFromPick] = useState<Fix | null>(null);
  const [heading, setHeading] = useState<{ deg: number; error: number; how: string } | null>(null);
  const [feel, setFeel] = useState<Feel>('normal');
  const [aiming, setAiming] = useState<'map' | 'from' | null>(null);
  const unit = unitFor('disc', user.units);

  const from: Fix | null = shot?.from || fromPick;
  // A drive was aimed at the basket, so that's the starting direction until you set a better one.
  const course = round ? golf.data.courses.find((c) => c.id === round.courseId) : null;
  const target = shot && course ? course.layouts.find((l) => l.id === round!.layoutId)?.holes[shot.hole]?.target : undefined;
  const aim = heading || (from && target ? { deg: bearing(from, target), error: 20, how: 'toward the basket' } : null);
  const disc: Disc | null = discs.find((d) => d.id === discId) || null;

  const throws = useMemo(() => throwsFor(roundsFor(golf.data.rounds, me, 'disc'), me, golf.data.courses), [golf.data.rounds, golf.data.courses, me]);
  // Cheap to work out, so it's simply redone each time anything changes.
  const area = (() => {
    if (!from || !aim) return null;
    const d = disc || { id: '', speed: 7, glide: 5, turn: 0, fade: 2 };
    const speedOf = (id: string) => discs.find((x) => x.id === id)?.speed;
    return searchArea({
      from, heading: aim.deg, headingError: aim.error, gpsError: from.acc, feel,
      distance: distanceSpread(d, throws, speedOf),
      angle: angleSpread(d, user.hand, throws),
    });
  })();

  const here = gps.fix;
  const where = area && here ? whereInArea(area, here) : null;
  const toCenter = area && here ? { d: distance(here, area.center), b: bearing(here, area.center) } : null;

  const tap = (p: LatLon) => {
    if (aiming === 'from') { setFromPick({ ...p, acc: 8, at: now() }); setAiming(null); return; }
    if (aiming === 'map' && from) { setHeading({ deg: bearing(from, p), error: 5, how: 'from the map' }); setAiming(null); }
  };

  const found = async () => {
    try {
      const at = await gps.best(3000);
      if (round && shot) golf.edit(round.id, [{ type: 'shot', shot: { ...shot, to: at, lost: undefined, at: now() } }]);
      if (disc?.lost) golf.saveUser({ ...user, discs: discs.map((d) => (d.id === disc.id ? { ...d, lost: undefined } : d)) });
      await popup.showAlert({ title: 'Found it', message: 'Where it was is saved with the throw, so the next search knows you a little better.' });
      go(round ? `round/${round.id}` : '', true);
    } catch (e) {
      await popup.showAlert({ title: 'No GPS', message: (e as Error).message });
    }
  };

  const giveUp = () => {
    if (disc && area) golf.saveUser({ ...user, discs: discs.map((d) => (d.id === disc.id ? { ...d, inBag: false, lost: { at: now(), where: area.center } } : d)) });
    go(round ? `round/${round.id}` : '', true);
  };

  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  if (from) points.push({ id: 'from', at: from, tone: 'tee', label: 'Thrown from' });
  if (target) points.push({ id: 'target', at: target, tone: 'target', label: 'Basket' });
  if (area) {
    points.push({ id: 'center', at: area.center, tone: 'center', label: 'Most likely' });
    lines.push({ id: 'aim', points: [area.from, area.center], tone: 'aim', dashed: true });
  }
  const basis = area ? (area.distance.source === 'guess'
    ? 'A first guess from the disc\'s speed. Mark where your throws land in rounds and it learns how far and which way you throw.'
    : `From ${area.distance.samples} of your throws ${area.distance.source === 'disc' ? 'with this disc' : 'with discs of similar speed'}.`) : '';

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <button type="button" className="golf-back" onClick={() => go(round ? `round/${round.id}` : '')}>← {round ? 'Round' : 'Golf'}</button>
          <h1>Find a disc</h1>
          {round && shot && <p className="golf-muted">Hole {shot.hole + 1} at {round.courseName}</p>}
        </div>
      </header>

      <section className="golf-card">
        {discs.length > 0 ? (
          <label className="golf-field">Which disc
            <select className="golf-input" value={discId} onChange={(e) => setDiscId(e.target.value)}>
              <option value="">Not sure</option>
              {discs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.speed}/{d.glide}/{d.turn}/{d.fade}){d.color ? ` · ${d.color}` : ''}</option>)}
            </select>
          </label>
        ) : <p className="golf-hint">Add your discs in the bag for a better guess.</p>}

        {!shot && (
          <div className="golf-field">Thrown from
            <div className="golf-row-actions">
              <button type="button" className="golf-btn" onClick={async () => { try { setFromPick(await gps.best(3000)); } catch (e) { void popup.showAlert({ title: 'No GPS', message: (e as Error).message }); } }}>I&apos;m standing there</button>
              <button type="button" className="golf-btn" aria-pressed={aiming === 'from'} onClick={() => setAiming(aiming === 'from' ? null : 'from')}>Tap it on the map</button>
            </div>
          </div>
        )}

        {from && (
          <div className="golf-field">Which way it went{aim ? ` · ${Math.round(aim.deg)}° ${compassWord(aim.deg)} (${aim.how})` : ''}
            <div className="golf-row-actions">
              {compass.status === 'on' && compass.heading !== null ? (
                <button type="button" className="golf-btn is-primary" onClick={() => setHeading({ deg: compass.heading!, error: 15, how: 'by compass' })}>Set: pointing {Math.round(compass.heading)}° {compassWord(compass.heading)}</button>
              ) : (
                <button type="button" className="golf-btn" onClick={() => void compass.start()}>Point the phone down the line</button>
              )}
              <button type="button" className="golf-btn" aria-pressed={aiming === 'map'} onClick={() => setAiming(aiming === 'map' ? null : 'map')}>Tap the line on the map</button>
            </div>
            {compass.status === 'denied' && <p className="golf-hint">Compass permission was refused; tap the map instead.</p>}
            {compass.status === 'missing' && <p className="golf-hint">This phone isn&apos;t sending a compass reading; tap the map instead.</p>}
            {compass.status === 'on' && <p className="golf-hint">Stand where you threw from, point the top of the phone where the disc went, then tap Set. Keep it away from your bag and cart.</p>}
          </div>
        )}

        <label className="golf-field">How did it feel?
          <Seg label="How the throw felt" value={feel} onChange={setFeel} options={[['short', 'Short'], ['normal', 'Normal'], ['big', 'Big one']]} />
        </label>
      </section>

      <section className="golf-card">
        <GolfMap points={points} lines={lines} me={here}
          areas={area ? [{ id: 'possible', points: area.areas[90], tone: 'possible' }, { id: 'likely', points: area.areas[70], tone: 'likely' }] : []}
          fit={area ? [...area.areas[90], ...(here ? [here] : [])] : from ? [from] : here ? [here] : undefined}
          fitKey={`${area ? `${Math.round(area.centerBearing)}-${Math.round(area.distance.mean)}-${feel}` : from ? 'from' : here ? 'me' : ''}`}
          onTap={aiming ? tap : undefined} className="is-tall" />
        {aiming && <p className="golf-hint">{aiming === 'from' ? 'Tap where it was thrown from.' : 'Tap any point along the line it flew.'}</p>}
        {area && (
          <>
            <p className="golf-find-guide">
              {where === 'likely' ? <strong>You&apos;re in the likely area. Search here first.</strong>
                : toCenter ? <><strong>{formatDistance(toCenter.d, unit)} {compassWord(toCenter.b)}</strong> to the middle of the likely area{where === 'possible' ? ' (you\'re in the wider one)' : ''}.</>
                : 'Finding you…'}
            </p>
            <p className="golf-hint">
              About {formatDistance(area.distance.mean, unit)} out, give or take {formatDistance(area.distance.sd, unit)}. The dark area holds it about 70% of the time, the light one about 90%. {basis}
            </p>
            <div className="golf-row-actions">
              <button type="button" className="golf-btn is-primary" onClick={found}>Found it (I&apos;m standing at it)</button>
              <button type="button" className="golf-btn" onClick={giveUp}>Give up{disc ? `: mark the ${disc.name} lost` : ''}</button>
            </div>
          </>
        )}
        {!area && <p className="golf-hint">{from ? 'Set which way it went to see where to look.' : 'Say where it was thrown from first.'}</p>}
      </section>
      {round && playerFor(round, me) === null && <p className="golf-hint">You&apos;re not a player in this round, so the throw isn&apos;t yours to update.</p>}
    </div>
  );
}
