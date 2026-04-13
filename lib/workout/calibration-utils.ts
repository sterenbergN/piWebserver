export function normalizeLiftKey(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
