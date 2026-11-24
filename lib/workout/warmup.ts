import type { WarmupPlan } from './types';

// Cleaning a lift's warm-up plan (types.ts WarmupPlan) when it's saved. On its own, with no
// imports but types, so stations.ts can use it without pulling in the analytics.

/** Turn whatever was stored into a warm-up plan, or nothing (the usual ramp). */
export function cleanWarmupPlan(raw: unknown): WarmupPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { kind?: unknown; sets?: unknown };
  if (r.kind === 'none' || r.kind === 'ramp') return { kind: r.kind };
  if (r.kind !== 'sets' || !Array.isArray(r.sets)) return undefined;
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.round(v * 4) / 4) : undefined);
  const sets = r.sets.slice(0, 5).flatMap((s) => {
    const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const perSide = num(x.perSide, 1000);
    const weight = num(x.weight, 2000);
    const reps = num(x.reps, 100);
    if (perSide === undefined && weight === undefined) return [];
    return [{ ...(perSide !== undefined ? { perSide } : { weight }), ...(reps !== undefined ? { reps: Math.round(reps) } : {}) }];
  });
  return sets.length ? { kind: 'sets', sets } : { kind: 'none' };
}

