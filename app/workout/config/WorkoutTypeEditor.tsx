'use client';

import { useState, useEffect, useRef } from 'react';

interface WorkoutType {
  id: string;
  ownerId?: string;
  name: string;
  muscles: string[];
  intensity: number;
  minReps: number;
  maxReps: number;
  sets: number;
  isPublic?: boolean;
}

const EMPTY_TYPE: Partial<WorkoutType> = {
  name: '',
  muscles: [],
  intensity: 75,
  sets: 4,
  minReps: 8,
  maxReps: 12,
  isPublic: false,
};

export default function WorkoutTypeEditor() {
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string>('');

  const [addingType, setAddingType] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [newType, setNewType] = useState<Partial<WorkoutType>>(EMPTY_TYPE);
  const [systemPopup, setSystemPopup] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const typeFormRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/types?scope=all').then((r) => r.json()),
      fetch('/api/workout/auth').then((r) => r.json()),
    ])
      .then(([dTypes, dAuth]) => {
        if (dTypes.success) setTypes(dTypes.types);
        if (dAuth.authenticated && dAuth.user) setUserId(dAuth.user.id);
      })
      .finally(() => setLoading(false));
  }, []);

  const resetTypeEditor = () => {
    setAddingType(false);
    setEditingTypeId(null);
    setNewType(EMPTY_TYPE);
  };

  const handleSave = async () => {
    if (!newType.name) return;

    let data: any;
    if (newType.id) {
      const res = await fetch('/api/workout/types', { method: 'PUT', body: JSON.stringify(newType) });
      data = await res.json();
      if (data.success) {
        setTypes(types.map((type) => (type.id === data.type.id ? data.type : type)));
      }
    } else {
      const res = await fetch('/api/workout/types', { method: 'POST', body: JSON.stringify(newType) });
      data = await res.json();
      if (data.success) {
        setTypes([...types, data.type]);
      }
    }

    if (data?.success) {
      resetTypeEditor();
    }
  };

  const setTypeFormRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) typeFormRefs.current.set(key, el);
    else typeFormRefs.current.delete(key);
  };

  useEffect(() => {
    if (!addingType) return;
    const key = editingTypeId ?? 'new';
    const el = typeFormRefs.current.get(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [addingType, editingTypeId]);

  const handleDelete = (id: string) => {
    setSystemPopup({
      title: 'Delete Workout Type',
      message: 'Delete this workout type?',
      onConfirm: async () => {
        if (editingTypeId === id) resetTypeEditor();
        const res = await fetch(`/api/workout/types?id=${id}`, { method: 'DELETE' });
        if ((await res.json()).success) {
          setTypes(types.filter((type) => type.id !== id));
        }
        setSystemPopup(null);
      },
    });
  };

  const handleImport = (typeToImport: WorkoutType) => {
    setSystemPopup({
      title: 'Import Template',
      message: `Import template "${typeToImport.name}"?`,
      onConfirm: async () => {
        const res = await fetch('/api/workout/types', {
          method: 'POST',
          body: JSON.stringify({
            ...typeToImport,
            id: undefined,
            name: `${typeToImport.name} (Copy)`,
            isPublic: false,
          }),
        });
        const data = await res.json();
        if (data.success) setTypes([...types, data.type]);
        setSystemPopup(null);
      },
    });
  };

  const allMuscles = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];

  const handleMuscleToggle = (muscle: string) => {
    const current = newType.muscles || [];
    if (current.includes(muscle)) {
      setNewType({ ...newType, muscles: current.filter((entry) => entry !== muscle) });
    } else {
      setNewType({ ...newType, muscles: [...current, muscle] });
    }
  };

  if (loading) return <div style={{ padding: '1.5rem' }}>Loading Types...</div>;

  const myTypes = types.filter((type) => type.ownerId === userId);
  const otherTypes = types.filter((type) => type.ownerId !== userId);

  const renderTypeEditor = (inline = false, formKey = 'new') => (
    <div
      ref={setTypeFormRef(formKey)}
      className="animate-fade-in"
      style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: inline ? '1px solid var(--accent)' : '1px solid var(--accent)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
          {newType.id ? 'Editing' : 'New'}
        </span>
      </div>
      <h4 style={{ margin: '0 0 1rem 0' }}>{newType.id ? 'Edit' : 'New'} Workout Type</h4>
      <input className="workout-input" placeholder="Name (e.g. Upper Hypertrophy)" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'block', marginBottom: '0.5rem' }}>Target Muscles</label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {allMuscles.map((muscle) => {
          const active = newType.muscles?.includes(muscle);
          return (
            <button
              key={muscle}
              onClick={() => handleMuscleToggle(muscle)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '20px',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--surface-border)'}`,
                background: active ? 'rgba(var(--accent-rgb), 0.2)' : 'transparent',
                color: active ? 'white' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {muscle}
            </button>
          );
        })}
      </div>

      <label style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <span>Target Intensity (%)</span>
        <span style={{ color: 'var(--accent-light)' }}>
          {newType.intensity}% ({newType.intensity! > 80 ? 'Power' : newType.intensity! > 60 ? 'Hypertrophy' : 'Endurance'})
        </span>
      </label>
      <input
        type="range"
        min="30"
        max="100"
        step="5"
        value={newType.intensity}
        onChange={(e) => {
          const val = parseInt(e.target.value);
          let reps = [8, 12];
          let sets = 4;
          if (val >= 85) {
            reps = [3, 6];
            sets = 5;
          } else if (val <= 60) {
            reps = [12, 20];
            sets = 3;
          }
          setNewType({ ...newType, intensity: val, minReps: reps[0], maxReps: reps[1], sets });
        }}
        style={{ width: '100%', marginBottom: '1.5rem', accentColor: 'var(--accent)' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Sets Target</label>
          <input className="workout-input" type="number" value={newType.sets} onChange={(e) => setNewType({ ...newType, sets: parseInt(e.target.value) })} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Min Reps</label>
          <input className="workout-input" type="number" value={newType.minReps} onChange={(e) => setNewType({ ...newType, minReps: parseInt(e.target.value) })} />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Max Reps</label>
          <input className="workout-input" type="number" value={newType.maxReps} onChange={(e) => setNewType({ ...newType, maxReps: parseInt(e.target.value) })} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginTop: '1rem', marginBottom: '0.5rem', padding: '0.75rem', border: '1px solid var(--surface-border)', borderRadius: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={newType.isPublic === true} onChange={(e) => setNewType({ ...newType, isPublic: e.target.checked })} style={{ marginTop: '0.15rem' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Publish this workout type for others to import</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Published workout types appear in the public import list. Private workout types are visible only to you.</div>
        </div>
      </label>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="workout-btn-primary" style={{ margin: 0, flex: 1 }} onClick={handleSave}>Save</button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetTypeEditor}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1.5rem 0' }}>Your Workout Templates</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        {myTypes.map((type) => (
          <div key={type.id} style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
            <div className="workout-flex-between">
              <strong>
                {type.name}
                {addingType && editingTypeId === type.id && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
                    Editing
                  </span>
                )}
              </strong>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--accent)' }}
                  onClick={() => {
                    if (addingType && editingTypeId === type.id) {
                      resetTypeEditor();
                      return;
                    }
                    setNewType({ ...type, isPublic: type.isPublic === true });
                    setAddingType(true);
                    setEditingTypeId(type.id);
                  }}
                >
                  Edit
                </button>
                <button style={{ background: 'none', border: 'none', color: '#ff6b6b' }} onClick={() => handleDelete(type.id)}>
                  Delete
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {type.muscles.map((muscle) => (
                <span key={muscle} style={{ fontSize: '0.75rem', background: 'var(--surface-glass)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--accent)' }}>
                  {muscle}
                </span>
              ))}
            </div>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Target: {type.sets} Sets • {type.minReps}-{type.maxReps} Reps (Intensity: {type.intensity}%)
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>{type.isPublic ? 'Published' : 'Private'}</p>

            {addingType && editingTypeId === type.id && (
              <div style={{ marginTop: '0.75rem' }}>{renderTypeEditor(true, type.id)}</div>
            )}
          </div>
        ))}
        {myTypes.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>No templates created yet.</p>}
      </div>

      {!addingType && (
        <button
          className="workout-btn-primary"
          onClick={() => {
            setNewType(EMPTY_TYPE);
            setAddingType(true);
            setEditingTypeId(null);
          }}
        >
          + Create Template
        </button>
      )}
      {addingType && editingTypeId === null && renderTypeEditor(false, 'new')}

      {otherTypes.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>Import Public Templates</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {otherTypes.map((type) => (
              <div key={type.id} className="workout-flex-between" style={{ padding: '0.75rem 1rem', background: 'var(--input-bg)', borderRadius: '12px' }}>
                <span>
                  {type.name} <small style={{ color: 'var(--muted)' }}>({type.intensity}%)</small>
                </span>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => handleImport(type)}>
                  Import
                </button>
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
