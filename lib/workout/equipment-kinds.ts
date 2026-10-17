import { areLiftKeysSimilar, normalizeLiftKey } from './calibration-utils';
import { getPossibleWeights } from './equipment';
import { looseNameKey } from './exercise-admin';
import { exerciseKey, exerciseKeyFromName, exerciseName } from './exercises';
import { describeStationWeights } from './station-summary';
import type { Gym, Station, StationType } from './types';

// "My equipment": the machines you use, wherever you use them. A station is
// one machine in one gym, with that gym's weights; its *kind* is which machine
// it is ("Row Machine"), so the same machine at two gyms can be seen and
// managed together. By default a station's kind is its own name;
// `station.kind` overrides that, which links "Machine Row" here to the
// "Row Machine" elsewhere. Linking never merges the stations themselves.

type KindNamed = { name?: string; kind?: string } | null | undefined;

/** The machine kind a station counts as. */
export function kindName(station: KindNamed): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return text(station?.kind) || text(station?.name);
}

/** Comparison key for a kind name: case, spacing and punctuation don't matter. */
export const kindKeyFromName = exerciseKeyFromName;

export function kindKey(station: KindNamed): string {
  return kindKeyFromName(kindName(station));
}

/** One gym's copy of a machine. */
export type KindCopy = {
  gymId: string;
  gymName: string;
  stationId: string;
  stationName: string;
  stationType: StationType;
  /** e.g. "10–200 lb by 10" (see describeStationWeights). */
  weights: string;
  /** Lightest and heaviest setting, for comparing machines. */
  range: [number, number] | null;
  liftCount: number;
  /** Exercise names of its lifts. */
  exercises: string[];
};

export type MachineKind = { key: string; name: string; copies: KindCopy[] };

