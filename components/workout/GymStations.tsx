'use client';

import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { upsertLift } from '@/lib/workout/stations';
import { GYM_TEMPLATES, stationFromPreset, stationsFromTemplate, type EquipmentPreset } from '@/lib/workout/catalog';
import { copyStation } from '@/lib/workout/equipment-library';
import { STATION_TYPE_META, describeStationWeights } from '@/lib/workout/station-summary';
import StationForm from './StationForm';
import LiftForm, { describeLift } from './LiftForm';
import EquipmentPicker, { type PickedEquipment } from './EquipmentPicker';
import QuickAddLifts from './QuickAddLifts';
import StationWeightsEditor from './StationWeightsEditor';

/** "Check the weights" sheet; `onlyIds` limits it to just-added stations. */
export type WeightsCheck = { intro?: string; onlyIds?: string[] };

/** Which sheet is open. */
type Target =
  | { kind: 'pick-equipment' }
  | { kind: 'station'; stationId: string | 'new'; preset?: EquipmentPreset; copyFrom?: Station }
  | { kind: 'quick-lifts'; stationId: string }
  | { kind: 'lift'; stationId: string; liftId: string | 'new' }
  | null;

type GymStationsProps = {
  gym: Gym;
  /** Stations from your other gyms, offered when adding equipment. */
  library?: Station[];
  saving?: boolean;
  /** Save the gym's full station list; resolve true on success so the open sheet can close. */
  saveStations: (stations: Station[]) => Promise<boolean>;
  weightsCheck: WeightsCheck | null;
  setWeightsCheck: (check: WeightsCheck | null) => void;
  /** In a workout: show "+ Workout" on each lift. */
  onAddLiftToWorkout?: (lift: Lift, station: Station) => void;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A gym's equipment as tappable cards (tap to see its lifts), with sheets for
 * adding/editing equipment and lifts. Shared by the gym settings page and the
 * "manage equipment" panel inside a workout.
 */
export default function GymStations({ gym, library = [], saving = false, saveStations, weightsCheck, setWeightsCheck, onAddLiftToWorkout }: GymStationsProps) {
  const { confirm, popup } = useSitePopup();
  const [target, setTarget] = useState<Target>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(gym.stations.length <= 2 ? gym.stations.map((s) => s.id) : []));

  const toggleOpen = (id: string, force?: boolean) => setOpen((prev) => {
    const next = new Set(prev);
    if (force ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  });
  const save = async (stations: Station[], after?: () => void) => {
    if (await saveStations(stations)) { setTarget(null); after?.(); }
  };
  const findStation = (id: string) => gym.stations.find((s) => s.id === id);

  const saveStation = (station: Station) => {
    const exists = gym.stations.some((s) => s.id === station.id);
    save(exists ? gym.stations.map((s) => (s.id === station.id ? station : s)) : [...gym.stations, station], () => toggleOpen(station.id, true));
  };
  const deleteStation = async (station: Station) => {
    const ok = await confirm({ title: 'Delete equipment', message: `Delete ${station.name}${station.lifts.length ? ` and its ${plural(station.lifts.length, 'lift')}` : ''}? Past workouts keep their history.`, confirmLabel: 'Delete', danger: true });
    if (ok) save(gym.stations.filter((s) => s.id !== station.id));
  };
  const saveLift = (station: Station, lift: Lift) => save(gym.stations.map((s) => (s.id === station.id ? upsertLift(s, lift) : s)));
  const addLifts = (station: Station, lifts: Lift[]) => {
    if (lifts.length) save(gym.stations.map((s) => (s.id === station.id ? { ...s, lifts: [...s.lifts, ...lifts] } : s)));
  };
  const deleteLift = async (station: Station, lift: Lift) => {
    const ok = await confirm({ title: 'Delete lift', message: `Delete ${lift.name} from ${station.name}?`, confirmLabel: 'Delete', danger: true });
    if (ok) save(gym.stations.map((s) => (s.id === station.id ? { ...s, lifts: s.lifts.filter((l) => l.id !== lift.id) } : s)));
  };

  /** Several pieces at once from the picker, then offer to check their weights. */
  const addMany = (items: PickedEquipment[]) => {
    const added = items.map((item) => ('preset' in item ? stationFromPreset(item.preset) : copyStation(item.station)));
    save([...gym.stations, ...added], () => {
      setWeightsCheck({ intro: `Added ${plural(added.length, 'item')} with typical weights. Change anything that’s different at this gym.`, onlyIds: added.map((s) => s.id) });
    });
  };

  const applyTemplate = async (key: string) => {
    const stations = stationsFromTemplate(key, gym.stations);
    const lifts = stations.reduce((n, st) => n + st.lifts.length, 0);
    const ok = await confirm({ title: 'Add starter equipment', message: `Add ${plural(stations.length, 'piece')} of equipment with ${plural(lifts, 'lift')}? You’ll check the weights next.`, confirmLabel: 'Add' });
    if (ok) save([...gym.stations, ...stations], () => setWeightsCheck({ intro: 'Typical weights are filled in. Change anything that differs and untick what this gym doesn’t have.', onlyIds: stations.map((s) => s.id) }));
  };

  const saveWeights = (edited: Station[]) => {
    const only = weightsCheck?.onlyIds ? new Set(weightsCheck.onlyIds) : null;
    const byId = new Map(edited.map((s) => [s.id, s]));
    // Stations outside the check stay as they are; checked ones are replaced or dropped.
    const next = gym.stations.flatMap((s) => (only && !only.has(s.id) ? [s] : byId.has(s.id) ? [byId.get(s.id)!] : []));
    saveStations(next).then((ok) => { if (ok) setWeightsCheck(null); });
  };

  const targetStation = target && target.kind !== 'pick-equipment' && target.stationId !== 'new' ? findStation(target.stationId) : undefined;

  return (
    <>
      {gym.stations.length === 0 ? (
        <div className="workout-tile" style={{ marginBottom: '1rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Set up this gym in one tap</strong>
          <p className="workout-hint" style={{ margin: '0 0 0.75rem' }}>Pick what it&apos;s most like. Everything comes with typical weights and lifts, and you&apos;ll check the weights straight after.</p>
          <div className="workout-stack">
            {GYM_TEMPLATES.map((t) => (
              <button key={t.key} className="workout-choice is-row" disabled={saving} onClick={() => applyTemplate(t.key)}>
                <span aria-hidden>{t.key === 'home' ? '🏠' : t.key === 'hotel' ? '🧳' : '🏢'}</span>
                <span className="workout-card-text">
                  <span className="workout-card-title">{t.name}</span>
                  <small style={{ display: 'block' }}>{t.description}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="workout-hint" style={{ margin: '0.75rem 0 0', textAlign: 'center' }}>…or add equipment piece by piece below.</p>
        </div>
      ) : (
        <div className="workout-stack is-loose" style={{ marginBottom: '1rem' }}>
          {gym.stations.map((st) => {
            const isOpen = open.has(st.id);
            const meta = STATION_TYPE_META[st.type];
            return (
              <div key={st.id} className={`workout-station${isOpen ? ' is-open' : ''}`}>
                <button type="button" className="workout-station-head" aria-expanded={isOpen} onClick={() => toggleOpen(st.id)}>
                  <span className="workout-avatar is-small" aria-hidden title={meta?.label}>{meta?.icon}</span>
                  <span className="workout-card-text">
                    <span className="workout-card-title">{st.name}</span>
                    <span className="workout-card-meta">{describeStationWeights(st)}</span>
                    <span className="workout-card-meta">{st.lifts.length ? plural(st.lifts.length, 'lift') : 'No lifts yet'}{st.attachments?.length ? ` · ${st.attachments.join(', ')}` : ''}</span>
                  </span>
                  <span className={`workout-chevron${isOpen ? ' is-open' : ''}`} aria-hidden>›</span>
                </button>

                {isOpen && (
                  <div className="workout-station-body">
                    {st.lifts.length > 0 ? (
                      <div className="workout-stack" style={{ marginBottom: '0.6rem' }}>
                        {st.lifts.map((l) => (
                          <div key={l.id} style={{ display: 'flex', gap: '0.4rem' }}>
                            <button type="button" className="workout-lift-row" onClick={() => setTarget({ kind: 'lift', stationId: st.id, liftId: l.id })}>
                              <span className="workout-card-text">
                                <span className="workout-card-title">{l.name}</span>
                                <span className="workout-card-meta">{describeLift(l)}{l.notes ? ` · ${l.notes}` : ''}</span>
                              </span>
                              {!onAddLiftToWorkout && <span className="workout-chevron" aria-hidden>›</span>}
                            </button>
                            {onAddLiftToWorkout && (
                              <button type="button" className="workout-button is-primary is-small" style={{ flexShrink: 0, alignSelf: 'center', whiteSpace: 'nowrap' }}
                                aria-label={`Add ${l.name} to this workout`} onClick={() => onAddLiftToWorkout(l, st)}>
                                + Add
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="workout-hint" style={{ margin: '0 0 0.6rem' }}>No lifts on this yet. Add some so workouts can use it.</p>
                    )}
                    <div className="workout-grid-2">
                      <button type="button" className="workout-button is-small" onClick={() => setTarget({ kind: 'quick-lifts', stationId: st.id })}>+ Add lifts</button>
                      <button type="button" className="workout-button is-small" onClick={() => setTarget({ kind: 'station', stationId: st.id })}>Edit equipment</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className="workout-button is-dashed is-block" style={{ minHeight: 52 }} onClick={() => setTarget({ kind: 'pick-equipment' })}>
        + Add equipment
      </button>

      {target?.kind === 'pick-equipment' && (
        <EquipmentPicker
          existingNames={gym.stations.map((s) => s.name)}
          library={library}
          saving={saving}
          onAddMany={addMany}
          onPickStation={(station) => setTarget({ kind: 'station', stationId: 'new', copyFrom: station })}
          onPick={(preset) => setTarget({ kind: 'station', stationId: 'new', preset: preset || undefined })}
          onCancel={() => setTarget(null)}
        />
      )}
      {target?.kind === 'station' && target.stationId === 'new' && (
        <StationForm preset={target.preset} copyFrom={target.copyFrom} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} />
      )}
      {target?.kind === 'station' && targetStation && (
        <StationForm initial={targetStation} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} onDelete={() => deleteStation(targetStation)} />
      )}
      {target?.kind === 'quick-lifts' && targetStation && (
        <QuickAddLifts station={targetStation} saving={saving} onSave={(lifts) => addLifts(targetStation, lifts)} onCancel={() => setTarget(null)}
          onCustom={() => setTarget({ kind: 'lift', stationId: targetStation.id, liftId: 'new' })} />
      )}
      {target?.kind === 'lift' && targetStation && (() => {
        const lift = target.liftId === 'new' ? undefined : targetStation.lifts.find((l) => l.id === target.liftId);
        return (
          <LiftForm station={targetStation} initial={lift} saving={saving} onSave={(l) => saveLift(targetStation, l)} onCancel={() => setTarget(null)}
            onDelete={lift ? () => deleteLift(targetStation, lift) : undefined} />
        );
      })()}
      {weightsCheck && (
        <StationWeightsEditor
          stations={weightsCheck.onlyIds ? gym.stations.filter((s) => weightsCheck.onlyIds!.includes(s.id)) : gym.stations}
          intro={weightsCheck.intro}
          saving={saving}
          onSave={saveWeights}
          onCancel={() => setWeightsCheck(null)}
        />
      )}
      {popup}
    </>
  );
}
