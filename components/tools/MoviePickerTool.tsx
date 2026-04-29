'use client';

import { useState, useEffect } from 'react';

interface MovieDetails {
  title: string;
  description: string;
  poster: string | null;
}

export default function MoviePickerTool() {
  const [movies, setMovies] = useState<string[]>([]);
  const [watched, setWatched] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolSize, setPoolSize] = useState<number>(500);

  const [isSpinning, setIsSpinning] = useState(false);
  const [displayNumber, setDisplayNumber] = useState<number | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [addInput, setAddInput] = useState('');

  useEffect(() => {
    // Load movie list
    fetch('/api/tools/movies')
      .then(r => r.json())
      .then(d => { if (d.success) setMovies(d.movies); })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Load watched from localStorage only
    try {
      const saved = localStorage.getItem('moviePickerWatched');
      if (saved) setWatched(JSON.parse(saved));
    } catch {}
  }, []);

  const saveWatched = (list: string[]) => {
    setWatched(list);
    try { localStorage.setItem('moviePickerWatched', JSON.stringify(list)); } catch {}
  };

  const markWatched = (movie: string) => {
    if (!watched.includes(movie)) saveWatched([...watched, movie]);
    setSelectedMovie(null);
    setMovieDetails(null);
    setDisplayNumber(null);
    setSelectedIndex(null);
  };

  const fetchDetails = async (title: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/tools/movies/details?title=${encodeURIComponent(title)}`);
      const d = await res.json();
      if (d.success) {
        setMovieDetails({ title: d.title, description: d.description, poster: d.poster });
      } else {
        setMovieDetails({ title, description: 'No description available.', poster: null });
      }
    } catch {
      setMovieDetails({ title, description: 'Could not load details.', poster: null });
    }
    setDetailsLoading(false);
  };

  const spin = () => {
    if (movies.length === 0 || isSpinning) return;
    const pool = movies.slice(0, poolSize);
    setIsSpinning(true);
    setSelectedMovie(null);
    setMovieDetails(null);
    setSelectedIndex(null);

    let tick = 0;
    const totalTicks = 45;
    const getDelay = (t: number) => t < 20 ? 40 : t < 35 ? 80 : 150;

    const runTick = () => {
      const n = Math.floor(Math.random() * pool.length) + 1;
      setDisplayNumber(n);
      tick++;
      if (tick < totalTicks) {
        setTimeout(runTick, getDelay(tick));
      } else {
        const unwatched = pool.map((m, i) => i).filter(i => !watched.includes(pool[i]));
        const finalIdx = unwatched.length > 0
          ? unwatched[Math.floor(Math.random() * unwatched.length)]
          : Math.floor(Math.random() * pool.length);
        setDisplayNumber(finalIdx + 1);
        setSelectedIndex(finalIdx);
        setSelectedMovie(pool[finalIdx]);
        setIsSpinning(false);
        fetchDetails(pool[finalIdx]);
      }
    };
    runTick();
  };

  if (loading) return <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading film list...</div>;

  const unwatchedCount = movies.slice(0, poolSize).filter(m => !watched.includes(m)).length;
  const POOL_OPTIONS = [10, 25, 50, 100, 250, 500];

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>

      {/* Wheel Panel */}
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>🎬 Movie Wheel</h2>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Spinning across top-rated Letterboxd films &nbsp;|&nbsp; {unwatchedCount} unwatched in pool
        </p>

        {/* Pool size selector */}
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.5rem' }}>
          {POOL_OPTIONS.map(n => (
            <button
              key={n}
              className={`btn ${poolSize === n ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setPoolSize(n); setSelectedMovie(null); setMovieDetails(null); setDisplayNumber(null); }}
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem', minWidth: '52px' }}
            >
              Top {n}
            </button>
          ))}
        </div>

        {/* Number display */}
        <div style={{
          width: '160px', height: '160px', borderRadius: '50%', margin: '0 auto 1.5rem',
          border: `4px solid ${isSpinning ? 'var(--accent)' : 'var(--surface-border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2.5rem', fontWeight: 'bold', fontFamily: 'monospace',
          background: 'var(--surface-bg)',
          boxShadow: isSpinning ? '0 0 30px var(--accent), 0 0 60px rgba(var(--accent-rgb),0.3)' : 'none',
          transition: 'box-shadow 0.3s ease',
        }}>
          {displayNumber !== null ? `#${displayNumber}` : '?'}
        </div>

        <button
          className="btn btn-primary"
          onClick={spin}
          disabled={isSpinning}
          style={{ fontSize: '1.1rem', padding: '0.7rem 2.5rem', letterSpacing: '0.05em' }}
        >
          {isSpinning ? 'SPINNING...' : '🎲 SPIN'}
        </button>
      </div>

      {/* Selected Movie Details */}
      {(selectedMovie || detailsLoading) && (
        <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          {detailsLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
              Fetching details...
            </div>
          ) : movieDetails ? (
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              {/* Poster */}
              {movieDetails.poster ? (
                <img
                  src={movieDetails.poster}
                  alt={movieDetails.title}
                  style={{ width: '140px', height: 'auto', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
                />
              ) : (
                <div style={{ width: '140px', height: '200px', background: 'var(--input-bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.8rem', flexShrink: 0 }}>
                  No Poster
                </div>
              )}

              {/* Info */}
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>
                  #{selectedIndex !== null ? selectedIndex + 1 : '?'} on Letterboxd
                </div>
                <h2 style={{ margin: '0 0 0.75rem', lineHeight: 1.2 }}>{movieDetails.title}</h2>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.7, opacity: 0.8, marginBottom: '1.25rem' }}>
                  {movieDetails.description.length > 300
                    ? movieDetails.description.slice(0, 300) + '...'
                    : movieDetails.description}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => markWatched(selectedMovie!)}
                  style={{ fontSize: '0.9rem' }}
                >
                  ✅ Mark as Watched
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Watched List */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Watched ({watched.length})</h3>

          {/* Manual add */}
          <div style={{ display: 'flex', gap: '0.5rem', flex: 1, maxWidth: '360px' }}>
            <input
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && addInput.trim()) { saveWatched([...watched, addInput.trim()]); setAddInput(''); } }}
              placeholder="Add film manually..."
              style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem 0.75rem' }}
            />
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem' }}
              onClick={() => { if (addInput.trim()) { saveWatched([...watched, addInput.trim()]); setAddInput(''); } }}
            >
              Add
            </button>
          </div>
        </div>

        {watched.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
            No films marked as watched yet. Spin the wheel and mark films as you go!
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {watched.map((film, i) => (
              <span key={i} style={{
                background: 'var(--input-bg)', border: '1px solid var(--surface-border)',
                padding: '0.3rem 0.75rem', borderRadius: '20px', fontSize: '0.82rem',
                display: 'flex', alignItems: 'center', gap: '0.4rem',
              }}>
                {film}
                <button
                  onClick={() => saveWatched(watched.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}
                  title="Remove"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
