'use client';

import { useState, useEffect } from 'react';

interface WorkoutType {
  id: string;
  ownerId?: string;
  name: string;
  muscles: string[];
  intensity: number; 
  minReps: number;
  maxReps: number;
  sets: number;
}

export default function WorkoutTypeEditor() {
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');
  
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState<Partial<WorkoutType>>({ name: '', muscles: [], intensity: 75, sets: 4, minReps: 8, maxReps: 12 });
  const [systemPopup, setSystemPopup] = useState<{title: string, message: string, onConfirm: () => void} | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/types').then(r => r.json()),
      fetch('/api/workout/auth').then(r => r.json())
    ]).then(([dTypes, dAuth]) => {
      if (dTypes.success) setTypes(dTypes.types);
      if (dAuth.authenticated && dAuth.user) setUserId(dAuth.user.id);
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!newType.name) return;
    let res: Response;
    let data: any;

    if (newType.id) {
       res = await fetch('/api/workout/types', { method: 'PUT', body: JSON.stringify(newType) });
       data = await res.json();
       if (data.success) {
           setTypes(types.map(t => t.id === data.type.id ? data.type : t));
       }
    } else {
       res = await fetch('/api/workout/types', { method: 'POST', body: JSON.stringify(newType) });
       data = await res.json();
       if (data.success) {
           setTypes([...types, data.type]);
       }
    }

    if (data.success) {
      setAddingType(false);
      setNewType({ name: '', muscles: [], intensity: 75, sets: 4, minReps: 8, maxReps: 12 });
    }
  };

  const handleDelete = (id: string) => {
    setSystemPopup({ title: 'Delete Workout Type', message: 'Delete this Workout Type?', onConfirm: async () => {
      const res = await fetch('/api/workout/types?id=' + id, { method: 'DELETE' });
      if((await res.json()).success) {
         setTypes(types.filter(t => t.id !== id));
      }
      setSystemPopup(null);
    }});
  };

  const handleImport = (typeToImport: WorkoutType) => {
    setSystemPopup({ title: 'Import Template', message: `Import template "${typeToImport.name}"?`, onConfirm: async () => {
      const res = await fetch('/api/workout/types', { 
          method: 'POST', 
          body: JSON.stringify({ ...typeToImport, id: undefined, name: `${typeToImport.name} (Copy)` }) 
      });
      const data = await res.json();
      if (data.success) setTypes([...types, data.type]);
      setSystemPopup(null);
    }});
  };

  const allMuscles = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];

  const handleMuscleToggle = (m: string) => {
    const current = newType.muscles || [];
    if (current.includes(m)) setNewType({ ...newType, muscles: current.filter(x => x !== m) });
    else setNewType({ ...newType, muscles: [...current, m] });
  };

  if (loading) return <div style={{ padding: '1.5rem' }}>Loading Types...</div>;

  const myTypes = types.filter(t => t.ownerId === userId);
  const otherTypes = types.filter(t => t.ownerId !== userId);

  return (
    <div style={{ padding: '1.5rem' }}>
       <h3 style={{ margin: '0 0 1.5rem 0' }}>Your Workout Templates</h3>
       <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          {myTypes.map(t => (
            <div key={t.id} style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
              <div className="workout-flex-between">
                 <strong>{t.name}</strong>
                 <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button style={{ background:'none', border:'none', color:'var(--accent)'}} onClick={() => { setNewType(t); setAddingType(true); }}>✏️</button>
                    <button style={{ background:'none', border:'none', color:'#ff6b6b'}} onClick={() => handleDelete(t.id)}>✕</button>
                 </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {t.muscles.map(m => (
                  <span key={m} style={{ fontSize: '0.75rem', background: 'var(--surface-glass)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--accent)' }}>{m}</span>
                ))}
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                Target: {t.sets} Sets &bull; {t.minReps}-{t.maxReps} Reps (Intensity: {t.intensity}%)
              </p>
            </div>
          ))}
          {myTypes.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>No templates created yet.</p>}
       </div>

       {!addingType ? (
         <button className="workout-btn-primary" onClick={() => { setNewType({ name: '', muscles: [], intensity: 75, sets: 4, minReps: 8, maxReps: 12 }); setAddingType(true); }}>+ Create Template</button>
       ) : (
         <div className="animate-fade-in" style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--accent)' }}>
            <h4 style={{ margin: '0 0 1rem 0' }}>{newType.id ? 'Edit' : 'New'} Workout Type</h4>
            <input className="workout-input" placeholder="Name (e.g. Upper Hypertrophy)" value={newType.name} onChange={e => setNewType({ ...newType, name: e.target.value })} />
            
            <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>Target Muscles</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {allMuscles.map(m => {
                const active = newType.muscles?.includes(m);
                return (
                  <button 
                    key={m} 
                    onClick={() => handleMuscleToggle(m)}
                    style={{ 
                      padding: '0.4rem 0.8rem', 
                      borderRadius: '20px', 
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--surface-border)'}`,
                      background: active ? 'rgba(var(--accent-rgb), 0.2)' : 'transparent',
                      color: active ? 'white' : 'var(--muted)',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>

            <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span>Target Intensity (%)</span>
              <span style={{ color: 'var(--accent-light)' }}>{newType.intensity}% ({newType.intensity! > 80 ? 'Power' : newType.intensity! > 60 ? 'Hypertrophy' : 'Endurance'})</span>
            </label>
            <input 
              type="range" min="30" max="100" step="5" 
              value={newType.intensity} 
              onChange={e => {
                const val = parseInt(e.target.value);
                let reps = [8,12], sets = 4;
                if (val >= 85) { reps = [3,6]; sets = 5; }
                else if (val <= 60) { reps = [12,20]; sets = 3; }
                setNewType({ ...newType, intensity: val, minReps: reps[0], maxReps: reps[1], sets });
              }} 
              style={{ width: '100%', marginBottom: '1.5rem', accentColor: 'var(--accent)' }} 
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <div><label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Sets Target</label><input className="workout-input" type="number" value={newType.sets} onChange={e => setNewType({ ...newType, sets: parseInt(e.target.value) })} /></div>
              <div><label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Min Reps</label><input className="workout-input" type="number" value={newType.minReps} onChange={e => setNewType({ ...newType, minReps: parseInt(e.target.value) })} /></div>
              <div><label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Max Reps</label><input className="workout-input" type="number" value={newType.maxReps} onChange={e => setNewType({ ...newType, maxReps: parseInt(e.target.value) })} /></div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={handleSave}>Save</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAddingType(false)}>Cancel</button>
            </div>
         </div>
       )}

       {otherTypes.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Import Public Templates</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {otherTypes.map(t => (
                 <div key={t.id} className="workout-flex-between" style={{ padding: '0.75rem 1rem', background: 'var(--input-bg)', borderRadius: '12px' }}>
                    <span>{t.name} <small style={{color:'var(--muted)'}}>({t.intensity}%)</small></span>
                    <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => handleImport(t)}>Import</button>
                 </div>
              ))}
            </div>
          </div>
       )}

       {systemPopup && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             <div className="workout-tile animate-fade-in" style={{ width: '90%', maxWidth: '400px' }}>
                 <h3 style={{ margin: '0 0 1rem 0' }}>{systemPopup.title}</h3>
                 <p style={{ fontSize: '0.9rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>{systemPopup.message}</p>
                 <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="workout-btn-primary" style={{ margin: 0, flex: 1, background: '#ff6b6b' }} onClick={systemPopup.onConfirm}>Confirm</button>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSystemPopup(null)}>Cancel</button>
                 </div>
             </div>
          </div>
       )}
    </div>
  );
}
