import { getAdditionalWeights, getPossibleWeights } from './equipment';
import type { Station, StationType } from './types';

// Short, human descriptions of a station's equipment for cards and previews.

export const STATION_TYPE_META: Record<StationType, { icon: string; label: string; hint: string }> = {
  plates: { icon: '🏋️', label: 'Barbell', hint: 'Bar + plates' },
  stack: { icon: '🗜️', label: 'Machine', hint: 'Pin-select stack' },
  cable: { icon: '🔗', label: 'Cable', hint: 'Stack + handles' },
  dumbbells: { icon: '🔩', label: 'Dumbbells', hint: 'Fixed pairs' },
  bodyweight: { icon: '🤸', label: 'Bodyweight', hint: 'Optional belt weight' },
};

export const formatWeight = (n: number) => String(Math.round(n * 100) / 100);

/** Plates as "45×2, 25, 10" (heaviest first, repeats counted). */
export function formatPlateCounts(plates: number[] = []) {
  const counts = new Map<number, number>();
  for (const plate of [...plates].sort((a, b) => b - a)) counts.set(plate, (counts.get(plate) || 0) + 1);
  return [...counts].map(([plate, count]) => (count > 1 ? `${formatWeight(plate)}×${count}` : formatWeight(plate))).join(', ');
}

/** One line saying what a station can be loaded with. */
export function describeStationWeights(station: Partial<Station>): string {
  switch (station.type) {
    case 'plates': {
      const bar = Number.isFinite(station.baseWeight) ? Number(station.baseWeight) : 45;
      const plates = station.plateSets || [];
      return plates.length ? `${formatWeight(bar)} lb bar · ${formatPlateCounts(plates)} per side` : `${formatWeight(bar)} lb bar · no plates yet`;
    }
    case 'stack':
    case 'cable': {
      // Same fallbacks as getPossibleWeights so the card matches the tracker.
      const min = Number.isFinite(Number(station.minWeight)) && Number(station.minWeight) >= 0 ? Number(station.minWeight) : 10;
      const max = Number(station.maxWeight) > 0 ? Number(station.maxWeight) : 300;
      const step = Number(station.increment) > 0 ? Number(station.increment) : 10;
      const addOns = getAdditionalWeights(station);
      return `${formatWeight(min)}–${formatWeight(max)} lb by ${formatWeight(step)}${addOns.length ? ` · +${addOns.map(formatWeight).join('/')}` : ''}`;
    }
    case 'dumbbells': {
      const pairs = (station.dumbbellPairs || []).filter((n) => n > 0);
      if (!pairs.length) return 'No dumbbells yet';
      return `${formatWeight(Math.min(...pairs))}–${formatWeight(Math.max(...pairs))} lb · ${pairs.length} pair${pairs.length === 1 ? '' : 's'}`;
    }
    case 'bodyweight': {
      const extra = (station.bodyWeightAdditions || []).filter((n) => n > 0);
      return extra.length ? `Bodyweight · +${extra.map(formatWeight).join('/')} lb` : 'Bodyweight';
    }
    default:
      return '';
  }
}

/** "24 settings · 45–405 lb" — the weights the tracker will offer. */
export function describeWeightRange(station: Partial<Station>): string {
  const weights = getPossibleWeights(station);
  if (weights.length === 0) return 'No weights yet';
  const lo = weights[0];
  const hi = weights[weights.length - 1];
  if (weights.length === 1) return `Only ${formatWeight(lo)} lb`;
  return `${weights.length} settings · ${formatWeight(lo)}–${formatWeight(hi)} lb`;
}

/** Evenly spaced weights from `from` to `to` (inclusive), e.g. a dumbbell rack. */
export function weightRange(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !(to >= from) || from < 0) return [];
  const out: number[] = [];
  for (let w = from; w <= to + 1e-9 && out.length < 200; w += step) out.push(Math.round(w * 100) / 100);
  return out;
}
