'use client';

import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';

export default function RestaurantPickerTool() {
  const { showAlert } = useSitePopup();
  const [step, setStep] = useState(0); // 0 = Start, 1-5 = Questions, 6 = Loading, 7 = Results
  
  // Quiz State
  const [answers, setAnswers] = useState({
    price: '',
    cuisine: '',
    distance: 5000, // in meters
    vibe: '',
    openNow: true
  });

  const [results, setResults] = useState<any[]>([]);
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);

  const startQuiz = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
          setStep(1);
        },
        async (error) => {
          await showAlert({ title: "Location Error", message: "Please enable location services to find restaurants near you." });
        }
      );
    } else {
      showAlert({ title: "Unsupported", message: "Geolocation is not supported by your browser." });
    }
  };

  const handleAnswer = (key: keyof typeof answers, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    if (step < 5) {
      setStep(step + 1);
    } else {
      submitQuiz({ ...answers, [key]: value });
    }
  };

  const submitQuiz = async (finalAnswers: typeof answers) => {
    setStep(6); // Loading

    try {
      const res = await fetch('/api/tools/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...finalAnswers, radius: finalAnswers.distance, lat: location?.lat, lng: location?.lng })
      });
      const data = await res.json();
      if (data.success) {
        setResults(data.results);
      } else {
        await showAlert({ title: "Search Error", message: data.message });
      }
    } catch {
      await showAlert({ title: "Network Error", message: "Failed to connect to the restaurant finder." });
    }
    
    setStep(7); // Results
  };

  const reset = () => {
    setStep(0);
    setAnswers({ price: '', cuisine: '', distance: 5000, vibe: '', openNow: true });
    setResults([]);
  };

  return (
    <div className="glass-panel" style={{ padding: '2.5rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      {step === 0 && (
        <div className="animate-fade-in">
          <h2 style={{ marginBottom: '1rem', fontSize: '2rem' }}>🍽️ Where to Eat?</h2>
          <p style={{ color: 'var(--muted)', marginBottom: '2rem', lineHeight: 1.6 }}>
            Can't decide where to go? Give us access to your location and answer 5 quick questions, and we'll pick the top 5 spots for you!
          </p>
          <button className="btn btn-primary" onClick={startQuiz} style={{ fontSize: '1.2rem', padding: '0.75rem 2rem' }}>
            Find Food Nearby
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="animate-fade-in">
          <h3 style={{ marginBottom: '2rem' }}>1. How much do you want to spend?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => handleAnswer('price', '1')}>$ (Cheap)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('price', '2')}>$$ (Moderate)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('price', '3')}>$$$ (Pricey)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('price', '4')}>$$$$ (Luxury)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('price', '')} style={{ gridColumn: 'span 2' }}>Doesn't Matter</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in">
          <h3 style={{ marginBottom: '2rem' }}>2. What kind of cuisine?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {['Italian', 'Mexican', 'Asian', 'American', 'Seafood', 'Any'].map(c => (
              <button key={c} className="btn btn-secondary" onClick={() => handleAnswer('cuisine', c === 'Any' ? '' : c)}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fade-in">
          <h3 style={{ marginBottom: '2rem' }}>3. How far are you willing to go?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => handleAnswer('distance', 1000)}>Walking Distance (&lt; 1km)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('distance', 5000)}>Short Drive (&lt; 5km)</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('distance', 15000)}>Long Drive (&lt; 15km)</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="animate-fade-in">
          <h3 style={{ marginBottom: '2rem' }}>4. What's the vibe?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {['Casual', 'Fancy', 'Fast Food', 'Cafe', 'Bar', 'Any'].map(v => (
              <button key={v} className="btn btn-secondary" onClick={() => handleAnswer('vibe', v === 'Any' ? '' : v)}>{v}</button>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="animate-fade-in">
          <h3 style={{ marginBottom: '2rem' }}>5. Must be open right now?</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => handleAnswer('openNow', true)}>Yes, I'm hungry!</button>
            <button className="btn btn-secondary" onClick={() => handleAnswer('openNow', false)}>Doesn't matter</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="animate-fade-in" style={{ padding: '3rem 0' }}>
          <h2>Locating Restaurants... 📍</h2>
        </div>
      )}

      {step === 7 && (
        <div className="animate-fade-in">
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--accent-light)' }}>Top Recommendations</h2>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Results via OpenStreetMap</p>
          {results.length === 0 ? (
            <p>No restaurants found matching your criteria nearby. Try broadening your search.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left', marginBottom: '2rem' }}>
              {results.map((r, i) => (
                <div key={i} style={{ background: 'var(--input-bg)', padding: '1.25rem', borderRadius: '12px', borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{i + 1}. {r.name}</h3>
                    {r.cuisine && <span style={{ background: 'var(--surface-border)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{r.cuisine}</span>}
                  </div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.7, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    {r.address && <span>📍 {r.address}</span>}
                    {r.opening_hours && <span>🕐 {r.opening_hours.split(';')[0]}</span>}
                    {r.phone && <span>📞 {r.phone}</span>}
                    {r.website && <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>🌐 Website</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-secondary" onClick={reset}>Start Over</button>
        </div>
      )}
    </div>
  );
}
