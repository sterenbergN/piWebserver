'use client';

import { useMemo, useState } from 'react';
import { cleanLayout } from '@/lib/golf/course';
import { distance, fromMetres } from '@/lib/golf/geo';
import { newId } from '@/lib/golf/round';
import { holeAverages } from '@/lib/golf/stats';
import type { Course, Layout } from '@/lib/golf/types';
import type { ScreenProps } from './GolfApp';
import GolfMap, { type MapLine, type MapPoint } from './GolfMap';
import { sportName } from './ui';

const numOrUndefined = (v: string) => (v.trim() === '' ? undefined : Number(v));

export default function CourseView({ golf, me, go, popup, courseId }: ScreenProps & { courseId: string }) {
  const saved = golf.data.courses.find((c) => c.id === courseId) || null;
  const [draft, setDraft] = useState<Course | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const course = draft || saved;
  const layout = course?.layouts.find((l) => l.id === layoutId) || course?.layouts[0] || null;
  const averages = useMemo(() => (course && layout ? holeAverages(golf.data.rounds, me, course.id, layout.id) : []), [golf.data.rounds, me, course, layout]);

  if (!course || !layout) {
    return (
      <div className="golf-screen">
        <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
        <h1>Course not found</h1>
      </div>
    );
  }
  // Lengths on a card are yards (golf) or feet (disc golf), whatever units you've picked.
  const cardUnit = course.sport === 'golf' ? 'yd' : 'ft';
  const editing = !!draft;
  const change = (next: Partial<Course>) => setDraft({ ...(draft || structuredClone(course)), ...next });
  const changeLayout = (next: Partial<Layout>) => change({ layouts: course.layouts.map((l) => (l.id === layout.id ? { ...l, ...next } : l)) });
  const changeHole = (i: number, next: Partial<Layout['holes'][number]>) => changeLayout({ holes: layout.holes.map((h, j) => (j === i ? { ...h, ...next } : h)) });

  const save = () => {
    if (!draft) return;
    const layouts = draft.layouts.map((l) => cleanLayout(l, draft.sport)).filter((l): l is Layout => !!l);
    golf.editCourse({ ...draft, name: draft.name.trim() || saved!.name, layouts });
    setDraft(null);
  };

  const addLayout = () => {
    const l: Layout = { id: newId(8), name: course.sport === 'golf' ? 'New tees' : 'New layout', holes: layout.holes.map((h) => ({ n: h.n, par: h.par, ...(h.target ? { target: h.target } : {}) })) };
    change({ layouts: [...course.layouts, l] });
    setLayoutId(l.id);
  };

  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  layout.holes.forEach((h, i) => {
    const drag = (key: 'tee' | 'target') => (p: { lat: number; lon: number }) => golf.setHole(course.id, { layoutId: layout.id, n: i + 1, [key]: p });
    if (h.tee) points.push({ id: `t${i}`, at: h.tee, tone: 'tee', label: String(i + 1), onDrag: editing ? undefined : drag('tee') });
    if (h.target) points.push({ id: `g${i}`, at: h.target, tone: 'target', label: String(i + 1), onDrag: editing ? undefined : drag('target') });
    if (h.tee && h.target) lines.push({ id: `l${i}`, points: [h.tee, h.target], tone: 'hole', dashed: true });
  });
  const fit = layout.holes.flatMap((h) => [h.tee, h.target]).filter((p): p is { lat: number; lon: number } => !!p);
  const mapped = layout.holes.filter((h) => h.tee && h.target).length;

  return (
    <div className="golf-screen animate-fade-in">
      <header className="golf-head">
        <div>
          <button type="button" className="golf-back" onClick={() => go('')}>← Golf</button>
          {editing
            ? <input className="golf-input is-title" value={course.name} onChange={(e) => change({ name: e.target.value })} aria-label="Course name" maxLength={80} />
            : <h1>{course.name}</h1>}
          <p className="golf-muted">{sportName(course.sport)}{course.osm ? ' · holes from OpenStreetMap' : ''}</p>
        </div>
        {editing
          ? <div className="golf-row-actions"><button type="button" className="golf-btn" onClick={() => setDraft(null)}>Cancel</button><button type="button" className="golf-btn is-primary" onClick={save}>Save</button></div>
          : <button type="button" className="golf-btn" onClick={() => setDraft(structuredClone(course))}>Edit the card</button>}
      </header>

      {course.layouts.length > 1 || editing ? (
        <div className="golf-filters">
          <select className="golf-input is-small" value={layout.id} onChange={(e) => setLayoutId(e.target.value)} aria-label={course.sport === 'golf' ? 'Tees' : 'Layout'}>
            {course.layouts.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.holes.length} holes</option>)}
          </select>
          {editing && <button type="button" className="golf-btn is-small" onClick={addLayout}>+ {course.sport === 'golf' ? 'Tees' : 'Layout'}</button>}
        </div>
      ) : null}

      <section className="golf-card">
        <GolfMap points={points} lines={lines} fit={fit.length ? fit : course.center ? [course.center] : undefined} fitKey={`${course.id}-${layout.id}-${fit.length > 0}`} />
        <p className="golf-hint">{mapped} of {layout.holes.length} holes mapped. {editing ? 'Save the card to move pins on the map.' : `Drag a tee or target to fix it; holes fill in as you mark drives and ${course.sport === 'golf' ? 'pins' : 'baskets'} during rounds.`}</p>
      </section>

      <section className="golf-card">
        <h2>Scorecard</h2>
        {editing && (
          <div className="golf-layout-fields">
            <label className="golf-field">Name<input className="golf-input" value={layout.name} maxLength={40} onChange={(e) => changeLayout({ name: e.target.value })} /></label>
            {course.sport === 'golf' && (
              <>
                <label className="golf-field">Course rating<input className="golf-input" inputMode="decimal" value={layout.rating ?? ''} placeholder="e.g. 71.4" onChange={(e) => changeLayout({ rating: numOrUndefined(e.target.value) })} /></label>
                <label className="golf-field">Slope<input className="golf-input" inputMode="numeric" value={layout.slope ?? ''} placeholder="e.g. 128" onChange={(e) => changeLayout({ slope: numOrUndefined(e.target.value) })} /></label>
              </>
            )}
            <label className="golf-field">Holes
              <select className="golf-input" value={layout.holes.length} onChange={(e) => {
                const n = Number(e.target.value);
                changeLayout({ holes: Array.from({ length: n }, (_, i) => layout.holes[i] || { n: i + 1, par: course.sport === 'golf' ? 4 : 3 }) });
              }}>
                {[9, 12, 18, 21, 24, 27, 36].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
        {course.sport === 'golf' && !editing && (
          <p className="golf-hint">{layout.rating && layout.slope ? `Rating ${layout.rating}, slope ${layout.slope}: rounds here count toward your handicap.` : 'Add the course rating and slope from the printed card (Edit the card) for rounds here to count toward a handicap.'}</p>
        )}
        <div className="golf-card-wrap">
          <table className="golf-table is-holes">
            <thead>
              <tr><th scope="col">Hole</th><th scope="col">Par</th><th scope="col">{course.sport === 'golf' ? 'Yards' : 'Feet'}</th>{course.sport === 'golf' && <th scope="col">Index</th>}<th scope="col">Your avg</th><th scope="col">Mapped</th></tr>
            </thead>
            <tbody>
              {layout.holes.map((h, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  <td>{editing ? <input className="golf-input is-cell" inputMode="numeric" value={h.par} onChange={(e) => changeHole(i, { par: Number(e.target.value) || h.par })} aria-label={`Hole ${i + 1} par`} /> : h.par}</td>
                  <td>{editing ? <input className="golf-input is-cell" inputMode="numeric" value={h.length ?? ''} onChange={(e) => changeHole(i, { length: numOrUndefined(e.target.value) })} aria-label={`Hole ${i + 1} length`} /> : h.length ?? (h.tee && h.target ? `≈${Math.round(fromMetres(distance(h.tee, h.target), cardUnit))}` : '–')}</td>
                  {course.sport === 'golf' && <td>{editing ? <input className="golf-input is-cell" inputMode="numeric" value={h.si ?? ''} onChange={(e) => changeHole(i, { si: numOrUndefined(e.target.value) })} aria-label={`Hole ${i + 1} stroke index`} /> : h.si ?? '–'}</td>}
                  <td>{averages[i] ? `${averages[i]!.average}` : '–'}</td>
                  <td>{h.tee && h.target ? '✓' : h.tee || h.target ? '½' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editing && <p className="golf-hint">Lengths are as printed on the card; a ≈ length in the table is measured from the map instead. Changing the card doesn&apos;t change rounds already played.</p>}
      </section>

      {!editing && course.createdBy === me && (
        <button type="button" className="golf-btn is-danger" onClick={async () => {
          if (await popup.confirm({ title: 'Delete this course?', message: 'Rounds played here keep their scores and pars. Its map points are lost for everyone.', confirmLabel: 'Delete', danger: true })) {
            await fetch(`/api/golf/courses/${course.id}`, { method: 'DELETE' }).catch(() => null);
            await golf.sync();
            go('', true);
          }
        }}>Delete this course</button>
      )}
    </div>
  );
}
