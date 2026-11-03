'use client';

import { useMemo, useState } from 'react';
import { blankLayout, courseCenter } from '@/lib/golf/course';
import { distance, formatDistance } from '@/lib/golf/geo';
import type { OsmCourse } from '@/lib/golf/osm';
import { MAX_PLAYERS, createRound, defaultPar, newId } from '@/lib/golf/round';
import type { Course, Player, Sport } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import { useGps } from './useGps';
import { Seg, sportName } from './ui';

const GUESTS_KEY = 'golf:last-guests';

function lastGuests(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(GUESTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_PLAYERS - 1) : [];
  } catch {
    return [];
  }
}

export default function NewRound({ golf, me, go, sport: initialSport }: ScreenProps & { sport: Sport }) {
  const [sport, setSport] = useState<Sport>(initialSport);
  const gps = useGps(true);
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [holes, setHoles] = useState(18);
  const [osm, setOsm] = useState<OsmCourse[] | null>(null);
  const [osmPick, setOsmPick] = useState<OsmCourse | null>(null);
  const [osmBusy, setOsmBusy] = useState(false);
  const [osmError, setOsmError] = useState('');
  const [guests, setGuests] = useState<string[]>(lastGuests);
  const [myName, setMyName] = useState(golf.mode === 'account' ? golf.name : 'Me');

  const here = gps.fix;
  const courses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return golf.data.courses
      .filter((c) => c.sport === sport && (!q || c.name.toLowerCase().includes(q)))
      .map((c) => ({ course: c, away: here && courseCenter(c) ? distance(here, courseCenter(c)!) : null }))
      .sort((a, b) => (a.away ?? Infinity) - (b.away ?? Infinity) || a.course.name.localeCompare(b.course.name));
  }, [golf.data.courses, sport, query, here]);
  const course = golf.data.courses.find((c) => c.id === courseId) || null;
  const layout = course?.layouts.find((l) => l.id === layoutId) || course?.layouts[0] || null;

  const lookUp = async () => {
    if (golf.mode !== 'account') { setOsmError('Sign in to look courses up.'); return; }
    setOsmBusy(true);
    setOsmError('');
    try {
      const fix = here || (await gps.best(3000));
      const res = await fetch(`/api/golf/courses/osm?sport=${sport}&lat=${fix.lat}&lon=${fix.lon}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Lookup failed');
      setOsm(body.courses);
      if (!body.courses.length) setOsmError('Nothing mapped here. Add the holes as you play: your first drive on each hole marks its tee.');
    } catch (e) {
      setOsmError((e as Error).message);
    } finally {
      setOsmBusy(false);
    }
  };

  const start = () => {
    let useCourse: Course | null = course;
    let useLayout = layout;
    if (creating) {
      const name = newName.trim() || osmPick?.name || `${sportName(sport)} course`;
      const l = osmPick
        ? { id: newId(8), name: sport === 'golf' ? 'Tees' : 'Main', holes: osmPick.holes.map((h, i) => ({ ...h, n: i + 1 })) }
        : blankLayout(sport, holes);
      const now = new Date().toISOString();
      useCourse = { id: newId(), sport, name, layouts: [l], createdBy: golf.mode === 'account' ? me : null, createdAt: now, updatedAt: now, ...(osmPick ? { osm: osmPick.osm, center: osmPick.center } : here ? { center: { lat: here.lat, lon: here.lon } } : {}) };
      useLayout = l;
      golf.addCourse(useCourse);
    }
    const names = guests.map((g) => g.trim()).filter(Boolean);
    try { localStorage.setItem(GUESTS_KEY, JSON.stringify(names)); } catch { /* blocked */ }
    const players: Player[] = [{ id: newId(8), name: myName.trim() || 'Me', userId: me }, ...names.map((n) => ({ id: newId(8), name: n }))];
    const round = createRound({ sport, course: useCourse, layout: useLayout, holes, players, scorerId: golf.mode === 'account' ? me : null, courseName: 'Round' });
    golf.startRound(round);
    go(`round/${round.id}`, true);
  };

  const canStart = creating || !!course;

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
          <h1>New round</h1>
        </div>
      </header>

      <section className="golf-card">
        <Seg label="Sport" value={sport} onChange={(s) => { setSport(s); setCourseId(null); setOsm(null); setOsmPick(null); }} options={[['golf', '⛳ Golf'], ['disc', '🥏 Disc golf']]} />
      </section>

      <section className="golf-card">
        <h2>Course</h2>
        {!creating && (
          <>
            {golf.data.courses.some((c) => c.sport === sport) && (
              <input className="golf-input" type="search" placeholder="Search courses" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search courses" />
            )}
            <div className="golf-pick-list">
              {courses.map(({ course: c, away }) => (
                <button key={c.id} type="button" className="golf-pick" aria-pressed={c.id === courseId} onClick={() => { setCourseId(c.id); setLayoutId(c.layouts[0].id); }}>
                  <strong>{c.name}</strong>
                  <small>{c.layouts[0].holes.length} holes{away !== null ? ` · ${away < 1000 ? 'here' : `${(away / 1609).toFixed(1)} mi away`}` : ''}</small>
                </button>
              ))}
            </div>
            {course && course.layouts.length > 1 && (
              <label className="golf-field">{sport === 'golf' ? 'Tees' : 'Layout'}
                <select className="golf-input" value={layout?.id} onChange={(e) => setLayoutId(e.target.value)}>
                  {course.layouts.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.holes.length} holes{l.rating ? ` · ${l.rating}/${l.slope}` : ''}</option>)}
                </select>
              </label>
            )}
            {course && sport === 'golf' && layout && !layout.rating && (
              <p className="golf-hint">No course rating and slope for these tees yet, so this round won&apos;t count toward a handicap. Add them from the scorecard in the course page.</p>
            )}
            <button type="button" className="golf-btn" onClick={() => { setCreating(true); setCourseId(null); }}>+ New course</button>
          </>
        )}
        {creating && (
          <>
            <label className="golf-field">Name
              <input className="golf-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={osmPick?.name || 'e.g. Riverside Park'} />
            </label>
            {!osmPick && (
              <label className="golf-field">Holes
                <Seg label="Holes" value={String(holes)} onChange={(v) => setHoles(Number(v))} options={[['9', '9'], ['18', '18'], ...(sport === 'disc' ? [['24', '24'] as [string, string], ['27', '27'] as [string, string]] : [])]} />
              </label>
            )}
            <div className="golf-row-actions">
              <button type="button" className="golf-btn" disabled={osmBusy} onClick={lookUp}>{osmBusy ? 'Looking…' : '🗺️ Look it up on OpenStreetMap'}</button>
              <button type="button" className="golf-btn is-quiet" onClick={() => { setCreating(false); setOsm(null); setOsmPick(null); }}>Cancel</button>
            </div>
            {osmError && <p className="golf-hint">{osmError}</p>}
            {osm && osm.length > 0 && (
              <div className="golf-pick-list">
                {osm.map((c) => (
                  <button key={c.osm} type="button" className="golf-pick" aria-pressed={osmPick?.osm === c.osm} onClick={() => { setOsmPick(osmPick?.osm === c.osm ? null : c); if (!newName) setNewName(c.name); }}>
                    <strong>{c.name || 'Unnamed course'}</strong>
                    <small>{c.holes.length} holes mapped · par {c.holes.reduce((a, h) => a + h.par, 0)}{here ? ` · ${formatDistance(distance(here, c.center), 'yd')} away` : ''}</small>
                  </button>
                ))}
              </div>
            )}
            {!osmPick && <p className="golf-hint">Every hole starts at par {defaultPar(sport)}; change it as you play. Your first drive on each hole marks where its tee is.</p>}
          </>
        )}
      </section>

      <section className="golf-card">
        <h2>Players</h2>
        <label className="golf-field">You
          <input className="golf-input" value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} />
        </label>
        {guests.map((g, i) => (
          <div key={i} className="golf-row-actions">
            <input className="golf-input" value={g} placeholder={`Player ${i + 2}`} aria-label={`Player ${i + 2}`} maxLength={40} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="golf-icon-btn" aria-label={`Remove player ${i + 2}`} onClick={() => setGuests(guests.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {guests.length < MAX_PLAYERS - 1 && <button type="button" className="golf-btn is-small" onClick={() => setGuests([...guests, ''])}>+ Add a player</button>}
        {golf.mode === 'account' && <p className="golf-hint">Friends with an account can join from their own phone with the round&apos;s code, and it counts in their stats too.</p>}
      </section>

      <button type="button" className="golf-btn is-primary is-wide" disabled={!canStart} onClick={start}>Tee off</button>
    </div>
  );
}