/** Every machine kind across the given gyms (pass only your own), A–Z. */
export function machineKindLibrary(gyms: Gym[]): MachineKind[] {
  const byKey = new Map<string, MachineKind>();
  for (const gym of gyms) {
    for (const station of gym.stations || []) {
      const key = kindKey(station);
      if (!key) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, name: kindName(station), copies: [] };
        byKey.set(key, entry);
      }
      const weights = getPossibleWeights(station);
      entry.copies.push({
        gymId: gym.id,
        gymName: gym.name,
        stationId: station.id,
        stationName: station.name,
        stationType: station.type,
        weights: describeStationWeights(station),
        range: weights.length ? [weights[0], weights[weights.length - 1]] : null,
        liftCount: station.lifts?.length || 0,
        exercises: [...new Set((station.lifts || []).map(exerciseName).filter(Boolean))],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Station id → kind key, for matching machines across gyms. */
export function stationKindIndex(gyms: Pick<Gym, 'stations'>[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const gym of gyms) for (const station of gym.stations || []) index.set(station.id, kindKey(station));
  return index;
}

// ─── Possible matches ─────────────────────────────────────────────────────────

/** Words that don't change which machine it is ("Row Machine" = "Machine Row"). */
const STATION_FILLER = new Set(['machine', 'station', 'plate', 'loaded', 'pin', 'selectorized', 'selector']);

export const machineNameKey = (name: string) => looseNameKey(name, STATION_FILLER);

/** Order-independent id of a pair of kinds, for remembering "Not the same". */
export const kindPairKey = (a: string, b: string) => [a, b].sort().join('|');

export type KindMatch = {
  pair: string;
  a: MachineKind;
  b: MachineKind;
  /** Their names say the same thing (word order, plurals, "machine" aside). */
  sameName: boolean;
  /** Exercises done on both. */
  sharedExercises: string[];
  score: number;
};

/** How much two weight ranges overlap, 0–1. */
function rangeOverlap(a: [number, number] | null, b: [number, number] | null) {
  if (!a || !b) return 0;
  const span = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  if (span <= 0) return 1;
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / span;
}

/**
 * Pairs of your machine kinds that are probably the same machine at different
 * gyms: the same type of equipment, and either names that match loosely or at
 * least one exercise in common. Kinds that are both in one gym are different
 * machines. Similar weight ranges rank a match higher. `dismissed` holds
 * kindPairKey()s you said were not the same.
 */
export function suggestKindMatches(kinds: MachineKind[], dismissed: Iterable<string> = []): KindMatch[] {
  const skip = new Set(dismissed);
  const matches: KindMatch[] = [];
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const a = kinds[i];
      const b = kinds[j];
      const pair = kindPairKey(a.key, b.key);
      if (skip.has(pair)) continue;
      const gymsA = new Set(a.copies.map((c) => c.gymId));
      if (b.copies.some((c) => gymsA.has(c.gymId))) continue;
      // Copies of the same type, the closest weights first.
      const sameType = a.copies.flatMap((ca) => b.copies.filter((cb) => cb.stationType === ca.stationType).map((cb) => rangeOverlap(ca.range, cb.range)));
      if (sameType.length === 0) continue;

      const names = (k: MachineKind) => new Set([k.name, ...k.copies.map((c) => c.stationName)].map(machineNameKey).filter(Boolean));
      const namesB = names(b);
      const sameName = [...names(a)].some((n) => namesB.has(n));
      const exercisesB = new Map(b.copies.flatMap((c) => c.exercises).map((e) => [exerciseKeyFromName(e), e]));
      const sharedExercises = [...new Map(a.copies.flatMap((c) => c.exercises).filter((e) => exercisesB.has(exerciseKeyFromName(e))).map((e) => [exerciseKeyFromName(e), e])).values()];
      if (!sameName && sharedExercises.length === 0) continue;

      const score = (sameName ? 10 : 0) + 3 * Math.min(sharedExercises.length, 3) + 2 * Math.max(...sameType);
      matches.push({ pair, a, b, sameName, sharedExercises, score });
    }
  }
  return matches.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
}

// ─── Link / rename / unlink ───────────────────────────────────────────────────
// Pure data transforms used by app/api/workout/equipment.

type StationLike = { id?: string; name: string; kind?: string };
type GymLike = { id?: string; name?: string; stations?: StationLike[] };

/**
 * Point every station of one of `fromKeys` at kind `to`. With `renameStations`
 * (rename everywhere), stations named after the old kind take the new name;
 * otherwise (linking) every station keeps its own name. Returns how many changed.
 */
export function setKindInGyms(gyms: GymLike[], fromKeys: Set<string>, to: string, { renameStations = false } = {}) {
  const toKey = kindKeyFromName(to);
  let changed = 0;
  for (const gym of gyms) {
    for (const station of gym.stations || []) {
      if (!fromKeys.has(kindKey(station))) continue;
      if (renameStations && fromKeys.has(kindKeyFromName(station.name))) station.name = to;
      if (kindKeyFromName(station.name) === toKey) delete station.kind;
      else station.kind = to;
      changed++;
    }
  }
  return changed;
}

/**
 * Take one station out of its kind. A station named after something else just
 * becomes its own kind again; one named after the kind it's in gets a kind of
 * its own, "<name> (<gym>)", so the other copies stay linked. Returns the old
 * and new kind keys (to remember the pair as not the same), or null.
 */
export function unlinkStation(gyms: GymLike[], gymId: string, stationId: string): { from: string; to: string } | null {
  const gym = gyms.find((g) => g.id === gymId);
  const station = gym?.stations?.find((s) => s.id === stationId);
  if (!gym || !station) return null;
  const from = kindKey(station);
  if (kindKeyFromName(station.name) !== from) delete station.kind;
  else station.kind = `${station.name} (${gym.name || 'this gym'})`.slice(0, 120);
  const to = kindKey(station);
  return to === from ? null : { from, to };
}

/** Remembered "Not the same" pairs after kinds were renamed or linked into `toKey`. */
export function renameDismissedPairs(pairs: string[], fromKeys: Set<string>, toKey: string): string[] {
  const out = new Set<string>();
  for (const pair of pairs) {
    const [a, b] = pair.split('|').map((k) => (fromKeys.has(k) ? toKey : k));
    if (a && b && a !== b) out.add(kindPairKey(a, b));
  }
  return [...out];
}

// ─── Lifts on linked machines ─────────────────────────────────────────────────

export type LiftLinkSuggestion = { keep: string; other: string };

/**
 * After linking two machines: lifts on them that look like the same exercise
 * under different names ("Machine Row" / "Seated Row"), to merge so their
 * history combines. `keep` is the name on the kind you kept. Exercises already
 * on both are linked. If each side has one exercise left, they're paired.
 */
export function liftLinkSuggestions(kept: Pick<Station, 'lifts'>[], linked: Pick<Station, 'lifts'>[]): LiftLinkSuggestion[] {
  const exercises = (stations: Pick<Station, 'lifts'>[]) => {
    const byKey = new Map<string, string>();
    for (const station of stations) for (const lift of station.lifts || []) if (exerciseKey(lift)) byKey.set(exerciseKey(lift), exerciseName(lift));
    return byKey;
  };
  const keepSide = exercises(kept);
  const otherSide = exercises(linked);
  for (const key of [...keepSide.keys()]) {
    if (otherSide.has(key)) {
      keepSide.delete(key);
      otherSide.delete(key);
    }
  }
  const suggestions: LiftLinkSuggestion[] = [];
  const looksSame = (a: string, b: string) => looseNameKey(a) === looseNameKey(b) || areLiftKeysSimilar(normalizeLiftKey(a), normalizeLiftKey(b));
  for (const [otherKey, other] of otherSide) {
    const match = [...keepSide].find(([, keep]) => looksSame(keep, other));
    if (!match) continue;
    suggestions.push({ keep: match[1], other });
    keepSide.delete(match[0]);
    otherSide.delete(otherKey);
  }
  if (keepSide.size === 1 && otherSide.size === 1) suggestions.push({ keep: [...keepSide.values()][0], other: [...otherSide.values()][0] });
  return suggestions;
}
