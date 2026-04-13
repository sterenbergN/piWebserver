'use client';

import { useState, useEffect } from 'react';
import GymEditor from './GymEditor';
import WorkoutTypeEditor from './WorkoutTypeEditor';
import { useSitePopup } from '@/components/SitePopup';

type ConfigTab = 'gyms' | 'types' | 'profile';

// Intensity label helper
function getIntensityLabel(value: number): { label: string; emoji: string; color: string } {
    if (value <= 0.6) return { label: 'Recovery', emoji: '🧘', color: '#63b3ed' };
    if (value <= 0.8) return { label: 'Light', emoji: '🌿', color: '#68d391' };
    if (value <= 1.1) return { label: 'Standard', emoji: '⚖️', color: '#48bb78' };
    if (value <= 1.3) return { label: 'Push', emoji: '💪', color: '#ed8936' };
    return { label: 'Max Push', emoji: '🔥', color: '#fc8181' };
}

export default function ConfigPage() {
  const { showAlert, popup } = useSitePopup();
  const [activeTab, setActiveTab] = useState<ConfigTab>('gyms');
  const [user, setUser] = useState<any>(null);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState('male');
  const [factor, setFactor] = useState(1.0);

  useEffect(() => {
    fetch('/api/workout/auth')
      .then(res => res.json())
      .then(data => {
         if (data.authenticated) {
            setUser(data.user);
            setWeight(data.user.weight || '');
            setHeight(data.user.height || '');
            setGender(data.user.gender || 'male');
            setFactor(data.user.intensityFactor ?? 1.0);
         }
      });
  }, []);

  const handleSaveProfile = async () => {
     if (!user) {
        await showAlert({ title: 'Authentication Required', message: 'Must be logged in' });
        return;
     }
     const res = await fetch('/api/workout/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           weight: parseFloat(weight as string) || 0,
           height: parseFloat(height as string) || 0,
           gender,
           intensityFactor: factor
        })
     });
     if (res.ok) await showAlert({ title: 'Profile Updated', message: 'Profile updated!' });
     else await showAlert({ title: 'Save Failed', message: 'Failed to save profile' });
  };

  const intensityInfo = getIntensityLabel(factor);

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
      <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Configuration</h1>
        <button className="btn btn-secondary" onClick={() => window.location.href = '/workout'} style={{ padding: '0.5rem 1rem' }}>
          Back
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button 
          className={activeTab === 'gyms' ? 'workout-btn-primary' : 'btn btn-secondary'}
          style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.25rem', borderRadius: '20px', width: 'auto' }}
          onClick={() => setActiveTab('gyms')}
        >
          🏋️ Gyms & Lifts
        </button>
        <button 
          className={activeTab === 'types' ? 'workout-btn-primary' : 'btn btn-secondary'}
          style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.25rem', borderRadius: '20px', width: 'auto' }}
          onClick={() => setActiveTab('types')}
        >
          📋 Workout Types
        </button>
        <button 
          className={activeTab === 'profile' ? 'workout-btn-primary' : 'btn btn-secondary'}
          style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.25rem', borderRadius: '20px', width: 'auto' }}
          onClick={() => setActiveTab('profile')}
        >
          👤 Profile
        </button>
      </div>

      <div className="workout-tile" style={{ padding: 0, overflow: 'hidden' }}>
        {activeTab === 'gyms' && <GymEditor />}
        {activeTab === 'types' && <WorkoutTypeEditor />}
        {activeTab === 'profile' && (
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Update Profile</h3>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>Changing weight accurately tracks relative strength metrics over time.</p>
            <input className="workout-input" type="number" placeholder="Current Body Weight (lbs)" value={weight} onChange={e => setWeight(e.target.value)} />
            <input className="workout-input" type="number" placeholder="Height (inches)" value={height} onChange={e => setHeight(e.target.value)} />
            <select className="workout-input" value={gender} onChange={e => setGender(e.target.value)}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
            
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--surface-border)' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Intensity Factor</h4>
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
                   Controls how aggressively your workouts progress. This is the default value used by the progression engine; you can override it per-workout during an active session.
                </p>

                {/* Intensity Slider */}
                <div style={{ marginBottom: '0.75rem' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Current Value</span>
                      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: intensityInfo.color }}>
                         {intensityInfo.emoji} {intensityInfo.label} ({factor.toFixed(2)})
                      </span>
                   </div>
                   <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={factor}
                      onChange={(e) => setFactor(parseFloat(e.target.value))}
                      style={{
                         width: '100%',
                         height: '8px',
                         WebkitAppearance: 'none',
                         appearance: 'none' as any,
                         borderRadius: '4px',
                         outline: 'none',
                         cursor: 'pointer',
                         background: `linear-gradient(to right, #63b3ed 0%, #48bb78 40%, #ed8936 70%, #fc8181 100%)`,
                      }}
                   />
                   <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                      <span>🧘 Recovery (0.5)</span>
                      <span>⚖️ Standard (1.0)</span>
                      <span>🔥 Push (1.5)</span>
                   </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                   <strong style={{ color: 'var(--foreground)' }}>How it works:</strong><br/>
                   • <strong>0.5</strong> — Recovery mode. Limits weight jumps, favors volume (reps/sets).<br/>
                   • <strong>1.0</strong> — Balanced progression. Moderate overload targeting.<br/>
                   • <strong>1.5</strong> — Max push. Favors aggressive weight jumps, accepts rep drops.<br/><br/>
                   The engine generates candidate workouts, scores them against your performance history, and selects the optimal one. This factor biases what "optimal" means.
                </div>
            </div>

            <button className="workout-btn-primary" onClick={handleSaveProfile}>Save Profile Setup</button>
          </div>
        )}
      </div>
      {popup}
    </div>
  );
}
