export function normalizeLiftKey(name: string): string {
  const cleaned = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return cleaned.split(' ').filter(w => !['machine', 'barbell', 'dumbbell', 'cable', 'smith'].includes(w)).sort().join(' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
