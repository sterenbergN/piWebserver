export type IntensityLabel = { label: string; emoji: string; color: string };

/** Display label for an intensity factor (0.5 – 1.5). */
export function getIntensityLabel(value: number): IntensityLabel {
  if (value <= 0.6) return { label: 'Recovery', emoji: '🧘', color: 'var(--info)' };
  if (value <= 0.8) return { label: 'Light', emoji: '🌿', color: 'var(--success-light)' };
  if (value <= 1.1) return { label: 'Standard', emoji: '⚖️', color: 'var(--success)' };
  if (value <= 1.3) return { label: 'Push', emoji: '💪', color: 'var(--warning)' };
  return { label: 'Max Push', emoji: '🔥', color: 'var(--danger)' };
}

export const INTENSITY_MIN = 0.5;
export const INTENSITY_MAX = 1.5;
export const INTENSITY_STEP = 0.05;
