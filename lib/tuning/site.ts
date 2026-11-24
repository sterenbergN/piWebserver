import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';

// Site-wide values the features tune around, in .data/tuning.json. Each person's own
// values adjust themselves (quick math levels, chess puzzle difficulty); these are the
// starting points for everyone, and the puzzle top-up rules. They only change when the
// admin accepts a suggestion (Admin › Tuning), and every change is logged.

export type RefillRules = { threshold: number; window: number; count: number; cooldownMinutes: number };

export type SiteTuning = {
  /** Right answers in a row to go up a level, for someone who hasn't been tuned yet. */
  mathStreakUp: number;
  /** How far below someone's Elo puzzles are aimed, before it's tuned to them. */
  chessAimOffset: number;
  refill: RefillRules;
  /** Suggestions the admin turned down, by id with the value suggested, so they don't come back unchanged. */
  dismissed: Record<string, string>;
  log: { at: string; what: string; from: string; to: string }[];
};

export const DEFAULT_TUNING: SiteTuning = {
  mathStreakUp: 3,
  chessAimOffset: 50,
  refill: { threshold: 15, window: 150, count: 120, cooldownMinutes: 10 },
  dismissed: {},
  log: [],
};

const file = () => path.join(process.cwd(), '.data', 'tuning.json');
const int = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : fallback);

export function normalizeTuning(raw: unknown): SiteTuning {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SiteTuning>;
  const refill = (r.refill && typeof r.refill === 'object' ? r.refill : {}) as Partial<RefillRules>;
  const d = DEFAULT_TUNING;
  return {
    mathStreakUp: int(r.mathStreakUp, 2, 5, d.mathStreakUp),
    chessAimOffset: int(r.chessAimOffset, -100, 250, d.chessAimOffset),
    refill: {
      threshold: int(refill.threshold, 5, 100, d.refill.threshold),
      window: int(refill.window, 50, 400, d.refill.window),
      count: int(refill.count, 25, 500, d.refill.count),
      cooldownMinutes: int(refill.cooldownMinutes, 1, 240, d.refill.cooldownMinutes),
    },
    dismissed: r.dismissed && typeof r.dismissed === 'object' ? Object.fromEntries(Object.entries(r.dismissed).filter(([, v]) => typeof v === 'string').slice(0, 50)) as Record<string, string> : {},
    log: Array.isArray(r.log) ? r.log.filter((e) => e && typeof e.at === 'string' && typeof e.what === 'string').slice(-30) : [],
  };
}

let cached: { at: number; value: SiteTuning } | null = null;

/** The current values (cached for a minute; they change rarely). */
export async function getSiteTuning(): Promise<SiteTuning> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = normalizeTuning(await readJson(file(), DEFAULT_TUNING).catch(() => DEFAULT_TUNING));
  cached = { at: Date.now(), value };
  return value;
}

export async function updateSiteTuning(change: (t: SiteTuning) => void): Promise<SiteTuning> {
  const next = await updateJson<SiteTuning, SiteTuning>(file(), DEFAULT_TUNING, (stored) => {
    const t = normalizeTuning(stored);
    change(t);
    Object.assign(stored, normalizeTuning(t));
    return normalizeTuning(t);
  });
  cached = { at: Date.now(), value: next };
  return next;
}
