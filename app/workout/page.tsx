'use client';

import { useState, useEffect } from 'react';
import { DEMO_GYMS, DEMO_TYPES } from '@/lib/workout/demo-data';

// Interfaces for user representation
interface UserData {
  id: string;
  username: string;
  birthdate?: string;
  height?: string;
  gender?: string;
  weight?: number;
  intensityFactor?: number;
}

import { calculateExperienceScore } from '@/lib/workout/analytics';

function getIntensityLabel(value: number): { label: string; emoji: string; color: string } {
  if (value <= 0.6) return { label: 'Recovery', emoji: '🧘', color: '#63b3ed' };
  if (value <= 0.8) return { label: 'Light', emoji: '🌿', color: '#68d391' };
  if (value <= 1.1) return { label: 'Standard', emoji: '⚖️', color: '#48bb78' };
  if (value <= 1.3) return { label: 'Push', emoji: '💪', color: '#ed8936' };
  return { label: 'Max Push', emoji: '🔥', color: '#fc8181' };
}

export default function WorkoutDashboard() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // Dashboard Aggregates
  const [rankSymbol, setRankSymbol] = useState('⚪');
  const [rankName, setRankName] = useState('Beginner');
  const [rankScore, setRankScore] = useState(0);
  const [totalLifts, setTotalLifts] = useState(0);
  const [avgVol, setAvgVol] = useState(0);

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Analytics Expansion
  const [expandAnalytics, setExpandAnalytics] = useState(false);

  // Start Lift Expansion State
  const [showStartMenu, setShowStartMenu] = useState(false);
  const [availableGyms, setAvailableGyms] = useState<any[]>([]);
  const [availableTypes, setAvailableTypes] = useState<any[]>([]);
  const [selectedGym, setSelectedGym] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [liftCount, setLiftCount] = useState('5');

  // Profile Menu State
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editWeight, setEditWeight] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editGender, setEditGender] = useState('male');
  const [editIntensityFactor, setEditIntensityFactor] = useState(1.0);
  const [profileSaving, setProfileSaving] = useState(false);

  // Pending workout resume state
  const [pendingWorkout, setPendingWorkout] = useState<{plan?: any, logs?: any, timestamp?: number, startTime?: number, activeLiftIndex?: number, ownerId?: string} | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('showLogin') === '1') {
      setShowLogin(true);
    }
  }, []);

  useEffect(() => {
    // Check if real user is authenticated
    fetch('/api/workout/auth')
      .then(res => res.json())
      .then(data => {
        const loadPendingForOwner = (ownerId: string) => {
          try {
            const stored = localStorage.getItem('pendingWorkout');
            if (!stored) {
              setPendingWorkout(null);
              return;
            }
            const parsed = JSON.parse(stored);
            const age = Date.now() - (parsed.timestamp || 0);
            if (age >= 3600000) {
              localStorage.removeItem('pendingWorkout');
              setPendingWorkout(null);
              return;
            }
            if ((parsed.ownerId || 'demo-user-123') === ownerId) {
              setPendingWorkout(parsed);
              return;
            }
            setPendingWorkout(null);
          } catch {
            localStorage.removeItem('pendingWorkout');
            setPendingWorkout(null);
          }
        };

        if (data.authenticated && data.user) {
          setUser(data.user);
          setIsDemo(false);
          loadPendingForOwner(data.user.id);
          
          // Populate profile editor fields
          setEditWeight(data.user.weight?.toString() || '');
          setEditHeight(data.user.height || '');
          setEditGender(data.user.gender || 'male');
          setEditIntensityFactor(data.user.intensityFactor ?? 1.0);

          // Fetch only imported/owned gyms
          fetch('/api/workout/gyms').then(r => r.json()).then(d => { 
             if (d.success) setAvailableGyms(d.gyms.filter((g: any) => g.ownerId === data.user.id)); 
          });

          fetch('/api/workout/history').then(r => r.json()).then(pHistory => {
             if (pHistory.success) {
                 let sets = 0; let vol = 0;
                 
                 // Preconfigure list of all lifts across the user's gyms for SBD matching
                 const allLifts: any[] = [];
                 
                 // Re-fetch gyms locally inside history to ensure we have the lifts
                 fetch('/api/workout/gyms').then(r => r.json()).then(dGym => {
                     if (dGym.success) {
                         const userGyms = dGym.gyms.filter((g: any) => g.ownerId === data.user.id);
                         userGyms.forEach((g: any) => g.stations?.forEach((s: any) => {
                             if (s.lifts) allLifts.push(...s.lifts);
                         }));
                     }

                     pHistory.history.forEach((h: any) => {
                         if (h.logs) {
                             Object.keys(h.logs).forEach(liftId => {
                                 h.logs[liftId].forEach((set: any) => {
                                     vol += (set.reps * set.weight);
                                     sets++;
                                 });
                             });
                         }
                     });
                     
                     setTotalLifts(pHistory.history.length);
                     setAvgVol(sets > 0 ? vol / sets : 0);
                     
                     if (data.user.weight) {
                         const exp = calculateExperienceScore(data.user, pHistory.history, allLifts);
                         setRankSymbol(exp.symbol);
                         setRankName(exp.level);
                         setRankScore(exp.score);
                     }
                 });
             }
          });

        } else {
          // If not logged in, activate demo mode
          setIsDemo(true);
          setUser({
            id: 'demo-user-123',
            username: 'Guest Lifter',
            weight: 175,
            gender: 'male',
            intensityFactor: 1.0,
          });
          setAvailableGyms(DEMO_GYMS);
          setAvailableTypes(DEMO_TYPES);
          loadPendingForOwner('demo-user-123');
        }
      })
      .catch(() => {
        setIsDemo(true);
        setUser({
          id: 'demo-user-123',
          username: 'Guest Lifter',
          weight: 175,
          gender: 'male',
          intensityFactor: 1.0,
        });
        setAvailableGyms(DEMO_GYMS);
        setAvailableTypes(DEMO_TYPES);
        try {
          const stored = localStorage.getItem('pendingWorkout');
          if (!stored) {
            setPendingWorkout(null);
            return;
          }
          const parsed = JSON.parse(stored);
          const age = Date.now() - (parsed.timestamp || 0);
          if (age >= 3600000) {
            localStorage.removeItem('pendingWorkout');
            setPendingWorkout(null);
            return;
          }
          setPendingWorkout((parsed.ownerId || 'demo-user-123') === 'demo-user-123' ? parsed : null);
        } catch {
          localStorage.removeItem('pendingWorkout');
          setPendingWorkout(null);
        }
      })
      .finally(() => setLoading(false));

    fetch('/api/workout/types?scope=mine')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.types?.length > 0) {
          setAvailableTypes(d.types);
        }
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/workout/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      
      if (data.success) {
        window.location.reload(); // Reloads to hydrate authenticated state proper
      } else {
        setLoginError(data.message || 'Login failed');
      }
    } catch {
      setLoginError('Network Error');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/workout/auth', { method: 'DELETE' });
    window.location.reload();
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileSaving(true);
    try {
      const res = await fetch('/api/workout/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: parseFloat(editWeight) || 0,
          height: editHeight,
          gender: editGender,
          intensityFactor: editIntensityFactor
        })
      });
      const data = await res.json();
      if (data.success && data.user) {
        setUser(data.user);
        setEditIntensityFactor(data.user.intensityFactor ?? 1.0);
        setShowProfileEditor(false);
      }
    } catch { /* silent */ }
    setProfileSaving(false);
  };

  if (loading) {
    return <div style={{ textAlign: 'center', marginTop: '4rem' }}>Loading Workout Dashboard...</div>;
  }

  if (showLogin) {
    return (
      <div className="workout-tile animate-fade-in" style={{ marginTop: '20vh' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Login to Workout</h2>
        <form onSubmit={handleLogin}>
          <input 
            type="text" 
            className="workout-input" 
            placeholder="Username" 
            value={loginUsername} 
            onChange={e => setLoginUsername(e.target.value)} 
          />
          <input 
            type="password" 
            className="workout-input" 
            placeholder="Password" 
            value={loginPassword} 
            onChange={e => setLoginPassword(e.target.value)} 
          />
          {loginError && <p style={{ color: '#ff6b6b', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>{loginError}</p>}
          <button type="submit" className="workout-btn-primary">Enter</button>
        </form>
        <button 
          className="btn btn-secondary" 
          style={{ width: '100%', marginTop: '1rem', borderRadius: '12px' }}
          onClick={() => setShowLogin(false)}
        >
          Back to Demo
        </button>
      </div>
    );
  }

  // Formatting date for header
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="animate-fade-in">
      {isDemo && <div className="demo-banner">SAMPLE MODE - PROGRESS WILL NOT BE SAVED</div>}

      <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0, lineHeight: 1.2 }}>Hi, {user?.username}</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>{dateStr} &bull; {timeStr}</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-secondary" style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => {
            if (isDemo) setShowLogin(true);
            else { setShowProfileMenu(!showProfileMenu); setShowProfileEditor(false); }
          }}>
            👤
          </button>
          
          {showProfileMenu && !isDemo && (
             <div className="animate-fade-in" style={{ 
                position: 'absolute', top: '50px', right: 0, 
                background: 'rgba(28,28,30,0.98)', 
                border: '1px solid var(--surface-border)', 
                borderRadius: showProfileEditor ? '12px 12px 0 0' : '12px', 
                padding: '0.5rem', width: '220px', zIndex: 50, 
                display: 'flex', flexDirection: 'column', gap: '0.5rem', 
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)' 
             }}>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left', background: 'var(--background)', border: 'none', padding: '0.5rem' }} onClick={() => setShowProfileEditor(!showProfileEditor)}>✏️ Edit Profile</button>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left', background: 'var(--background)', border: 'none', padding: '0.5rem', color: '#ff6b6b' }} onClick={handleLogout}>🚪 Logout</button>
             </div>
          )}

          {showProfileMenu && showProfileEditor && !isDemo && (
             <div className="animate-fade-in" style={{ 
                position: 'absolute', top: '138px', right: 0, 
                background: 'rgba(28,28,30,0.98)', 
                border: '1px solid var(--surface-border)', 
                borderTop: 'none', borderRadius: '0 0 12px 12px', 
                padding: '0.75rem', width: '220px', zIndex: 50, 
                boxShadow: '0 8px 20px rgba(0,0,0,0.4)' 
             }}>
                <label style={{ fontSize: '0.75rem', color: '#aaa', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Weight (lbs)</label>
                <input className="workout-input" type="number" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: '#222', border: '1px solid #444', color: '#fff' }} value={editWeight} onChange={e => setEditWeight(e.target.value)} />

                <label style={{ fontSize: '0.75rem', color: '#aaa', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Height (inches)</label>
                <input className="workout-input" type="number" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: '#222', border: '1px solid #444', color: '#fff' }} value={editHeight} onChange={e => setEditHeight(e.target.value)} />

                <label style={{ fontSize: '0.75rem', color: '#aaa', display: 'block', marginBottom: '0.2rem', fontWeight: 600 }}>Gender</label>
                <select className="workout-input" style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', background: '#222', border: '1px solid #444', color: '#fff' }} value={editGender} onChange={e => setEditGender(e.target.value)}>
                   <option value="male">Male</option>
                   <option value="female">Female</option>
                </select>

                <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#222', border: '1px solid #444', borderRadius: '10px' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Intensity</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: getIntensityLabel(editIntensityFactor).color }}>
                         {getIntensityLabel(editIntensityFactor).emoji} {getIntensityLabel(editIntensityFactor).label} ({editIntensityFactor.toFixed(2)})
                      </span>
                   </div>
                   <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={editIntensityFactor}
                      onChange={e => setEditIntensityFactor(parseFloat(e.target.value))}
                      style={{
                         width: '100%',
                         height: '6px',
                         WebkitAppearance: 'none',
                         appearance: 'none' as any,
                         borderRadius: '3px',
                         outline: 'none',
                         cursor: 'pointer',
                         background: 'linear-gradient(to right, #63b3ed 0%, #48bb78 40%, #ed8936 70%, #fc8181 100%)',
                      }}
                   />
                </div>

                <button className="workout-btn-primary" style={{ padding: '0.75rem', fontSize: '0.9rem', marginTop: '0.5rem', borderRadius: '8px' }} onClick={handleSaveProfile} disabled={profileSaving}>
                   {profileSaving ? 'Saving...' : 'Save Profile Changes'}
                </button>
             </div>
          )}
        </div>
      </div>

      <div className="workout-tile" style={{ cursor: 'pointer', transition: 'all 0.3s ease' }} onClick={() => setExpandAnalytics(!expandAnalytics)}>
        <div className="workout-flex-between">
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Experience Profile</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
             <span className="experience-badge">{rankSymbol} {rankName} ({rankScore.toFixed(2)})</span>
             <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expandAnalytics ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Experience Progress Mini-Bar */}
        <div style={{ marginTop: '0.75rem', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
           <div style={{ 
              width: `${Math.min(100, (rankScore % 2) / 2 * 100)}%`, 
              height: '100%', 
              background: 'var(--accent)',
              boxShadow: '0 0 6px var(--accent)'
           }} />
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <div style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <p style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0 0 0.25rem 0' }}>{totalLifts}</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.75rem', margin: 0, textTransform: 'uppercase' }}>Lifts Logged</p>
          </div>
          <div style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
            <p style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0 0 0.25rem 0' }}>{Math.round(avgVol)}</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.75rem', margin: 0, textTransform: 'uppercase' }}>Avg Vol (lbs)</p>
          </div>
        </div>

        {expandAnalytics && (
           <div className="animate-fade-in" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--surface-border)' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Recent Performance Breakdown</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                 <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Est. Strength Rank</label>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>{rankName}</div>
                 </div>
                 <div>
                    <label style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Default Intensity</label>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: getIntensityLabel(user?.intensityFactor || 1.0).color }}>
                      {getIntensityLabel(user?.intensityFactor || 1.0).emoji} {getIntensityLabel(user?.intensityFactor || 1.0).label}
                    </div>
                 </div>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', marginTop: '1rem', fontSize: '0.8rem', borderRadius: '8px' }}
                onClick={(e) => { e.stopPropagation(); window.location.href = '/workout/analytics'; }}
              >
                View Deep Dive Charts ↗
              </button>
           </div>
        )}
      </div>

      {pendingWorkout && (() => {
          const age = Date.now() - (pendingWorkout.timestamp || 0);
          const minsAgo = Math.round(age / 60000);
          const workoutName = pendingWorkout.plan?.name || 'Workout';
          const totalSets = pendingWorkout.logs ? Object.values(pendingWorkout.logs).reduce((sum: number, sets: any) => sum + (sets?.length || 0), 0) : 0;
          return (
             <div className="workout-tile animate-fade-in" style={{ 
                borderLeft: '3px solid #4299e1', 
                background: 'linear-gradient(135deg, rgba(66, 153, 225, 0.08), rgba(102, 126, 234, 0.05))',
                marginBottom: '0.5rem' 
             }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                   <span style={{ fontSize: '1.5rem' }}>⚡</span>
                   <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>Workout In Progress</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                         {workoutName} • {minsAgo}m ago • {totalSets} sets logged
                      </div>
                   </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                   <button 
                     className="workout-btn-primary" 
                     style={{ flex: 2, margin: 0, padding: '0.85rem', background: 'linear-gradient(135deg, #4299e1, #667eea)', boxShadow: '0 4px 12px rgba(66, 153, 225, 0.3)' }}
                     onClick={() => window.location.href = '/workout/active?resume=true'}
                   >
                     Resume
                   </button>
                   <button 
                     className="btn btn-secondary" 
                     style={{ flex: 1, padding: '0.85rem', borderRadius: '12px', color: '#fc8181', borderColor: 'rgba(252,129,129,0.3)' }}
                     onClick={() => { localStorage.removeItem('pendingWorkout'); setPendingWorkout(null); }}
                   >
                     Discard
                   </button>
                </div>
             </div>
          );
      })()}

      {!showStartMenu ? (
        <button className="workout-btn-primary" style={{ padding: '1.25rem', fontSize: '1.25rem', marginTop: '0.5rem' }} onClick={() => setShowStartMenu(true)}>
          Start Lift ⚡
        </button>
      ) : (
        <div className="workout-tile animate-fade-in" style={{ borderColor: 'var(--accent)', background: 'rgba(var(--accent-rgb), 0.05)' }}>
          <div className="workout-flex-between">
            <h3 style={{ margin: '0 0 1rem 0' }}>Configure Workout</h3>
             <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0 0.5rem' }} onClick={() => setShowStartMenu(false)}>✕</button>
          </div>
          
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Select Gym</label>
          <select className="workout-input" value={selectedGym} onChange={e => setSelectedGym(e.target.value)}>
            <option value="">-- Choose Gym --</option>
            {availableGyms.map(g => <option key={g.id} value={g.id}>{g.emoji ? g.emoji + ' ' : ''}{g.name}</option>)}
          </select>

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Select Workout Type</label>
          <select className="workout-input" value={selectedType} onChange={e => setSelectedType(e.target.value)}>
             <option value="">-- Choose Type --</option>
             {availableTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.intensity}%)</option>)}
          </select>

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Number of Lifts</label>
          <input type="number" className="workout-input" value={liftCount} onChange={e => setLiftCount(e.target.value)} min="1" max="15" />

          <button 
             className="workout-btn-primary" 
             disabled={!selectedGym || !selectedType}
             style={{ opacity: (!selectedGym || !selectedType) ? 0.5 : 1 }}
             onClick={() => window.location.href = `/workout/active?gym=${selectedGym}&type=${selectedType}&lifts=${liftCount}&isDemo=${isDemo}`}
          >
            Build & Start
          </button>
        </div>
      )}

      <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'center' }}>
        <button className="btn btn-secondary" style={{ width: '100%', padding: '1rem', borderRadius: '12px' }} onClick={() => window.location.href = '/workout/config'}>
          Configuration
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%', padding: '1rem', borderRadius: '12px' }}
          onClick={() => {
            if (isDemo) {
              window.location.href = '/workout/calculators?isDemo=1';
              return;
            }
            window.location.href = '/workout/calculators';
          }}
        >
          Calculators
        </button>
        <button className="btn btn-secondary" style={{ width: '100%', padding: '1rem', borderRadius: '12px' }} onClick={() => window.location.href = '/workout/analytics'}>
          Advanced Analytics
        </button>
      </div>

      {isDemo && (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button onClick={() => setShowLogin(true)} style={{ background: 'none', border: 'none', color: 'var(--accent-light)', textDecoration: 'underline', cursor: 'pointer' }}>
            Login to personal account
          </button>
        </div>
      )}
    </div>
  );
}
