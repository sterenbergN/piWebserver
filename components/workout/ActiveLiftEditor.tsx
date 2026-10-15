'use client';

import { useEffect, useState } from 'react';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { upsertLift } from '@/lib/workout/stations';
import { exerciseLibrary, type Exercise } from '@/lib/workout/exercises';
import Sheet from './Sheet';
import LiftForm from './LiftForm';
import StationForm from './StationForm';

type ActiveLiftEditorProps = {
  /** 'lift' edits the lift's details; 'station' edits its equipment (weights and lifts). */
  mode: 'lift' | 'station';
  stationId: string;
  liftId: string;
  /** Called with the saved gym so the workout can pick up the changes. */
  onSaved: (gym: Gym) => void;
  onClose: () => void;
};

/**
 * Edit the lift you're on, or its machine, without leaving the workout.
 * Changes are saved to the gym, so they're there next time too.
 */
export default function ActiveLiftEditor({ mode, stationId, liftId, onSaved, onClose }: ActiveLiftEditorProps) {
  const [gym, setGym] = useState<Gym | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/workout/gyms')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error(d.message === 'Unauthorized' ? 'Log in to edit equipment.' : d.message);
        const owner = (d.gyms as Gym[]).find((g) => g.stations.some((s) => s.id === stationId));
        setExercises(exerciseLibrary(d.gyms));
        if (owner) setGym(owner);
        else setError('This equipment isn’t in one of your gyms, so it can’t be edited here.');
      })
      .catch((err) => setError(err instanceof Error && err.message ? err.message : 'Could not load the equipment.'));
  }, [stationId]);

  const station = gym?.stations.find((s) => s.id === stationId);
  const lift = station?.lifts.find((l) => l.id === liftId);

  const saveStations = async (stations: Station[]) => {
    if (!gym) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/workout/gyms', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...gym, stations }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.message || 'Could not save');
      onSaved(d.gym);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  };

  if (!gym || !station || (mode === 'lift' && !lift)) {
    const missing = gym && (!station ? 'This equipment was removed from the gym.' : 'This lift was removed from its equipment.');
    return (
      <Sheet title="Edit" onClose={onClose}>
        {error || missing
          ? <p className="workout-error">{error || missing}</p>
          : <p className="workout-hint">Loading…</p>}
      </Sheet>
    );
  }

  const saveLift = (next: Lift) => saveStations(gym.stations.map((s) => (s.id === station.id ? upsertLift(s, next) : s)));
  const saveStation = (next: Station) => saveStations(gym.stations.map((s) => (s.id === next.id ? next : s)));

  return (
    <>
      {mode === 'lift'
        ? <LiftForm station={station} initial={lift} saving={saving} onSave={saveLift} onCancel={onClose} exercises={exercises} />
        : <StationForm initial={station} saving={saving} onSave={saveStation} onCancel={onClose} exercises={exercises} />}
      {error && <div className="tracker-toast is-error" role="alert">{error}</div>}
    </>
  );
}
