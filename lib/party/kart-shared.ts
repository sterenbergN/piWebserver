// Display data shared by the TV and the phones. Safe to import from client components
// (kart-physics pulls in the server-side emitter, so only its types may be imported there).

export type KartItemType =
  | 'mushroom'
  | 'green_shell'
  | 'red_shell'
  | 'banana'
  | 'lightning'
  | 'star'
  | 'spiny_shell'
  | 'golden_mushroom'
  | 'super_horn'
  | 'fake_box';

export type KartStyle = 'classic' | 'rocket' | 'bruiser' | 'cyber';
export type KartSpeedClass = '50cc' | '100cc' | '150cc' | '200cc';
export type KartItemsMode = 'normal' | 'frantic' | 'shells-only' | 'pure';

export const ITEM_META: Record<KartItemType, { emoji: string; name: string; color: string; hint: string }> = {
  mushroom: { emoji: '🍄', name: 'Mushroom', color: '#ef4444', hint: 'Instant speed burst' },
  green_shell: { emoji: '🟢', name: 'Green Shell', color: '#22c55e', hint: 'Fires straight, bounces off walls' },
  red_shell: { emoji: '🔴', name: 'Red Shell', color: '#f97316', hint: 'Homes in on the racer ahead' },
  banana: { emoji: '🍌', name: 'Banana', color: '#facc15', hint: 'Drops behind you' },
  lightning: { emoji: '⚡', name: 'Lightning', color: '#38bdf8', hint: 'Zaps and shrinks every rival' },
  star: { emoji: '⭐', name: 'Super Star', color: '#fbbf24', hint: 'Invincible and fast' },
  spiny_shell: { emoji: '🔵', name: 'Blue Shell', color: '#0284c7', hint: 'Hunts down 1st place' },
  golden_mushroom: { emoji: '✨', name: 'Golden Mushroom', color: '#eab308', hint: 'Tap again and again for turbo' },
  super_horn: { emoji: '📯', name: 'Super Horn', color: '#a855f7', hint: 'Blasts nearby karts and shells' },
  fake_box: { emoji: '❓', name: 'Fake Box', color: '#ef4444', hint: 'Drops a booby-trapped box' },
};

export const ROULETTE_EMOJIS = Object.values(ITEM_META).map((m) => m.emoji);

/**
 * Chassis trade-offs. The multipliers are deliberately small: they should change how a
 * kart feels, not decide the race.
 */
export const KART_STYLES: Record<KartStyle, {
  label: string;
  emoji: string;
  blurb: string;
  topSpeed: number;
  accel: number;
  turn: number;
  driftCharge: number;
  mass: number;
}> = {
  classic: { label: 'Classic', emoji: '🏎️', blurb: 'Balanced all-rounder', topSpeed: 1, accel: 1, turn: 1, driftCharge: 1, mass: 1 },
  rocket: { label: 'Rocket', emoji: '🚀', blurb: 'Fastest, slow off the line', topSpeed: 1.035, accel: 0.86, turn: 0.96, driftCharge: 1, mass: 0.9 },
  cyber: { label: 'Cyber', emoji: '⚡', blurb: 'Sharp turns, quick drift sparks', topSpeed: 0.985, accel: 1.02, turn: 1.08, driftCharge: 1.15, mass: 0.85 },
  bruiser: { label: 'Bruiser', emoji: '🛡️', blurb: 'Heavy, shoves everyone aside', topSpeed: 1.005, accel: 0.94, turn: 0.95, driftCharge: 0.95, mass: 1.6 },
};

export const DRIFT_TIER_COLORS = ['#94a3b8', '#38bdf8', '#f97316', '#d946ef'] as const;
export const RANK_COLORS = ['#facc15', '#e2e8f0', '#fb923c', '#38bdf8', '#a855f7', '#94a3b8', '#94a3b8', '#94a3b8'] as const;

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** Race clock formatting: 1:04.27 */
export function formatRaceTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}
