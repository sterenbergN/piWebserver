import { newRecordId } from './stations';
import type { Gym, Lift, Station } from './types';

// "Your equipment": stations you've already set up in other gyms, reused as
// starting points in a new gym (same machine, usually different weights).

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const stationKey = (s: Pick<Station, 'name' | 'type'>) => `${norm(s.name)}|${s.type}`;

/**
 * One entry per kind of station across the given gyms (same name + type),
 * keeping the version with the most lifts. Stations already in `exclude`
 * (e.g. the gym being edited) are left out.
 */
export function equipmentLibrary(gyms: Gym[], exclude?: Gym | null): Station[] {
  const taken = new Set((exclude?.stations || []).map(stationKey));
  const best = new Map<string, Station>();
  for (const gym of gyms) {
    if (exclude && gym.id === exclude.id) continue;
    for (const station of gym.stations || []) {
      const key = stationKey(station);
      if (taken.has(key)) continue;
      const current = best.get(key);
      if (!current || (station.lifts?.length || 0) > (current.lifts?.length || 0)) best.set(key, station);
    }
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A fresh copy of a station (new ids) with the chosen lifts (all by default). */
export function copyStation(station: Station, liftIds?: string[]): Station {
  const keep = liftIds ? new Set(liftIds) : null;
  return {
    ...station,
    id: newRecordId(),
    lifts: (station.lifts || []).filter((l) => !keep || keep.has(l.id)).map((l): Lift => ({ ...l, id: newRecordId() })),
  };
}

/** Copy every station of a gym, for starting a new gym from an existing one. */
export function copyStations(stations: Station[]): Station[] {
  return stations.map((s) => copyStation(s));
}
