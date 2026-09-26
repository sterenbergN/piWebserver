// Constants and helpers shared by the analytics tabs.

export function titleCase(value: string): string {
   return (value || '').replace(/\b\w/g, (m) => m.toUpperCase());
}

export const STRENGTH_STANDARDS: Record<string, { beginner: number; novice: number; intermediate: number; advanced: number; elite: number }> = {
  'Bench Press': { beginner: 0.5, novice: 0.75, intermediate: 1.0, advanced: 1.5, elite: 2.0 },
  'Squat': { beginner: 0.75, novice: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
  'Deadlift': { beginner: 1.0, novice: 1.25, intermediate: 1.75, advanced: 2.5, elite: 3.0 },
  'Overhead Press': { beginner: 0.35, novice: 0.5, intermediate: 0.75, advanced: 1.0, elite: 1.35 },
};

