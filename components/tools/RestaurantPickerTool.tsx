'use client';

import { useRef, useState } from 'react';
import { CUISINE_LABELS } from '@/lib/tools/restaurants';
import SpinWheel, { randomIndex, type WheelItem } from './SpinWheel';

type Place = {
  id: string; name: string; kind: string; cuisine: string | null; lat: number; lon: number; distance: number;
  address: string | null; phone: string | null; website: string | null; hours: string | null; open: boolean | null;
};

const KINDS = [
  { id: 'any', label: 'Any' },
  { id: 'restaurant', label: 'Dining' },
  { id: 'fast_food', label: 'Quick' },
  { id: 'cafe', label: 'Café' },
  { id: 'bar', label: 'Bar' },
];
const MILE = 1609.344;
const DISTANCES = [1, 3, 5, 10].map((mi) => ({ m: Math.round(mi * MILE), label: `${mi} mi` }));
const KIND_LABEL: Record<string, string> = { restaurant: 'Restaurant', fast_food: 'Quick bite', cafe: 'Café', bar: 'Bar', pub: 'Pub' };
const PAGE = 25;
const WHEEL_MAX = 12;

const distanceLabel = (m: number) => {
  const miles = m / MILE;
  return miles < 0.1 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
};

function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser can’t share its location — type a place instead.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      err => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location is blocked for this site — allow it, or type a place instead.' : 'Couldn’t get your location — type a place instead.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

