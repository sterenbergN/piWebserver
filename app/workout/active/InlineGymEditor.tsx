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
  progressionProfile?: 'standard' | 'high-rep' | 'endurance';
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
  additionalWeights?: number[];
  additionalWeight?: number; // legacy compat
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

interface InlineGymEditorProps {
  gymId: string;
  onGymUpdated: (gym: Gym) => void;
  onClose: () => void;
  onAddLiftToWorkout?: (lift: Lift, station: Station) => void;
}

const ALL_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'None'];

const parseOptionalNumber = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default function InlineGymEditor({ gymId, onGymUpdated, onClose, onAddLiftToWorkout }: InlineGymEditorProps) {
  const [gym, setGym] = useState<Gym | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Station form
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [newStation, setNewStation] = useState<Partial<Station>>({ type: 'plates', lifts: [], attachments: [] });
  const [tempPlates, setTempPlates] = useState('');
  const [tempDumbbells, setTempDumbbells] = useState('');
  const [tempBodyWeight, setTempBodyWeight] = useState('');
  const [tempAdditionalWeights, setTempAdditionalWeights] = useState('');
  const [tempAttachment, setTempAttachment] = useState('');

  // Lift form
  const [editingLiftId, setEditingLiftId] = useState<{stationId: string, liftId: string | 'new'} | null>(null);
  const [newLift, setNewLift] = useState<Partial<Lift>>({ singleArmLeg: false, primaryMuscle: 'Chest', secondaryMuscle: 'None', progressionProfile: 'standard' });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/workout/gyms')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const found = d.gyms.find((g: Gym) => g.id === gymId);
          setGym(found || null);
        }
      })
      .finally(() => setLoading(false));
  }, [gymId]);

  const saveGym = async (updatedGym: Gym) => {
    setSaving(true);
    try {
      const res = await fetch('/api/workout/gyms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedGym),
      });
      const d = await res.json();
      if (d.success) {
        setGym(d.gym);
        onGymUpdated(d.gym);
      }
    } finally {
      setSaving(false);
    }
  };

  const resetStationForm = () => {
    setEditingStationId(null);
    setNewStation({ type: 'plates', lifts: [], attachments: [] });
    setTempPlates('');
    setTempDumbbells('');
    setTempBodyWeight('');
    setTempAdditionalWeights('');
    setTempAttachment('');
  };

  const resetLiftForm = () => {
    setEditingLiftId(null);
    setNewLift({ singleArmLeg: false, primaryMuscle: 'Chest', secondaryMuscle: 'None', progressionProfile: 'standard' });
  };

  const handleEditStation = (station: Station) => {
    setEditingStationId(station.id);
    setNewStation(station);
    setTempPlates(station.plateSets?.join(', ') || '');
    setTempDumbbells(station.dumbbellPairs?.join(', ') || '');
    setTempBodyWeight(station.bodyWeightAdditions?.join(', ') || '');
    setTempAdditionalWeights(station.additionalWeights?.join(', ') || '');
  };

  const handleEditLift = (stationId: string, lift: Lift) => {
    setEditingLiftId({ stationId, liftId: lift.id });
    setNewLift(lift);
  };

  const handleSaveStation = async () => {
    if (!gym || !newStation.name) return;

    const finalizedStation: Station = {
      id: editingStationId === 'new' ? Math.random().toString(36).substring(2, 10) : editingStationId,
      lifts: newStation.lifts || [],
      attachments: newStation.attachments || [],
      ...newStation,
    } as Station;

    // Parse typed inputs
    if (finalizedStation.type === 'plates') {
      finalizedStation.plateSets = tempPlates.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    } else {
      finalizedStation.plateSets = undefined;
      finalizedStation.baseWeight = undefined;
    }
    if (finalizedStation.type === 'dumbbells') {
      finalizedStation.dumbbellPairs = tempDumbbells.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    } else {
      finalizedStation.dumbbellPairs = undefined;
    }
    if (finalizedStation.type === 'bodyweight') {
      finalizedStation.bodyWeightAdditions = tempBodyWeight.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    } else {
      finalizedStation.bodyWeightAdditions = undefined;
    }
    if (finalizedStation.type === 'stack' || finalizedStation.type === 'cable') {
      finalizedStation.additionalWeights = tempAdditionalWeights
        .split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    } else {
      finalizedStation.minWeight = undefined;
      finalizedStation.maxWeight = undefined;
      finalizedStation.increment = undefined;
      finalizedStation.additionalWeights = undefined;
    }
    if (finalizedStation.type !== 'cable') {
      finalizedStation.attachments = [];
    }

    const updatedGym: Gym = {
      ...gym,
      stations: editingStationId === 'new' 
         ? [...(gym.stations || []), finalizedStation]
         : gym.stations.map(s => s.id === editingStationId ? finalizedStation : s),
    };

    await saveGym(updatedGym);
    resetStationForm();
  };

  const handleSaveLift = async (stationId: string) => {
    if (!gym || !newLift.name) return;

    const lift: Lift = {
      id: editingLiftId?.liftId === 'new' ? Math.random().toString(36).substring(2, 10) : (editingLiftId?.liftId || Math.random().toString(36).substring(2, 10)),
      name: newLift.name,
      singleArmLeg: newLift.singleArmLeg || false,
      primaryMuscle: newLift.primaryMuscle || 'Chest',
      secondaryMuscle: newLift.secondaryMuscle || 'None',
      progressionProfile: newLift.progressionProfile || 'standard',
    };

    const updatedGym: Gym = {
      ...gym,
      stations: gym.stations.map(s =>
        s.id === stationId
          ? { 
              ...s, 
              lifts: editingLiftId?.liftId === 'new'
                 ? [...(s.lifts || []), lift]
                 : s.lifts.map(l => l.id === editingLiftId?.liftId ? lift : l)
            }
          : s
      ),
    };

    await saveGym(updatedGym);
    resetLiftForm();
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading equipment...</div>;
  }

  if (!gym) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: '#fc8181' }}>
        Gym not found. It may not be loaded yet.
      </div>
    );
  }

  const renderStationForm = (isNew: boolean) => (
    <div className="workout-tile animate-fade-in" style={{ marginTop: isNew ? '0' : '0.5rem' }}>
      <h4 style={{ margin: '0 0 1rem 0' }}>{isNew ? 'New Station' : 'Edit Station'}</h4>

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Station Name</label>
      <input className="workout-input" placeholder="e.g. Chest Press Machine" value={newStation.name || ''} onChange={e => setNewStation({ ...newStation, name: e.target.value })} />

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Station Type</label>
      <select className="workout-input" value={newStation.type} onChange={e => setNewStation({ ...newStation, type: e.target.value as StationType })}>
        <option value="plates">Barbell / Plates</option>
        <option value="stack">Weight Stack</option>
        <option value="cable">Cable Machine</option>
        <option value="dumbbells">Dumbbells</option>
        <option value="bodyweight">Bodyweight</option>
      </select>

      {newStation.type === 'plates' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Bar Weight (lbs)</label>
          <input className="workout-input" type="number" placeholder="45" value={newStation.baseWeight ?? ''} onChange={e => setNewStation({ ...newStation, baseWeight: parseOptionalNumber(e.target.value) })} />
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Available Plates (comma separated)</label>
          <input className="workout-input" placeholder="e.g. 45, 25, 10, 5, 2.5" value={tempPlates} onChange={e => setTempPlates(e.target.value)} />
        </>
      )}

      {(newStation.type === 'stack' || newStation.type === 'cable') && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Min Weight (lbs)</label>
              <input className="workout-input" type="number" placeholder="10" value={newStation.minWeight ?? ''} onChange={e => setNewStation({ ...newStation, minWeight: parseOptionalNumber(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Max Weight (lbs)</label>
              <input className="workout-input" type="number" placeholder="200" value={newStation.maxWeight ?? ''} onChange={e => setNewStation({ ...newStation, maxWeight: parseOptionalNumber(e.target.value) })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Increment (lbs)</label>
              <input className="workout-input" type="number" placeholder="10" value={newStation.increment ?? ''} onChange={e => setNewStation({ ...newStation, increment: parseOptionalNumber(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Extra Weights (comma, lbs)</label>
              <input className="workout-input" placeholder="e.g. 5, 10" value={tempAdditionalWeights} onChange={e => setTempAdditionalWeights(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {newStation.type === 'dumbbells' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Available Pairs (comma separated)</label>
          <input className="workout-input" placeholder="e.g. 5, 10, 15, 20, 25" value={tempDumbbells} onChange={e => setTempDumbbells(e.target.value)} />
        </>
      )}

      {newStation.type === 'bodyweight' && (
        <>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Weight Additions (comma, lbs)</label>
          <input className="workout-input" placeholder="e.g. 25, 45" value={tempBodyWeight} onChange={e => setTempBodyWeight(e.target.value)} />
        </>
      )}

      {newStation.type === 'cable' && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>Attachments</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input className="workout-input" style={{ marginBottom: 0, flex: 1 }} placeholder="e.g. Rope, V-Bar" value={tempAttachment} onChange={e => setTempAttachment(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (tempAttachment.trim()) { setNewStation({ ...newStation, attachments: [...(newStation.attachments || []), tempAttachment.trim()] }); setTempAttachment(''); } }
            }} />
            <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }} onClick={() => { if (tempAttachment.trim()) { setNewStation({ ...newStation, attachments: [...(newStation.attachments || []), tempAttachment.trim()] }); setTempAttachment(''); } }}>+ Add</button>
          </div>
          {(newStation.attachments || []).length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {(newStation.attachments || []).map(att => (
                <span key={att} style={{ fontSize: '0.8rem', background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)', padding: '0.2rem 0.6rem', borderRadius: '12px', cursor: 'pointer' }} onClick={() => setNewStation({ ...newStation, attachments: (newStation.attachments || []).filter(a => a !== att) })}>
                  {att} ✕
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} disabled={!newStation.name || saving} onClick={handleSaveStation}>
          {saving ? 'Saving...' : 'Save Station'}
        </button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetStationForm}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
        Managing equipment for: <strong>{gym.emoji} {gym.name}</strong>
      </p>

      {/* Existing Stations */}
      {gym.stations?.map(station => (
        <div key={station.id} className="workout-tile" style={{ padding: '1rem' }}>
          {editingStationId === station.id ? renderStationForm(false) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div>
              <strong style={{ fontSize: '0.95rem' }}>{station.name}</strong>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.05rem 0.35rem', borderRadius: '10px' }}>
                {station.type}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={() => {
                  handleEditStation(station);
                  resetLiftForm();
                }}
              >
                Edit Equipment
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                onClick={() => {
                  setEditingLiftId({ stationId: station.id, liftId: 'new' });
                  resetStationForm();
                }}
              >
                + Add Lift
              </button>
            </div>
          </div>

          {/* Lifts */}
          {(station.lifts || []).map(lift => (
            <div key={lift.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'var(--input-bg)', borderRadius: '8px', marginBottom: '0.35rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{lift.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  {lift.primaryMuscle}{lift.secondaryMuscle && lift.secondaryMuscle !== 'None' ? ` • ${lift.secondaryMuscle}` : ''}
                  {lift.progressionProfile && lift.progressionProfile !== 'standard' ? ` • ${lift.progressionProfile}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  style={{ margin: 0, padding: '0.4rem 0.75rem', fontSize: '0.75rem', borderRadius: '8px' }}
                  onClick={() => handleEditLift(station.id, lift)}
                >
                  Edit
                </button>
                {onAddLiftToWorkout && (
                  <button
                    className="workout-btn-primary"
                    style={{ margin: 0, padding: '0.4rem 0.75rem', fontSize: '0.75rem', borderRadius: '8px' }}
                    onClick={() => onAddLiftToWorkout(lift, station)}
                  >
                    + Workout
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Lift Add Form */}
          {editingLiftId?.stationId === station.id && (
            <div className="animate-fade-in" style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--background)', borderRadius: '12px', border: '1px solid var(--accent)' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem' }}>{editingLiftId.liftId === 'new' ? 'New Lift' : 'Edit Lift'}</h4>
              <input
                className="workout-input"
                placeholder="Lift name (e.g. Bench Press)"
                value={newLift.name || ''}
                onChange={e => setNewLift({ ...newLift, name: e.target.value })}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>Primary Muscle</label>
                  <select className="workout-input" value={newLift.primaryMuscle} onChange={e => setNewLift({ ...newLift, primaryMuscle: e.target.value })}>
                    {ALL_MUSCLES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>Secondary Muscle</label>
                  <select className="workout-input" value={newLift.secondaryMuscle} onChange={e => setNewLift({ ...newLift, secondaryMuscle: e.target.value })}>
                    {ALL_MUSCLES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>Progression Profile</label>
                <select className="workout-input" value={newLift.progressionProfile || 'standard'} onChange={e => setNewLift({ ...newLift, progressionProfile: e.target.value as any })}>
                  <option value="standard">Standard (weight-first)</option>
                  <option value="high-rep">High-Rep (rep-first, 12–30)</option>
                  <option value="endurance">Endurance (volume-first)</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                <input type="checkbox" checked={newLift.singleArmLeg || false} onChange={e => setNewLift({ ...newLift, singleArmLeg: e.target.checked })} />
                Single Arm / Leg variation
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} disabled={saving} onClick={() => handleSaveLift(station.id)}>
                  {saving ? 'Saving...' : 'Save Lift'}
                </button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetLiftForm}>Cancel</button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      ))}

      {/* Add Station Form */}
      {!editingStationId ? (
        <button
          className="btn btn-secondary"
          style={{ width: '100%', padding: '0.85rem', borderRadius: '12px' }}
          onClick={() => {
            setEditingStationId('new');
            resetLiftForm();
          }}
        >
          + Add Equipment Station
        </button>
      ) : (
        renderStationForm(true)
      )}
      <div ref={scrollRef} />
    </div>
  );
}
