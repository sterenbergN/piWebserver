'use client';

import { useState, useEffect } from 'react';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { equipmentLibrary } from '@/lib/workout/equipment-library';
import GymStations, { type WeightsCheck } from '@/components/workout/GymStations';

interface InlineGymEditorProps {
  gymId: string;
  onGymUpdated: (gym: Gym) => void;
  onClose: () => void;
  onAddLiftToWorkout?: (lift: Lift, station: Station) => void;
}

/** The gym's equipment editor, shown inside an active workout. */
export default function InlineGymEditor({ gymId, onGymUpdated, onAddLiftToWorkout }: InlineGymEditorProps) {
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [weightsCheck, setWeightsCheck] = useState<WeightsCheck | null>(null);

  useEffect(() => {
    // scope=all so equipment from your other (and published) gyms can be reused.
    fetch('/api/workout/gyms?scope=all')
      .then(r => r.json())
      .then(d => { if (d.success) setGyms(d.gyms); else setError(d.message || 'Could not load equipment.'); })
      .catch(() => setError('Could not load equipment.'));
  }, []);

  const gym = gyms?.find(g => g.id === gymId) || null;

  const saveStations = async (stations: Station[]) => {
    if (!gym) return false;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workout/gyms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...gym, stations }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      setGyms(prev => (prev || []).map(g => (g.id === d.gym.id ? d.gym : g)));
      onGymUpdated(d.gym);
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save changes.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!gyms && !error) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading equipment…</div>;
  }

  if (!gym) {
    return (
      <div className="workout-error" style={{ textAlign: 'center', padding: '2rem' }}>
        {error || 'Gym not found. Equipment can only be edited for your own gyms.'}
      </div>
    );
  }

  return (
    <div>
      <p className="workout-hint" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
        {gym.emoji} <strong>{gym.name}</strong> — tap equipment to see its lifts
      </p>
      {error && <p className="workout-error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
      <GymStations
        gym={gym}
        library={equipmentLibrary(gyms || [], gym)}
        saving={saving}
        saveStations={saveStations}
        weightsCheck={weightsCheck}
        setWeightsCheck={setWeightsCheck}
        onAddLiftToWorkout={onAddLiftToWorkout}
      />
    </div>
  );
}