/** Nearby places to eat from OpenStreetMap, filtered by type, cuisine, distance and opening hours. */
export default function RestaurantPickerTool() {
  const [kind, setKind] = useState('any');
  const [cuisine, setCuisine] = useState('');
  const [radius, setRadius] = useState(DISTANCES[1].m);
  const [openNow, setOpenNow] = useState(true);
  const [place, setPlace] = useState('');
  const [status, setStatus] = useState<'idle' | 'locating' | 'searching' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [where, setWhere] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [wheel, setWheel] = useState<string[]>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLElement>(null);

  const search = async (useTyped: boolean) => {
    setError('');
    setPicked(null);
    let coords: { lat: number; lng: number } | null = null;
    if (!useTyped) {
      setStatus('locating');
      try { coords = await currentPosition(); } catch (err) { setStatus('error'); setError(err instanceof Error ? err.message : 'Location failed'); return; }
    }
    setStatus('searching');
    const now = new Date();
    try {
      const res = await fetch('/api/tools/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(coords || { place }), kind, cuisine, radius, openNow, day: now.getDay(), minute: now.getHours() * 60 + now.getMinutes() }),
      });
      const d = await res.json();
      if (!d.success) { setStatus('error'); setError(d.message || 'Search failed.'); return; }
      const found: Place[] = d.results;
      setResults(found);
      setPartial(d.partial === true);
      setShown(PAGE);
      setWhere(d.place || 'you');
      // Keep wheel picks that are still in the new list.
      setWheel(w => w.filter(id => found.some(p => p.id === id)));
      setWinner(null);
      setStatus('done');
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch {
      setStatus('error');
      setError('Couldn’t reach the search. Check your connection and try again.');
    }
  };

  const reveal = (id: string) => {
    const index = results.findIndex(r => r.id === id);
    if (index >= shown) setShown(Math.ceil((index + 1) / PAGE) * PAGE);
    setTimeout(() => document.getElementById(`place-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  /** Any place in the whole list, never the same one twice running. */
  const pickForMe = () => {
    const pool = results.filter(r => r.id !== picked);
    const choice = pool[randomIndex(pool.length)];
    setPicked(choice.id);
    reveal(choice.id);
  };

  const toggleWheel = (id: string) => {
    setWinner(null);
    setWheel(w => (w.includes(id) ? w.filter(x => x !== id) : w.length >= WHEEL_MAX ? w : [...w, id]));
  };
  const fillWheel = () => {
    setWinner(null);
    const rest = results.filter(r => !wheel.includes(r.id));
    const add: string[] = [];
    while (add.length < Math.min(6, WHEEL_MAX - wheel.length) && rest.length) add.push(rest.splice(randomIndex(rest.length), 1)[0].id);
    setWheel([...wheel, ...add]);
    setTimeout(() => wheelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const busy = status === 'locating' || status === 'searching';
  const wheelItems: WheelItem[] = wheel.map(id => results.find(r => r.id === id)).filter((p): p is Place => !!p).map(p => ({ id: p.id, label: p.name }));
  const winnerPlace = results.find(r => r.id === winner);

  const directions = (r: Place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.lat},${r.lon}`)}`;

  return (
    <>
      <section className="tl-card">
        <h2>🍽️ Where to eat?</h2>
        <p className="tl-sub">Places near you from OpenStreetMap. Pick what you’re in the mood for.</p>

        <span className="tl-label">Type</span>
        <div className="tl-seg" role="group" aria-label="Type of place">
          {KINDS.map(k => <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </div>

        <span className="tl-label">Cuisine</span>
        <div className="tl-chips is-scroll" role="group" aria-label="Cuisine">
          {Object.entries(CUISINE_LABELS).map(([id, label]) => <button key={id || 'any'} className="tl-chip" aria-pressed={cuisine === id} onClick={() => setCuisine(id)}>{label}</button>)}
        </div>

        <span className="tl-label">How far</span>
        <div className="tl-seg" role="group" aria-label="Distance">
          {DISTANCES.map(d => <button key={d.m} aria-pressed={radius === d.m} onClick={() => setRadius(d.m)}>{d.label}</button>)}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '1rem', minHeight: 44, cursor: 'pointer' }}>
          <input type="checkbox" checked={openNow} onChange={e => setOpenNow(e.target.checked)} />
          <span>Open right now <span className="tl-muted" style={{ fontSize: '0.85rem' }}>(places with unknown hours still show)</span></span>
        </label>

        <button className="btn btn-primary tl-btn tl-btn-block" style={{ marginTop: '0.75rem' }} disabled={busy} onClick={() => search(false)}>
          {status === 'locating' ? 'Finding you…' : status === 'searching' ? 'Searching…' : '📍 Search near me'}
        </button>
        <div className="tl-row" style={{ marginTop: '0.6rem' }}>
          <input value={place} onChange={e => setPlace(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && place.trim()) search(true); }} placeholder="…or type a city, area or ZIP" aria-label="Place to search near" style={{ flex: 1 }} />
          <button className="btn btn-secondary" disabled={busy || !place.trim()} onClick={() => search(true)}>Search</button>
        </div>
        {status === 'searching' && <p className="tl-muted" role="status" style={{ margin: '0.6rem 0 0', fontSize: '0.85rem' }}>The map servers can be slow at busy times; this can take up to half a minute.</p>}
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: '0.75rem 0 0', fontSize: '0.9rem' }}>{error}</p>}
      </section>

      {status === 'done' && results.length > 1 && (
        <section className="tl-card" ref={wheelRef} style={{ scrollMarginTop: 80 }}>
          <div className="tl-spin-head">
            <div>
              <h2>🎡 Wheel</h2>
              <p className="tl-sub" style={{ margin: 0 }}>Tap <strong>+ Wheel</strong> on places below (up to {WHEEL_MAX}), then spin. Spin again as often as you like.</p>
            </div>
            <div className="tl-chips">
              <button className="tl-chip" onClick={fillWheel} disabled={wheel.length >= WHEEL_MAX}>+ 6 random</button>
              {wheel.length > 0 && <button className="tl-chip" onClick={() => { setWheel([]); setWinner(null); }}>Clear</button>}
            </div>
          </div>
          {wheelItems.length > 0 && (
            <>
              <SpinWheel items={wheelItems} onResult={item => setWinner(item.id)} />
              {winnerPlace && (
                <div className="tl-spin-winner" role="status">
                  <span className="tl-muted">The wheel says</span>
                  <strong>🎉 {winnerPlace.name}</strong>
                  <span className="tl-place-meta">{[KIND_LABEL[winnerPlace.kind] || winnerPlace.kind, winnerPlace.cuisine, distanceLabel(winnerPlace.distance)].filter(Boolean).join(' · ')}</span>
                  <div className="tl-place-links" style={{ justifyContent: 'center' }}>
                    <a className="btn btn-secondary" href={directions(winnerPlace)} target="_blank" rel="noreferrer">Directions</a>
                    <button className="btn btn-secondary" onClick={() => { setPicked(winnerPlace.id); reveal(winnerPlace.id); }}>Show in list</button>
                  </div>
                </div>
              )}
              <div className="tl-chips" style={{ marginTop: '0.8rem' }}>
                {wheelItems.map(w => (
                  <span key={w.id} className="tl-tag">{w.label}<button onClick={() => toggleWheel(w.id)} aria-label={`Take ${w.label} off the wheel`}>✕</button></span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {status === 'done' && (
        <section className="tl-card" ref={listRef} style={{ scrollMarginTop: 80 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <div>
              <h2>{results.length ? `${results.length} place${results.length === 1 ? '' : 's'}` : 'Nothing found'}</h2>
              <div className="tl-muted" style={{ fontSize: '0.85rem' }}>within {DISTANCES.find(d => d.m === radius)?.label} of {where} · closest first</div>
            </div>
            {results.length > 1 && <button className="btn btn-primary" onClick={pickForMe}>🎲 {picked ? 'Pick another' : 'Pick for me'}</button>}
          </div>
          {results.length === 0 ? (
            <p className="tl-muted" style={{ margin: 0 }}>Try a wider distance, “Anything” for cuisine, or turn off “Open right now”.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {results.slice(0, shown).map(r => (
                <article key={r.id} id={`place-${r.id}`} className={`tl-place${picked === r.id ? ' is-picked' : ''}`}>
                  <div className="tl-place-head">
                    <div style={{ minWidth: 0 }}>
                      <h3>{picked === r.id && '🎉 '}{r.name}</h3>
                      <div className="tl-place-meta">{[KIND_LABEL[r.kind] || r.kind, r.cuisine].filter(Boolean).join(' · ')}</div>
                      <div className="tl-place-meta"><strong>{distanceLabel(r.distance)}</strong>{r.address ? ` · ${r.address}` : ''}</div>
                    </div>
                    <span className={`tl-open ${r.open === true ? 'is-open' : r.open === false ? 'is-closed' : 'is-unknown'}`}>
                      {r.open === true ? 'Open' : r.open === false ? 'Closed' : 'Hours ?'}
                    </span>
                  </div>
                  {r.hours && <div className="tl-place-meta" style={{ marginTop: '0.35rem' }}>🕐 {r.hours}</div>}
                  <div className="tl-place-links">
                    <button className={`btn ${wheel.includes(r.id) ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={wheel.includes(r.id)}
                      disabled={!wheel.includes(r.id) && wheel.length >= WHEEL_MAX} onClick={() => toggleWheel(r.id)}>
                      {wheel.includes(r.id) ? '✓ On wheel' : '+ Wheel'}
                    </button>
                    <a className="btn btn-secondary" href={directions(r)} target="_blank" rel="noreferrer">Directions</a>
                    {r.website && <a className="btn btn-secondary" href={r.website.startsWith('http') ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer">Website</a>}
                    {r.phone && <a className="btn btn-secondary" href={`tel:${r.phone.replace(/[^+\d]/g, '')}`}>Call</a>}
                  </div>
                </article>
              ))}
              {shown < results.length && (
                <button className="btn btn-secondary tl-btn-block" onClick={() => setShown(s => s + PAGE)}>Show {Math.min(PAGE, results.length - shown)} more (farther away)</button>
              )}
            </div>
          )}
          {partial && results.length > 0 && <p className="tl-muted" style={{ fontSize: '0.8rem', margin: '0.9rem 0 0' }}>The full map search was busy, so this is a quicker, shorter list. Search again in a minute for everything nearby.</p>}
          <p className="tl-muted" style={{ fontSize: '0.75rem', margin: '0.9rem 0 0' }}>Data © OpenStreetMap contributors. Hours can be out of date.</p>
        </section>
      )}
    </>
  );
}
