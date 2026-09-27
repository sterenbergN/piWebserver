'use client';

import { useEffect, useRef, useState } from 'react';

interface Details { title: string; description: string; poster: string | null; year: string | null; url: string | null }
type Film = { id: string; title: string; year: number | null; rating: number };
type Pick = Film & { rank: number };

const POOLS = [25, 50, 100]; // plus "All"
const STORAGE_KEY = 'moviePickerWatched';

/** Spin for a film you haven't seen from IMDb's top 250; watched films are remembered on this device. */
export default function MoviePickerTool() {
  const [movies, setMovies] = useState<Film[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [watched, setWatched] = useState<string[]>([]);
  const [pool, setPool] = useState(100);
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsState, setDetailsState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [filter, setFilter] = useState('');
  const [addInput, setAddInput] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/tools/movies').then(r => r.json()).then(d => { if (d.success) setMovies(d.movies); else setLoadError(true); }).catch(() => setLoadError(true));
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) setWatched(JSON.parse(saved)); } catch { }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const saveWatched = (list: string[]) => {
    setWatched(list);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { }
  };
  const isWatched = (t: string) => watched.some(w => w.toLowerCase() === t.toLowerCase());

  const loadDetails = async (film: Film) => {
    setDetails(null);
    setDetailsState('loading');
    try {
      // The IMDb id lets the server find the exact Wikipedia page.
      const q = new URLSearchParams({ title: film.title, id: film.id, ...(film.year ? { year: String(film.year) } : {}) });
      const d = await fetch(`/api/tools/movies/details?${q}`).then(r => r.json());
      if (d.success) { setDetails(d); setDetailsState('idle'); } else setDetailsState('missing');
    } catch {
      setDetailsState('missing');
    }
  };

  const list = movies?.slice(0, pool) || [];
  const unwatched = list.map((film, i) => ({ ...film, rank: i + 1 })).filter(m => !isWatched(m.title));

  const spin = () => {
    if (spinning || unwatched.length === 0) return;
    const final = unwatched[Math.floor(Math.random() * unwatched.length)];
    setSpinning(true);
    setPick(null);
    setDetails(null);
    let tick = 0;
    const run = () => {
      tick++;
      if (tick < 28) {
        setDisplay(Math.floor(Math.random() * list.length) + 1);
        timer.current = setTimeout(run, tick < 14 ? 45 : tick < 22 ? 90 : 170);
        return;
      }
      setDisplay(final.rank);
      setPick(final);
      setSpinning(false);
      loadDetails(final);
    };
    // Reduced motion: skip the drum roll.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { tick = 99; }
    run();
  };

  const markWatched = (title: string) => {
    if (!isWatched(title)) saveWatched([title, ...watched]);
    setPick(null);
    setDetails(null);
    setDisplay(null);
  };
  const addManual = () => {
    const t = addInput.trim();
    if (t && !isWatched(t)) saveWatched([t, ...watched]);
    setAddInput('');
  };

  if (loadError) return <section className="tl-card"><p className="tl-muted" style={{ margin: 0 }}>Couldn’t load the film list. Refresh to try again.</p></section>;
  if (!movies) return <section className="tl-card"><p className="tl-muted" style={{ margin: 0 }}>Loading films…</p></section>;

  const shownWatched = filter.trim() ? watched.filter(w => w.toLowerCase().includes(filter.trim().toLowerCase())) : watched;

  return (
    <>
      <section className="tl-card" style={{ textAlign: 'center' }}>
        <h2>🎬 What should we watch?</h2>
        <p className="tl-sub">Spins over IMDb’s top-rated films you haven’t marked as watched.</p>

        <span className="tl-label" style={{ textAlign: 'left' }}>Pick from the top</span>
        <div className="tl-seg" role="group" aria-label="How many films to pick from">
          {[...POOLS, movies.length].map(n => <button key={n} aria-pressed={pool === n} disabled={spinning} onClick={() => { setPool(n); setPick(null); setDisplay(null); }}>{n === movies.length ? `All ${n}` : `Top ${n}`}</button>)}
        </div>
        <p className="tl-muted" style={{ fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{unwatched.length} of {list.length} still to watch</p>

        <div className={`tl-wheel${spinning ? ' is-spinning' : ''}`} aria-live="off">{display !== null ? `#${display}` : '?'}</div>

        <button className="btn btn-primary tl-btn" style={{ minWidth: 200 }} onClick={spin} disabled={spinning || unwatched.length === 0}>
          {spinning ? 'Spinning…' : unwatched.length === 0 ? 'You’ve seen them all!' : pick ? '🎲 Spin again' : '🎲 Spin'}
        </button>
      </section>

      {pick && (
        <section className="tl-card animate-fade-in" aria-live="polite">
          <div className="tl-film">
            {details?.poster ? <img src={details.poster} alt="" /> : <div className="tl-poster-empty" aria-hidden>🎞️</div>}
            <div>
              <div className="tl-label" style={{ margin: 0 }}>#{pick.rank} on IMDb{pick.year ? ` · ${pick.year}` : ''} · ★ {pick.rating.toFixed(1)}</div>
              <h3>{details?.title || pick.title}</h3>
              {detailsState === 'loading' && <p>Looking it up…</p>}
              {detailsState === 'missing' && <p>Couldn’t find a summary for this one.</p>}
              {details && <p>{details.description.length > 360 ? `${details.description.slice(0, 360).replace(/\s+\S*$/, '')}…` : details.description}</p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button className="btn btn-primary" onClick={() => markWatched(pick.title)}>✓ Seen it</button>
                <a className="btn btn-secondary" href={`https://www.imdb.com/title/${pick.id}/`} target="_blank" rel="noreferrer">IMDb ↗</a>
                {details?.url && <a className="btn btn-secondary" href={details.url} target="_blank" rel="noreferrer">Wikipedia ↗</a>}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="tl-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2>Watched <span className="tl-muted" style={{ fontWeight: 400, fontSize: '1rem' }}>({watched.length})</span></h2>
          <span className="tl-muted" style={{ fontSize: '0.8rem' }}>Saved on this device</span>
        </div>
        <div className="tl-row" style={{ margin: '0.75rem 0' }}>
          <input value={addInput} onChange={e => setAddInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addManual(); }} placeholder="Add a film you’ve seen" aria-label="Add a watched film" style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={addManual} disabled={!addInput.trim()}>Add</button>
        </div>
        {watched.length > 12 && <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search watched films" aria-label="Search watched films" style={{ marginBottom: '0.75rem' }} />}
        {watched.length === 0 ? (
          <p className="tl-muted" style={{ margin: 0 }}>Nothing yet — spin, then tap “Seen it” to skip films you know.</p>
        ) : (
          <div className="tl-chips">
            {shownWatched.map(film => (
              <span key={film} className="tl-tag">
                {film}
                <button onClick={() => saveWatched(watched.filter(w => w !== film))} aria-label={`Remove ${film}`}>✕</button>
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
