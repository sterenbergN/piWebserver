'use client';

import { useRef, useState } from 'react';
import { CUISINE_LABELS } from '@/lib/tools/restaurants';

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
const DISTANCES = [
  { m: 1000, label: '1 km' },
  { m: 3000, label: '3 km' },
  { m: 8000, label: '8 km' },
  { m: 15000, label: '15 km' },
];
const KIND_LABEL: Record<string, string> = { restaurant: 'Restaurant', fast_food: 'Quick bite', cafe: 'Café', bar: 'Bar', pub: 'Pub' };

const distanceLabel = (m: number) => {
  const miles = m / 1609.344;
  return `${m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`} · ${miles < 0.1 ? '<0.1' : miles.toFixed(1)} mi`;
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
  const [radius, setRadius] = useState(3000);
  const [openNow, setOpenNow] = useState(true);
  const [place, setPlace] = useState('');
  const [status, setStatus] = useState<'idle' | 'locating' | 'searching' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [where, setWhere] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
      setResults(d.results);
      setWhere(d.place || 'you');
      setStatus('done');
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch {
      setStatus('error');
      setError('Couldn’t reach the search. Check your connection and try again.');
    }
  };

  const pickForMe = () => {
    // Prefer places known to be open; otherwise anything in the list.
    const pool = results.filter(r => r.open === true);
    const from = pool.length ? pool : results;
    const choice = from[Math.floor(Math.random() * from.length)];
    setPicked(choice.id);
    setTimeout(() => document.getElementById(`place-${choice.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
  };

  const busy = status === 'locating' || status === 'searching';

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
          <span>Open right now <span className="tl-muted" style={{ fontSize: '0.85rem' }}>(places with unknown hours still show, last)</span></span>
        </label>

        <button className="btn btn-primary tl-btn tl-btn-block" style={{ marginTop: '0.75rem' }} disabled={busy} onClick={() => search(false)}>
          {status === 'locating' ? 'Finding you…' : status === 'searching' ? 'Searching…' : '📍 Search near me'}
        </button>
        <div className="tl-row" style={{ marginTop: '0.6rem' }}>
          <input value={place} onChange={e => setPlace(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && place.trim()) search(true); }} placeholder="…or type a city, area or ZIP" aria-label="Place to search near" style={{ flex: 1 }} />
          <button className="btn btn-secondary" disabled={busy || !place.trim()} onClick={() => search(true)}>Search</button>
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: '0.75rem 0 0', fontSize: '0.9rem' }}>{error}</p>}
      </section>

      {status === 'done' && (
        <section className="tl-card" ref={listRef} style={{ scrollMarginTop: 80 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <div>
              <h2>{results.length ? `${results.length} place${results.length === 1 ? '' : 's'}` : 'Nothing found'}</h2>
              <div className="tl-muted" style={{ fontSize: '0.85rem' }}>within {DISTANCES.find(d => d.m === radius)?.label} of {where} · closest first</div>
            </div>
            {results.length > 1 && <button className="btn btn-primary" onClick={pickForMe}>🎲 Pick for me</button>}
          </div>
          {results.length === 0 ? (
            <p className="tl-muted" style={{ margin: 0 }}>Try a wider distance, “Anything” for cuisine, or turn off “Open right now”.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              {results.map(r => (
                <article key={r.id} id={`place-${r.id}`} className={`tl-place${picked === r.id ? ' is-picked' : ''}`}>
                  <div className="tl-place-head">
                    <div style={{ minWidth: 0 }}>
                      <h3>{picked === r.id && '🎉 '}{r.name}</h3>
                      <div className="tl-place-meta">{[KIND_LABEL[r.kind] || r.kind, r.cuisine].filter(Boolean).join(' · ')}</div>
                      <div className="tl-place-meta">{distanceLabel(r.distance)}{r.address ? ` · ${r.address}` : ''}</div>
                    </div>
                    <span className={`tl-open ${r.open === true ? 'is-open' : r.open === false ? 'is-closed' : 'is-unknown'}`}>
                      {r.open === true ? 'Open' : r.open === false ? 'Closed' : 'Hours ?'}
                    </span>
                  </div>
                  {r.hours && <div className="tl-place-meta" style={{ marginTop: '0.35rem' }}>🕐 {r.hours}</div>}
                  <div className="tl-place-links">
                    <a className="btn btn-secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.lat},${r.lon}`)}`} target="_blank" rel="noreferrer">Directions</a>
                    {r.website && <a className="btn btn-secondary" href={r.website.startsWith('http') ? r.website : `https://${r.website}`} target="_blank" rel="noreferrer">Website</a>}
                    {r.phone && <a className="btn btn-secondary" href={`tel:${r.phone.replace(/[^+\d]/g, '')}`}>Call</a>}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="tl-muted" style={{ fontSize: '0.75rem', margin: '0.9rem 0 0' }}>Data © OpenStreetMap contributors. Hours can be out of date.</p>
        </section>
      )}
    </>
  );
}
