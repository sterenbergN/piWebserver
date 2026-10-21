// One profile level for the whole site. XP comes from habits now and daily
// questions later; each feature works out its own XP and they're added up.

/** Total XP needed to reach `level` (level 1 starts at 0): 100, 300, 600, 1000, … */
export function xpForLevel(level: number) {
  return 50 * level * (level - 1);
}

/** Titles by the level they start at. */
export const LEVEL_TITLES: [number, string][] = [
  [1, 'Seedling'],
  [3, 'Sprout'],
  [5, 'Sapling'],
  [8, 'Grower'],
  [12, 'Gardener'],
  [17, 'Botanist'],
  [25, 'Grove keeper'],
  [35, 'Ancient oak'],
];

export function levelFromXp(xp: number) {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpForLevel(level + 1) <= total) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: titleFor(level),
    xp: total,
    into: total - floor,
    size: next - floor,
    toNext: next - total,
  };
}

export function titleFor(level: number) {
  return LEVEL_TITLES.filter(([at]) => level >= at).pop()![1];
}

/** The next title up, the level it comes at, and the total XP that takes (null at the top). */
export function nextTitle(level: number) {
  const next = LEVEL_TITLES.find(([at]) => at > level);
  return next ? { level: next[0], title: next[1], xp: xpForLevel(next[0]) } : null;
}
