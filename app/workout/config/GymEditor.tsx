'use client';

import { useState, useEffect, useRef } from 'react';

type StationType = 'plates' | 'stack' | 'cable' | 'dumbbells' | 'bodyweight';

interface Lift {
  id: string;
  name: string;
  singleArmLeg: boolean;
  primaryMuscle: string;
  secondaryMuscle: string;
  attachment?: string;
}

interface Station {
  id: string;
  name: string;
  type: StationType;
  baseWeight?: number; 
  plateSets?: number[]; 
  minWeight?: number;
  maxWeight?: number;
  increment?: number;
  additionalWeight?: number;
  attachments?: string[];
  dumbbellPairs?: number[];
  bodyWeightAdditions?: number[]; 
  lifts: Lift[];
}

interface Gym {
  id: string;
  name: string;
  emoji?: string;
  ownerId: string;
  stations: Station[];
}

const GYM_EMOJIS = ['🏋️', '💪', '🏠', '🏢', '🏟️', '🏃', '🔥', '⚡', '🎯', '🏆', '🦾', '🧗'];

export default function GymEditor() {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeGym, setActiveGym] = useState<Gym | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');

  // Active Editors
  const [addingGym, setAddingGym] = useState(false);
  const [editingGymId, setEditingGymId] = useState<string | null>(null);
  const [newGymName, setNewGymName] = useState('');
  const [newGymEmoji, setNewGymEmoji] = useState('🏋️');
  
  const [addingStation, setAddingStation] = useState(false);
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [activeStation, setActiveStation] = useState<Station | null>(null);
  const [newStation, setNewStation] = useState<Partial<Station>>({ type: 'plates', lifts: [], attachments: [] });
  
  const [addingLift, setAddingLift] = useState(false);
  const [editingLiftId, setEditingLiftId] = useState<string | null>(null);
  const [newLift, setNewLift] = useState<Partial<Lift>>({ singleArmLeg: false, primaryMuscle: 'Chest', secondaryMuscle: 'None' });

  // Temp string models for array parsing
  const [tempPlates, setTempPlates] = useState('');
  const [tempDumbbells, setTempDumbbells] = useState('');
  const [tempBodyWeight, setTempBodyWeight] = useState('');
  const [tempAttachment, setTempAttachment] = useState('');

  // Import Station Prompt
  const [importPrompt, setImportPrompt] = useState<{ match: Station, target: Station } | null>(null);
  const [importSelectedLifts, setImportSelectedLifts] = useState<Set<string>>(new Set());
  const [systemPopup, setSystemPopup] = useState<{title: string, message: string, onConfirm: () => void} | null>(null);
  const gymFormRef = useRef<HTMLDivElement | null>(null);
  const stationFormRefs = useRef(new Map<string, HTMLDivElement>());
  const liftFormRefs = useRef(new Map<string, HTMLDivElement>());

  const resetStationEditor = () => {
    setAddingStation(false);
    setEditingStationId(null);
    setNewStation({ type: 'plates', lifts: [], attachments: [] });
    setTempPlates('');
    setTempDumbbells('');
    setTempBodyWeight('');
    setTempAttachment('');
  };

  const resetLiftEditor = () => {
    setAddingLift(false);
    setEditingLiftId(null);
    setNewLift({ singleArmLeg: false, primaryMuscle: 'Chest', secondaryMuscle: 'None' });
  };

  const parseOptionalNumber = (value: string) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const setStationFormRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) stationFormRefs.current.set(key, el);
    else stationFormRefs.current.delete(key);
  };

  const setLiftFormRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) liftFormRefs.current.set(key, el);
    else liftFormRefs.current.delete(key);
  };

  useEffect(() => {
    if (addingGym && gymFormRef.current) {
      gymFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [addingGym, editingGymId]);

  useEffect(() => {
    if (!addingStation) return;
    const key = editingStationId ?? 'new';
    const el = stationFormRefs.current.get(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [addingStation, editingStationId]);

  useEffect(() => {
    if (!addingLift) return;
    const key = `${activeStation?.id ?? 'none'}:${editingLiftId ?? 'new'}`;
    const el = liftFormRefs.current.get(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [addingLift, editingLiftId, activeStation?.id]);

  const applyStationType = (stationType: StationType, sourceStation?: Partial<Station>) => {
    const lifts = sourceStation?.lifts || newStation.lifts || [];
    const attachments = stationType === 'cable' ? (sourceStation?.attachments || newStation.attachments || []) : [];

    setNewStation({
      id: sourceStation?.id,
      name: sourceStation?.name || newStation.name || '',
      type: stationType,
      lifts,
      attachments,
      baseWeight: stationType === 'plates' ? sourceStation?.baseWeight : undefined,
      plateSets: stationType === 'plates' ? sourceStation?.plateSets : undefined,
      minWeight: stationType === 'stack' || stationType === 'cable' ? sourceStation?.minWeight : undefined,
      maxWeight: stationType === 'stack' || stationType === 'cable' ? sourceStation?.maxWeight : undefined,
      increment: stationType === 'stack' || stationType === 'cable' ? sourceStation?.increment : undefined,
      additionalWeight: stationType === 'stack' || stationType === 'cable' ? sourceStation?.additionalWeight : undefined,
      dumbbellPairs: stationType === 'dumbbells' ? sourceStation?.dumbbellPairs : undefined,
      bodyWeightAdditions: stationType === 'bodyweight' ? sourceStation?.bodyWeightAdditions : undefined,
    });

    setTempPlates(stationType === 'plates' ? (sourceStation?.plateSets || []).join(', ') : '');
    setTempDumbbells(stationType === 'dumbbells' ? (sourceStation?.dumbbellPairs || []).join(', ') : '');
    setTempBodyWeight(stationType === 'bodyweight' ? (sourceStation?.bodyWeightAdditions || []).join(', ') : '');
    setTempAttachment('');
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/gyms').then(r => r.json()),
      fetch('/api/workout/auth').then(r => r.json())
    ]).then(([dGyms, dAuth]) => {
      if (dGyms.success) setGyms(dGyms.gyms);
      if (dAuth.authenticated && dAuth.user) setUserId(dAuth.user.id);
    }).finally(() => setLoading(false));
  }, []);

  const saveGymToAPI = async (gymToSave: Gym) => {
    const res = await fetch('/api/workout/gyms', { method: 'PUT', body: JSON.stringify(gymToSave) });
    const d = await res.json();
    if (d.success) {
      setGyms(gyms.map(g => g.id === d.gym.id ? d.gym : g));
      setActiveGym(d.gym);
    }
  };

  const handleCreateGym = async () => {
    if (!newGymName) return;
    const res = await fetch('/api/workout/gyms', { method: 'POST', body: JSON.stringify({ name: newGymName, emoji: newGymEmoji }) });
    const data = await res.json();
    if (data.success) {
      setGyms([...gyms, data.gym]);
      setActiveGym(data.gym);
      setAddingGym(false);
      setNewGymName('');
      setNewGymEmoji('🏋️');
    }
  };

  const handleSubmitGym = async () => {
    if (!newGymName) return;

    if (editingGymId) {
      const gymToUpdate = gyms.find((gym) => gym.id === editingGymId);
      if (!gymToUpdate) return;

      const res = await fetch('/api/workout/gyms', {
        method: 'PUT',
        body: JSON.stringify({ ...gymToUpdate, name: newGymName, emoji: newGymEmoji }),
      });
      const data = await res.json();
      if (data.success) {
        setGyms(gyms.map((gym) => (gym.id === data.gym.id ? data.gym : gym)));
        if (activeGym?.id === data.gym.id) setActiveGym(data.gym);
      }
      setAddingGym(false);
      setEditingGymId(null);
      setNewGymName('');
      setNewGymEmoji('🏋️');
      return;
    }

    await handleCreateGym();
  };

  const handleDeleteGym = (id: string) => {
    setSystemPopup({ title: 'Delete Gym', message: 'Delete this Gym entirely?', onConfirm: async () => {
        const res = await fetch('/api/workout/gyms?id=' + id, { method: 'DELETE' });
        if((await res.json()).success) {
           setGyms(gyms.filter(g => g.id !== id));
           if (activeGym?.id === id) setActiveGym(null);
        }
        setSystemPopup(null);
    }});
  };

  const handleImportGym = (gymToImport: Gym) => {
    setSystemPopup({ title: 'Import Gym', message: `Import all stations & lifts from ${gymToImport.name}?`, onConfirm: async () => {
        const res = await fetch('/api/workout/gyms', { 
            method: 'POST', 
            body: JSON.stringify({ name: `${gymToImport.name} (Copy)`, emoji: gymToImport.emoji, stations: gymToImport.stations }) 
        });
        const data = await res.json();
        if (data.success) setGyms([...gyms, data.gym]);
        setSystemPopup(null);
    }});
  };

  const handleSaveStation = async (applyImportRts: Lift[] | null = null) => {
    if (!activeGym) return;
    
    const finalizedStation = { ...newStation, lifts: newStation.lifts || [] } as Station;
    if (!finalizedStation.id) finalizedStation.id = Math.random().toString(36).substring(2, 10);

    if (applyImportRts) {
        finalizedStation.lifts = [...finalizedStation.lifts, ...applyImportRts.map(l => ({...l, id: Math.random().toString(36).substring(2, 10)}))];
    }

    finalizedStation.attachments = finalizedStation.type === 'cable' ? (finalizedStation.attachments || []) : [];
    finalizedStation.plateSets = finalizedStation.type === 'plates' ? tempPlates.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) : undefined;
    finalizedStation.baseWeight = finalizedStation.type === 'plates' ? finalizedStation.baseWeight : undefined;
    finalizedStation.dumbbellPairs = finalizedStation.type === 'dumbbells' ? tempDumbbells.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) : undefined;
    finalizedStation.bodyWeightAdditions = finalizedStation.type === 'bodyweight' ? tempBodyWeight.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) : undefined;

    if (finalizedStation.type !== 'stack' && finalizedStation.type !== 'cable') {
      finalizedStation.minWeight = undefined;
      finalizedStation.maxWeight = undefined;
      finalizedStation.increment = undefined;
      finalizedStation.additionalWeight = undefined;
    }

    if (finalizedStation.type !== 'cable') {
      finalizedStation.lifts = finalizedStation.lifts.map((lift) => ({ ...lift, attachment: undefined }));
    }

    // Check for similar stations to prompt import if creating NEW
    if (!newStation.id && !applyImportRts) {
       for (const g of gyms) {
         if (g.id !== activeGym.id) {
            const match = g.stations.find(s => s.name.toLowerCase() === finalizedStation.name.toLowerCase() && s.type === finalizedStation.type && s.lifts?.length > 0);
             if (match) {
               setImportPrompt({ match, target: finalizedStation });
               setImportSelectedLifts(new Set(match.lifts.map(l => l.id)));
               return; // halt save, wait for user prompt
             }
         }
       }
    }

    setImportPrompt(null);
    let updatedStations = activeGym.stations || [];
    if (newStation.id) {
       updatedStations = updatedStations.map(s => s.id === newStation.id ? finalizedStation : s);
    } else {
       updatedStations = [...updatedStations, finalizedStation];
    }

    const updatedGym = { ...activeGym, stations: updatedStations };
    await saveGymToAPI(updatedGym);
    resetStationEditor();
  };

  const handleDeleteStation = (id: string) => {
     if (!activeGym) return;
     setSystemPopup({ title: 'Delete Station', message: 'Delete equipment station?', onConfirm: async () => {
         if (editingStationId === id) {
            resetStationEditor();
         }
         const updatedGym = { ...activeGym, stations: activeGym.stations.filter(s => s.id !== id) };
         await saveGymToAPI(updatedGym);
         setSystemPopup(null);
     }});
  };

  const handleDeleteLiftInline = (station: Station, liftId: string) => {
      if (!activeGym) return;
      setSystemPopup({ title: 'Delete Lift', message: 'Delete this lift?', onConfirm: async () => {
         const updatedStation = { ...station, lifts: station.lifts.filter(l => l.id !== liftId) };
         const updatedStations = activeGym.stations.map(s => s.id === station.id ? updatedStation : s);
         await saveGymToAPI({ ...activeGym, stations: updatedStations });
         setSystemPopup(null);
      }});
  };

  const handleSaveLift = async () => {
      if (!activeGym || !activeStation || !newLift.name) return;
      const lift = { ...newLift, id: newLift.id || Math.random().toString(36).substring(2, 10) } as Lift;
      
      let updatedStation: Station;
      if (newLift.id && activeStation.lifts.some(l => l.id === newLift.id)) {
          // Editing existing lift
          updatedStation = { ...activeStation, lifts: activeStation.lifts.map(l => l.id === lift.id ? lift : l) };
      } else {
          // Adding new lift
          updatedStation = { ...activeStation, lifts: [...(activeStation.lifts || []), lift] };
      }
      const updatedStations = activeGym.stations.map(s => s.id === activeStation.id ? updatedStation : s);
      const updatedGym = { ...activeGym, stations: updatedStations };
      
      await saveGymToAPI(updatedGym);
      resetLiftEditor();
  };

  const handleAddAttachment = () => {
      const val = tempAttachment.trim();
      if (val && !(newStation.attachments || []).includes(val)) {
          setNewStation({ ...newStation, attachments: [...(newStation.attachments || []), val] });
      }
      setTempAttachment('');
  };

  const handleRemoveAttachment = (att: string) => {
      setNewStation({ ...newStation, attachments: (newStation.attachments || []).filter(a => a !== att) });
  };

  const allMuscles = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'None'];

  const renderLiftEditor = (station: Station, inline = false, formKey = 'new') => (
    <div
      className="animate-fade-in"
      style={{
        background: 'var(--background)',
        padding: '1rem',
        borderRadius: '12px',
        border: inline ? '1px solid var(--accent)' : '1px solid var(--accent)',
        marginTop: inline ? '0.5rem' : 0
      }}
      ref={setLiftFormRef(formKey)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
          {newLift.id ? 'Editing' : 'New'}
        </span>
      </div>
      <h4 style={{ margin: '0 0 1rem 0' }}>{newLift.id ? 'Edit' : 'New'} Lift Details</h4>
      <input className="workout-input" placeholder="Lift Name (e.g. Bench Press)" value={newLift.name || ''} onChange={e => setNewLift({...newLift, name: e.target.value})} />
      
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Primary Muscle</label>
          <select className="workout-input" value={newLift.primaryMuscle} onChange={e => setNewLift({...newLift, primaryMuscle: e.target.value})}>
            {allMuscles.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Secondary Muscle</label>
          <select className="workout-input" value={newLift.secondaryMuscle} onChange={e => setNewLift({...newLift, secondaryMuscle: e.target.value})}>
            {allMuscles.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Cable attachment selector per lift */}
      {station.type === 'cable' && station.attachments && station.attachments.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Attachment</label>
          <select className="workout-input" value={newLift.attachment || ''} onChange={e => setNewLift({...newLift, attachment: e.target.value})}>
            <option value="">None</option>
            {station.attachments.map(att => <option key={att} value={att}>{att}</option>)}
          </select>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        <input type="checkbox" checked={newLift.singleArmLeg || false} onChange={e => setNewLift({...newLift, singleArmLeg: e.target.checked})} />
        Single Arm / Leg variation
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={handleSaveLift}>Save Lift</button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetLiftEditor}>Cancel</button>
      </div>
    </div>
  );

  const renderStationConfigForm = (inline = false, formKey = 'new') => (
    <div
      className="animate-fade-in"
      style={{
        background: 'var(--background)',
        padding: '1rem',
        borderRadius: '12px',
        border: inline ? '1px solid var(--accent)' : '1px solid transparent',
        marginTop: inline ? '0.75rem' : 0
      }}
      ref={setStationFormRef(formKey)}
    >
      <h4 style={{ margin: '0 0 1rem 0' }}>{newStation.id ? 'Edit Station Config' : 'New Station Config'}</h4>

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Station Name</label>
      <input
        className="workout-input"
        placeholder="e.g. Squat Rack"
        value={newStation.name || ''}
        onChange={e => setNewStation({ ...newStation, name: e.target.value })}
      />

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Station Type</label>
      <select className="workout-input" value={newStation.type} onChange={e => applyStationType(e.target.value as StationType, newStation)}>
        <option value="plates">Barbell / Plate Loaded</option>
        <option value="stack">Machine Weight Stack</option>
        <option value="cable">Cable Machine</option>
        <option value="dumbbells">Dumbbells</option>
        <option value="bodyweight">Body Weight</option>
      </select>

      {newStation.type === 'plates' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Base Bar Weight (lbs)</label>
          <input
            className="workout-input"
            type="number"
            placeholder="e.g. 45"
            value={newStation.baseWeight ?? ''}
            onChange={e => setNewStation({ ...newStation, baseWeight: parseOptionalNumber(e.target.value) })}
          />
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Available Plates (comma separated)</label>
          <input className="workout-input" placeholder="e.g. 45, 45, 25, 10, 5, 2.5" value={tempPlates} onChange={e => setTempPlates(e.target.value)} />
        </>
      )}

      {(newStation.type === 'stack' || newStation.type === 'cable') && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Minimum Weight (lbs)</label>
              <input
                className="workout-input"
                type="number"
                placeholder="Min"
                value={newStation.minWeight ?? ''}
                onChange={e => setNewStation({ ...newStation, minWeight: parseOptionalNumber(e.target.value) })}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Maximum Weight (lbs)</label>
              <input
                className="workout-input"
                type="number"
                placeholder="Max"
                value={newStation.maxWeight ?? ''}
                onChange={e => setNewStation({ ...newStation, maxWeight: parseOptionalNumber(e.target.value) })}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Weight Increment (lbs)</label>
              <input
                className="workout-input"
                type="number"
                placeholder="Jump Δ"
                value={newStation.increment ?? ''}
                onChange={e => setNewStation({ ...newStation, increment: parseOptionalNumber(e.target.value) })}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Additional Stack Weight (lbs)</label>
              <input
                className="workout-input"
                type="number"
                placeholder="Optional"
                value={newStation.additionalWeight ?? ''}
                onChange={e => setNewStation({ ...newStation, additionalWeight: parseOptionalNumber(e.target.value) })}
              />
            </div>
          </div>
        </>
      )}

      {newStation.type === 'cable' && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Attachments</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              className="workout-input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder="e.g. Rope, V-Bar"
              value={tempAttachment}
              onChange={e => setTempAttachment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddAttachment(); }}}
            />
            <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }} onClick={handleAddAttachment}>+ Add</button>
          </div>
          {(newStation.attachments || []).length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(newStation.attachments || []).map(att => (
                <span key={att} style={{ fontSize: '0.8rem', background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)', padding: '0.2rem 0.6rem', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  {att}
                  <button onClick={() => handleRemoveAttachment(att)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: 0, fontSize: '0.8rem' }}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {newStation.type === 'dumbbells' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Available Dumbbell Pairs (lbs, comma separated)</label>
          <input className="workout-input" placeholder="e.g. 5, 10, 15, 20" value={tempDumbbells} onChange={e => setTempDumbbells(e.target.value)} />
        </>
      )}

      {newStation.type === 'bodyweight' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Additional Bodyweight Attachments (lbs)</label>
          <input className="workout-input" placeholder="e.g. 45, 25, 10" value={tempBodyWeight} onChange={e => setTempBodyWeight(e.target.value)} />
        </>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={() => handleSaveStation(null)}>{newStation.id ? 'Save Station' : 'Add Station'}</button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetStationEditor}>Cancel</button>
      </div>
    </div>
  );

  if (loading) return <div style={{ padding: '1.5rem' }}>Loading Gyms...</div>;

  const myGyms = gyms.filter(g => g.ownerId === userId);
  const otherGyms = gyms.filter(g => g.ownerId !== userId);

  return (
    <div style={{ padding: '1.5rem' }}>
      
      {!activeGym ? (
        <div>
          <h3 style={{ margin: '0 0 1rem 0' }}>Your Gyms</h3>
          {myGyms.length === 0 && <p style={{ opacity: 0.6 }}>No gyms created yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {myGyms.map(g => (
              <div key={g.id} style={{ display: 'flex', gap: '0.5rem' }}>
                 <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '1rem', border: '1px solid var(--surface-border)', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }} onClick={() => setActiveGym(g)}>
                   <strong>{g.emoji || '🏋️'} {g.name}</strong>
                   <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{g.stations?.length || 0} Stations</span>
                 </button>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <button className="btn btn-secondary" style={{ padding: '0.65rem 0.9rem', fontSize: '0.8rem', borderRadius: '12px' }} onClick={() => { setAddingGym(true); setEditingGymId(g.id); setNewGymName(g.name); setNewGymEmoji(g.emoji || '🏋️'); }}>
                      Edit
                    </button>
                    <button style={{ background: '#ff6b6b', color: 'white', border: 'none', borderRadius: '12px', padding: '0.65rem 0.9rem' }} onClick={() => handleDeleteGym(g.id)}>✕</button>
                 </div>
              </div>
            ))}
          </div>

          {!addingGym ? (
            <button className="workout-btn-primary" onClick={() => { setAddingGym(true); setEditingGymId(null); setNewGymName(''); setNewGymEmoji('🏋️'); }}>+ Create New Gym</button>
          ) : (
            <div ref={gymFormRef} style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--accent)' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                 {editingGymId && (
                   <span style={{ fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
                     Editing
                   </span>
                 )}
               </div>
               <input className="workout-input" placeholder="Gym Name (e.g. Planet Fitness)" value={newGymName} onChange={e => setNewGymName(e.target.value)} />
              
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>Choose Emoji</label>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {GYM_EMOJIS.map(em => (
                  <button key={em} onClick={() => setNewGymEmoji(em)} style={{ fontSize: '1.5rem', width: '40px', height: '40px', border: newGymEmoji === em ? '2px solid var(--accent)' : '1px solid var(--surface-border)', borderRadius: '8px', background: newGymEmoji === em ? 'rgba(var(--accent-rgb),0.15)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{em}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={handleSubmitGym}>{editingGymId ? 'Save Gym' : 'Create'}</button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setAddingGym(false); setEditingGymId(null); setNewGymName(''); setNewGymEmoji('🏋️'); }}>Cancel</button>
              </div>
            </div>
          )}

          {otherGyms.length > 0 && (
             <div style={{ marginTop: '2rem' }}>
               <h3 style={{ margin: '0 0 1rem 0' }}>Import Public Gyms</h3>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 {otherGyms.map(g => (
                    <div key={g.id} className="workout-flex-between" style={{ padding: '0.75rem 1rem', background: 'var(--input-bg)', borderRadius: '12px' }}>
                       <span>{g.emoji || '🏋️'} {g.name} <small style={{color:'var(--muted)'}}>({g.stations?.length} stns)</small></span>
                       <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => handleImportGym(g)}>Import</button>
                    </div>
                 ))}
               </div>
             </div>
          )}
        </div>
      ) : importPrompt ? (
        // --- IMPORT STATION PROMPT ---
        <div className="animate-fade-in workout-tile" style={{ border: '2px solid var(--accent)' }}>
           <h3>Station Found in Other Gym</h3>
           <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
              We found a similar station named <strong>&quot;{importPrompt.match.name}&quot;</strong> in another gym. It contains {importPrompt.match.lifts.length} configured lifts.
           </p>
           <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>Would you like to import any of the following lifts?</p>
           
           <div style={{ background: 'var(--background)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1.5rem', maxHeight: '200px', overflowY: 'auto' }}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
                 {importPrompt.match.lifts.map(l => (
                     <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: 'pointer' }}>
                         <input type="checkbox" checked={importSelectedLifts.has(l.id)} onChange={e => {
                             const ns = new Set(importSelectedLifts);
                             if (e.target.checked) ns.add(l.id); else ns.delete(l.id);
                             setImportSelectedLifts(ns);
                         }} />
                         {l.name} ({l.primaryMuscle}) {l.singleArmLeg ? '- Single Limb' : ''}
                     </label>
                 ))}
              </ul>
           </div>

           <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={() => { setNewStation(importPrompt.target); handleSaveStation(importPrompt.match.lifts.filter(l => importSelectedLifts.has(l.id))); }}>Import Selected</button>
              <button className="btn btn-secondary" style={{ flex: 1, border: '1px solid #ff6b6b', color: '#ff6b6b' }} onClick={() => { setNewStation(importPrompt.target); handleSaveStation([]); }}>Import None</button>
           </div>
        </div>
      ) : (
        // --- GYM STATIONS VIEW ---
        <div className="animate-fade-in">
          <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
             <h3 style={{ margin: 0 }}>{activeGym.emoji || '📍'} {activeGym.name}</h3>
             <div style={{ display: 'flex', gap: '0.5rem' }}>
               <button
                 className="btn btn-secondary"
                  onClick={() => {
                    setAddingGym(true);
                    setEditingGymId(activeGym.id);
                    setNewGymName(activeGym.name);
                    setNewGymEmoji(activeGym.emoji || '🏋️');
                    resetStationEditor();
                    setActiveGym(null);
                  }}
                 style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
               >
                 Edit Gym
               </button>
                <button className="btn btn-secondary" onClick={() => { resetStationEditor(); setActiveGym(null); }} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>Exit Gym</button>
              </div>
           </div>

          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--accent-light)' }}>Stations & Equipment</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            {activeGym.stations?.map(st => (
               <div key={st.id} style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--surface-border)', padding: '1rem', borderRadius: '12px' }}>
                  <div className="workout-flex-between" style={{ marginBottom: '0.5rem', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <strong style={{ flex: 1 }}>
                      {st.name} <span style={{ opacity: 0.5, fontWeight: 'normal', fontSize: '0.8rem' }}>({st.type})</span>
                      {addingStation && editingStationId === st.id && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
                          Editing
                        </span>
                      )}
                    </strong>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--accent)' }}
                        onClick={() => {
                          if (addingStation && editingStationId === st.id) {
                            resetStationEditor();
                            return;
                          }
                          setAddingStation(true);
                          setEditingStationId(st.id);
                          applyStationType(st.type, st);
                        }}
                      >
                        {addingStation && editingStationId === st.id ? 'Close' : 'Edit'}
                      </button>
                      <button style={{ background: 'none', border: 'none', color: '#ff6b6b' }} onClick={() => handleDeleteStation(st.id)}>✕ Delete Station</button>
                    </div>
                 </div>
                 
                 {st.type === 'cable' && st.attachments && st.attachments.length > 0 && (
                     <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
                        Attachments: {st.attachments.join(', ')}
                     </div>
                 )}

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {st.lifts && st.lifts.map(l => (
                        <div key={l.id} style={{ background: 'var(--input-bg)', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                            <div className="workout-flex-between">
                              <div>
                                 <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{l.name}</span>
                                 {addingLift && editingLiftId === l.id && (
                                   <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
                                     Editing
                                   </span>
                                 )}
                                 <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>{l.primaryMuscle} {l.secondaryMuscle !== 'None' && ('/ ' + l.secondaryMuscle)} {l.singleArmLeg && '(Single Limb)'} {l.attachment && ('- ' + l.attachment)}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                 <button style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.85rem' }} onClick={() => {
                                   if (addingLift && editingLiftId === l.id) {
                                     resetLiftEditor();
                                     return;
                                   }
                                   setActiveStation(st);
                                   setNewLift(l);
                                   setAddingLift(true);
                                   setEditingLiftId(l.id);
                                 }}>{addingLift && editingLiftId === l.id ? 'Close' : 'Edit'}</button>
                                 <button style={{ background: 'none', border: 'none', color: '#ff6b6b', fontSize: '0.85rem' }} onClick={() => handleDeleteLiftInline(st, l.id)}>Delete</button>
                              </div>
                            </div>
                            {addingLift && editingLiftId === l.id && activeStation?.id === st.id && renderLiftEditor(st, true, `${st.id}:${l.id}`)}
                        </div>
                    ))}
                    {(!st.lifts || st.lifts.length === 0) && <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.25rem 0' }}>No lifts configured.</p>}
                 </div>
                 
                 <button className="btn btn-secondary" style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem', marginTop: '0.5rem' }} onClick={() => { setActiveStation(st); setNewLift({ singleArmLeg: false, primaryMuscle: 'Chest', secondaryMuscle: 'None' }); setAddingLift(true); setEditingLiftId(null); }}>
                      + Add Lift to {st.name}
                 </button>
                 {addingLift && editingLiftId === null && activeStation?.id === st.id && (
                   <div style={{ marginTop: '0.5rem' }}>
                     {renderLiftEditor(st, true, `${st.id}:new`)}
                   </div>
                 )}

                 {addingStation && editingStationId === st.id && renderStationConfigForm(true, st.id)}
                </div>
             ))}
            {(!activeGym.stations || activeGym.stations.length === 0) && <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>No equipment configured yet.</p>}
          </div>

          {!addingStation && (
            <button className="workout-btn-primary" onClick={() => {
              setAddingStation(true);
              setEditingStationId(null);
              applyStationType('plates', { type: 'plates', lifts: [], attachments: [] });
            }} style={{ background: 'transparent', border: '1px dashed var(--accent)', color: 'var(--accent)', boxShadow: 'none' }}>
              + Add Equipment Station
            </button>
          )}
          {addingStation && editingStationId === null && renderStationConfigForm(false, 'new')}
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
