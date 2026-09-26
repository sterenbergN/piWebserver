import { EMPTY_LIFT, isLoadStation, type Lift, type Station, type StationType } from './types';

export function newRecordId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 12);
}

/** Parse a comma-separated list of weights like "45, 25, 2.5". */
export function parseWeightList(value: string, { positiveOnly = false } = {}): number[] {
  return value
    .split(',')
    .map((part) => parseFloat(part.trim()))
    .filter((n) => Number.isFinite(n) && (positiveOnly ? n > 0 : n >= 0));
}

export function formatWeightList(values: number[] | undefined) {
  return (values || []).join(', ');
}

/** The comma-separated text fields a station form edits. */
export type StationListFields = {
  plates: string;
  dumbbells: string;
  bodyWeight: string;
  additionalWeights: string;
};

export function listFieldsFromStation(station: Partial<Station> | undefined): StationListFields {
  return {
    plates: formatWeightList(station?.plateSets),
    dumbbells: formatWeightList(station?.dumbbellPairs),
    bodyWeight: formatWeightList(station?.bodyWeightAdditions),
    // Show the legacy single add-on too so saving migrates it to the list.
    additionalWeights: formatWeightList(
      station?.additionalWeights?.length
        ? station.additionalWeights
        : station?.additionalWeight ? [station.additionalWeight] : []
    ),
  };
}

/**
 * Build the station to save from form state: parse list fields, drop settings
 * that don't apply to the chosen type, and keep lifts consistent with it.
 */
export function finalizeStation(draft: Partial<Station>, lists: StationListFields): Station {
  const type: StationType = draft.type || 'plates';
  const station: Station = {
    ...draft,
    id: draft.id || newRecordId(),
    name: (draft.name || '').trim(),
    type,
    lifts: draft.lifts || [],
    attachments: type === 'cable' ? draft.attachments || [] : [],
    baseWeight: type === 'plates' ? draft.baseWeight : undefined,
    plateSets: type === 'plates' ? parseWeightList(lists.plates, { positiveOnly: true }) : undefined,
    minWeight: isLoadStation(type) ? draft.minWeight : undefined,
    maxWeight: isLoadStation(type) ? draft.maxWeight : undefined,
    increment: isLoadStation(type) ? draft.increment : undefined,
    additionalWeights: isLoadStation(type) ? parseWeightList(lists.additionalWeights, { positiveOnly: true }) : undefined,
    additionalWeight: undefined, // migrated into additionalWeights
    dumbbellPairs: type === 'dumbbells' ? parseWeightList(lists.dumbbells, { positiveOnly: true }) : undefined,
    bodyWeightAdditions: type === 'bodyweight' ? parseWeightList(lists.bodyWeight, { positiveOnly: true }) : undefined,
  };

  // Attachments only exist on cable stations; drop ones that were removed.
  station.lifts = station.lifts.map((lift) => ({
    ...lift,
    attachment: type === 'cable' && lift.attachment && station.attachments!.includes(lift.attachment)
      ? lift.attachment
      : undefined,
  }));

  return station;
}

/** Build the lift to save from form state, keeping every field (incl. attachment). */
export function finalizeLift(draft: Partial<Lift>): Lift {
  return {
    ...EMPTY_LIFT,
    ...draft,
    id: draft.id || newRecordId(),
    name: (draft.name || '').trim(),
    singleArmLeg: draft.singleArmLeg === true,
    primaryMuscle: draft.primaryMuscle || 'Chest',
    secondaryMuscle: draft.secondaryMuscle || 'None',
    progressionProfile: draft.progressionProfile || 'standard',
    attachment: draft.attachment || undefined,
    notes: draft.notes?.trim().slice(0, 200) || undefined,
  };
}

/** Insert or replace a lift within a station. */
export function upsertLift(station: Station, lift: Lift): Station {
  const exists = station.lifts.some((l) => l.id === lift.id);
  return {
    ...station,
    lifts: exists ? station.lifts.map((l) => (l.id === lift.id ? lift : l)) : [...station.lifts, lift],
  };
}
