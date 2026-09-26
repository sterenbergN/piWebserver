'use client';

import { useState, useEffect } from 'react';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { upsertLift } from '@/lib/workout/stations';
import StationForm from '@/components/workout/StationForm';
import LiftForm, { describeLift } from '@/components/workout/LiftForm';
import EquipmentPicker from '@/components/workout/EquipmentPicker';
import QuickAddLifts from '@/components/workout/QuickAddLifts';
import type { EquipmentPreset } from '@/lib/workout/catalog';

interface InlineGymEditorProps {
  gymId: string;
  onGymUpdated: (gym: Gym) => void;
  onClose: () => void;
  onAddLiftToWorkout?: (lift: Lift, station: Station) => void;
}

/** Which form is open: a station (existing id or 'new'), or a lift on a station. */
type EditorTarget =
  | { kind: 'pick-equipment' }
  | { kind: 'station'; stationId: string | 'new'; preset?: EquipmentPreset }
  | { kind: 'quick-lifts'; stationId: string }
  | { kind: 'lift'; stationId: string; liftId: string | 'new' }
  | null;

/** Compact gym equipment editor shown inside an active workout. */
export default function InlineGymEditor({ gymId, onGymUpdated, onAddLiftToWorkout }: InlineGymEditorProps) {
  const [gym, setGym] = useState<Gym | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<EditorTarget>(null);

  useEffect(() => {
    fetch('/api/workout/gyms')
      .then(r => r.json())
      .then(d => {
        if (d.success) setGym(d.gyms.find((g: Gym) => g.id === gymId) || null);
      })
      .catch(() => setError('Could not load equipment.'))
      .finally(() => setLoading(false));
  }, [gymId]);

  const saveGym = async (updatedGym: Gym) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workout/gyms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedGym),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setGym(d.gym);
      onGymUpdated(d.gym);
      setTarget(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const saveStation = (station: Station) => {
    if (!gym) return;
    const exists = gym.stations.some(s => s.id === station.id);
    saveGym({
      ...gym,
      stations: exists ? gym.stations.map(s => (s.id === station.id ? station : s)) : [...gym.stations, station],
    });
  };

  const saveLift = (station: Station, lift: Lift) => {
    if (!gym) return;
    saveGym({ ...gym, stations: gym.stations.map(s => (s.id === station.id ? upsertLift(s, lift) : s)) });
  };

  const addLifts = (station: Station, lifts: Lift[]) => {
    if (!gym || lifts.length === 0) return;
    saveGym({ ...gym, stations: gym.stations.map(s => (s.id === station.id ? { ...s, lifts: [...s.lifts, ...lifts] } : s)) });
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading equipment...</div>;
  }

  if (!gym) {
    return (
      <div className="workout-error" style={{ textAlign: 'center', padding: '2rem' }}>
        {error || 'Gym not found. Equipment can only be edited for your own gyms.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
        Managing equipment for: <strong>{gym.emoji} {gym.name}</strong>
      </p>
      {error && <p className="workout-error">{error}</p>}

      {gym.stations.map(station => (
        <div key={station.id} className="workout-tile" style={{ padding: '1rem', marginBottom: 0 }}>
          {target?.kind === 'station' && target.stationId === station.id ? (
            <StationForm initial={station} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>{station.name}</strong>{' '}
                  <span className="workout-pill">{station.type}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => setTarget({ kind: 'station', stationId: station.id })}>
                    Edit Equipment
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} onClick={() => setTarget({ kind: 'quick-lifts', stationId: station.id })}>
                    + Add Lifts
                  </button>
                </div>
              </div>

              {station.lifts.map(lift => (
                <div key={lift.id} style={{ marginBottom: '0.35rem' }}>
                  <div className="workout-list-row">
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{lift.name}</div>
                      <div className="workout-hint">{describeLift(lift)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', borderRadius: '8px' }} onClick={() => setTarget({ kind: 'lift', stationId: station.id, liftId: lift.id })}>
                        Edit
                      </button>
                      {onAddLiftToWorkout && (
                        <button className="workout-btn-primary" style={{ margin: 0, padding: '0.4rem 0.75rem', fontSize: '0.75rem', borderRadius: '8px', width: 'auto' }} onClick={() => onAddLiftToWorkout(lift, station)}>
                          + Workout
                        </button>
                      )}
                    </div>
                  </div>
                  {target?.kind === 'lift' && target.stationId === station.id && target.liftId === lift.id && (
                    <LiftForm station={station} initial={lift} saving={saving} onSave={(l) => saveLift(station, l)} onCancel={() => setTarget(null)} />
                  )}
                </div>
              ))}

              {target?.kind === 'lift' && target.stationId === station.id && target.liftId === 'new' && (
                <LiftForm station={station} saving={saving} onSave={(l) => saveLift(station, l)} onCancel={() => setTarget(null)} />
              )}
              {target?.kind === 'quick-lifts' && target.stationId === station.id && (
                <QuickAddLifts station={station} saving={saving} onSave={(lifts) => addLifts(station, lifts)} onCancel={() => setTarget(null)}
                  onCustom={() => setTarget({ kind: 'lift', stationId: station.id, liftId: 'new' })} />
              )}
            </>
          )}
        </div>
      ))}

      {target?.kind === 'pick-equipment' ? (
        <EquipmentPicker
          existingNames={gym.stations.map(s => s.name)}
          onPick={(preset) => setTarget({ kind: 'station', stationId: 'new', preset: preset || undefined })}
          onCancel={() => setTarget(null)}
        />
      ) : target?.kind === 'station' && target.stationId === 'new' ? (
        <StationForm preset={target.preset} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} />
      ) : (
        <button className="btn btn-secondary" style={{ width: '100%', padding: '0.85rem', borderRadius: '12px' }} onClick={() => setTarget({ kind: 'pick-equipment' })}>
          + Add Equipment Station
        </button>
      )}
    </div>
  );
}
