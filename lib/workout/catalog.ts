import { newRecordId } from './stations';
import type { Lift, ProgressionProfile, Station, StationType } from './types';

// Built-in knowledge used to set up a gym quickly: common lifts with their
// muscles, equipment presets with sensible weights and suggested lifts, and
// whole-gym starter templates. Everything here only pre-fills forms; the user
// can still edit every field.

type LiftInfo = { primary: string; secondary?: string; single?: boolean; profile?: ProgressionProfile };

const LIFTS: Record<string, LiftInfo> = {
  // Chest
  'Bench Press': { primary: 'Chest', secondary: 'Triceps' },
  'Incline Bench Press': { primary: 'Chest', secondary: 'Shoulders' },
  'Decline Bench Press': { primary: 'Chest', secondary: 'Triceps' },
  'Dumbbell Bench Press': { primary: 'Chest', secondary: 'Triceps' },
  'Incline Dumbbell Press': { primary: 'Chest', secondary: 'Shoulders' },
  'Dumbbell Fly': { primary: 'Chest' },
  'Chest Press': { primary: 'Chest', secondary: 'Triceps' },
  'Pec Deck': { primary: 'Chest' },
  'Cable Fly': { primary: 'Chest' },
  'Push-Up': { primary: 'Chest', secondary: 'Triceps', profile: 'high-rep' },
  'Dip': { primary: 'Triceps', secondary: 'Chest' },
  // Back
  'Deadlift': { primary: 'Back', secondary: 'Hamstrings' },
  'Barbell Row': { primary: 'Back', secondary: 'Biceps' },
  'Dumbbell Row': { primary: 'Back', secondary: 'Biceps', single: true },
  'Lat Pulldown': { primary: 'Back', secondary: 'Biceps' },
  'Close-Grip Pulldown': { primary: 'Back', secondary: 'Biceps' },
  'Seated Cable Row': { primary: 'Back', secondary: 'Biceps' },
  'Machine Row': { primary: 'Back', secondary: 'Biceps' },
  'Pull-Up': { primary: 'Back', secondary: 'Biceps' },
  'Chin-Up': { primary: 'Back', secondary: 'Biceps' },
  'Straight-Arm Pulldown': { primary: 'Back' },
  'Shrug': { primary: 'Back' },
  'Back Extension': { primary: 'Back', secondary: 'Glutes', profile: 'high-rep' },
  // Shoulders
  'Overhead Press': { primary: 'Shoulders', secondary: 'Triceps' },
  'Dumbbell Shoulder Press': { primary: 'Shoulders', secondary: 'Triceps' },
  'Shoulder Press Machine': { primary: 'Shoulders', secondary: 'Triceps' },
  'Lateral Raise': { primary: 'Shoulders', profile: 'high-rep' },
  'Cable Lateral Raise': { primary: 'Shoulders', single: true, profile: 'high-rep' },
  'Rear Delt Fly': { primary: 'Shoulders', secondary: 'Back', profile: 'high-rep' },
  'Face Pull': { primary: 'Shoulders', secondary: 'Back', profile: 'high-rep' },
  // Arms
  'Barbell Curl': { primary: 'Biceps' },
  'EZ-Bar Curl': { primary: 'Biceps' },
  'Dumbbell Curl': { primary: 'Biceps' },
  'Hammer Curl': { primary: 'Biceps' },
  'Cable Curl': { primary: 'Biceps' },
  'Preacher Curl': { primary: 'Biceps' },
  'Tricep Pushdown': { primary: 'Triceps' },
  'Overhead Tricep Extension': { primary: 'Triceps' },
  'Skull Crusher': { primary: 'Triceps' },
  'Close-Grip Bench Press': { primary: 'Triceps', secondary: 'Chest' },
  // Legs
  'Back Squat': { primary: 'Quads', secondary: 'Glutes' },
  'Front Squat': { primary: 'Quads', secondary: 'Glutes' },
  'Goblet Squat': { primary: 'Quads', secondary: 'Glutes' },
  'Hack Squat': { primary: 'Quads', secondary: 'Glutes' },
  'Leg Press': { primary: 'Quads', secondary: 'Glutes' },
  'Smith Machine Squat': { primary: 'Quads', secondary: 'Glutes' },
  'Bulgarian Split Squat': { primary: 'Quads', secondary: 'Glutes', single: true },
  'Walking Lunge': { primary: 'Quads', secondary: 'Glutes', single: true },
  'Leg Extension': { primary: 'Quads' },
  'Romanian Deadlift': { primary: 'Hamstrings', secondary: 'Glutes' },
  'Dumbbell Romanian Deadlift': { primary: 'Hamstrings', secondary: 'Glutes' },
  'Seated Leg Curl': { primary: 'Hamstrings' },
  'Lying Leg Curl': { primary: 'Hamstrings' },
  'Hip Thrust': { primary: 'Glutes', secondary: 'Hamstrings' },
  'Cable Kickback': { primary: 'Glutes', single: true, profile: 'high-rep' },
  'Hip Abduction': { primary: 'Glutes', profile: 'high-rep' },
  'Standing Calf Raise': { primary: 'Calves', profile: 'high-rep' },
  'Seated Calf Raise': { primary: 'Calves', profile: 'high-rep' },
  // Core
  'Cable Crunch': { primary: 'Core', profile: 'high-rep' },
  'Hanging Leg Raise': { primary: 'Core', profile: 'high-rep' },
  'Ab Crunch Machine': { primary: 'Core', profile: 'high-rep' },
  'Plank': { primary: 'Core', profile: 'endurance' },
  'Russian Twist': { primary: 'Core', profile: 'high-rep' },
  'Pallof Press': { primary: 'Core', single: true },
};

export const CATALOG_LIFT_NAMES = Object.keys(LIFTS).sort();

// Keyword fallbacks for names that aren't in the catalog. Order matters: the
// first match wins, so specific patterns come before broad ones.
const KEYWORD_RULES: [RegExp, LiftInfo][] = [
  [/leg curl|hamstring|nordic/, { primary: 'Hamstrings' }],
  [/leg ext/, { primary: 'Quads' }],
  [/calf/, { primary: 'Calves', profile: 'high-rep' }],
  [/rdl|romanian|stiff.?leg|good ?morning/, { primary: 'Hamstrings', secondary: 'Glutes' }],
  [/hip thrust|glute|kickback|abduct|bridge/, { primary: 'Glutes', secondary: 'Hamstrings' }],
  [/squat|lunge|leg press|step.?up/, { primary: 'Quads', secondary: 'Glutes' }],
  [/deadlift/, { primary: 'Back', secondary: 'Hamstrings' }],
  [/crunch|plank|\bab|core|twist|leg raise|sit.?up|pallof|wood ?chop/, { primary: 'Core', profile: 'high-rep' }],
  [/face pull|rear delt|reverse fly/, { primary: 'Shoulders', secondary: 'Back', profile: 'high-rep' }],
  [/tricep|pushdown|push.?down|skull|kickback|dip/, { primary: 'Triceps' }],
  [/curl/, { primary: 'Biceps' }],
  [/row|pulldown|pull.?down|pull.?up|chin.?up|lat\b|shrug|pullover/, { primary: 'Back', secondary: 'Biceps' }],
  [/lateral|raise|overhead|shoulder|military|ohp|arnold|upright/, { primary: 'Shoulders', secondary: 'Triceps' }],
  [/bench|chest|fly|flye|pec|push.?up|press/, { primary: 'Chest', secondary: 'Triceps' }],
];

const SINGLE_LIMB = /single|one.?arm|one.?leg|unilateral|bulgarian|split squat|lunge|\bsa\b/;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const LIFTS_BY_NORM = new Map(Object.entries(LIFTS).map(([name, info]) => [norm(name), { name, info }]));

/**
 * Best-guess lift details from its name: an exact catalog match first, then
 * keyword rules. Returns undefined when nothing matches.
 */
export function inferLiftDetails(name: string): (Partial<Lift> & { known: boolean }) | undefined {
  const key = norm(name);
  if (!key) return undefined;
  const exact = LIFTS_BY_NORM.get(key);
  const rule = exact ? undefined : KEYWORD_RULES.find(([pattern]) => pattern.test(key));
  const info = exact?.info || rule?.[1];
  if (!info) return undefined;
  return {
    known: !!exact,
    primaryMuscle: info.primary,
    secondaryMuscle: info.secondary || 'None',
    singleArmLeg: info.single === true || SINGLE_LIMB.test(key),
    progressionProfile: info.profile || 'standard',
  };
}

/** "single arm row" → "Single Arm Row"; names with any capitals are left as typed. */
function tidyName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed === trimmed.toLowerCase() ? trimmed.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : trimmed;
}

/** A complete lift for a name, using the catalog/keywords (Chest if unknown). */
export function liftFromName(name: string, extra: Partial<Lift> = {}): Lift {
  const trimmed = tidyName(name);
  const inferred = inferLiftDetails(trimmed);
  return {
    id: newRecordId(),
    name: LIFTS_BY_NORM.get(norm(trimmed))?.name || trimmed,
    primaryMuscle: inferred?.primaryMuscle || 'Chest',
    secondaryMuscle: inferred?.secondaryMuscle || 'None',
    singleArmLeg: inferred?.singleArmLeg === true,
    progressionProfile: inferred?.progressionProfile || 'standard',
    ...extra,
  };
}

// ─── Equipment presets ─────────────────────────────────────────────────────────

const STANDARD_PLATES = [45, 45, 35, 25, 10, 5, 2.5];
const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

export type EquipmentPreset = {
  key: string;
  name: string;
  category: 'Free weights' | 'Machines' | 'Cables' | 'Bodyweight';
  icon: string;
  station: Omit<Partial<Station>, 'id' | 'lifts'> & { type: StationType };
  /** Suggested lifts; `attachment` names a station attachment for cable lifts. */
  lifts: { name: string; attachment?: string }[];
};

export const EQUIPMENT_PRESETS: EquipmentPreset[] = [
  {
    key: 'power-rack', name: 'Squat / Power Rack', category: 'Free weights', icon: '🏋️',
    station: { type: 'plates', baseWeight: 45, plateSets: STANDARD_PLATES },
    lifts: [{ name: 'Back Squat' }, { name: 'Front Squat' }, { name: 'Overhead Press' }, { name: 'Barbell Row' }, { name: 'Romanian Deadlift' }],
  },
  {
    key: 'flat-bench', name: 'Barbell Bench', category: 'Free weights', icon: '🛋️',
    station: { type: 'plates', baseWeight: 45, plateSets: STANDARD_PLATES },
    lifts: [{ name: 'Bench Press' }, { name: 'Close-Grip Bench Press' }],
  },
  {
    key: 'incline-bench', name: 'Incline Barbell Bench', category: 'Free weights', icon: '📐',
    station: { type: 'plates', baseWeight: 45, plateSets: STANDARD_PLATES },
    lifts: [{ name: 'Incline Bench Press' }],
  },
  {
    key: 'deadlift-platform', name: 'Deadlift Platform', category: 'Free weights', icon: '⬛',
    station: { type: 'plates', baseWeight: 45, plateSets: [45, 45, 45, 35, 25, 10, 5, 2.5] },
    lifts: [{ name: 'Deadlift' }, { name: 'Romanian Deadlift' }, { name: 'Hip Thrust' }, { name: 'Shrug' }],
  },
  {
    key: 'ez-bar', name: 'EZ Curl Bar', category: 'Free weights', icon: '〰️',
    station: { type: 'plates', baseWeight: 25, plateSets: [25, 10, 5, 2.5] },
    lifts: [{ name: 'EZ-Bar Curl' }, { name: 'Skull Crusher' }, { name: 'Preacher Curl' }],
  },
  {
    key: 'dumbbells', name: 'Dumbbell Rack (5–100)', category: 'Free weights', icon: '🔩',
    station: { type: 'dumbbells', dumbbellPairs: range(5, 100, 5) },
    lifts: [
      { name: 'Dumbbell Bench Press' }, { name: 'Incline Dumbbell Press' }, { name: 'Dumbbell Shoulder Press' },
      { name: 'Dumbbell Row' }, { name: 'Dumbbell Curl' }, { name: 'Hammer Curl' }, { name: 'Lateral Raise' },
      { name: 'Goblet Squat' }, { name: 'Bulgarian Split Squat' }, { name: 'Dumbbell Romanian Deadlift' },
    ],
  },
  {
    key: 'home-dumbbells', name: 'Adjustable Dumbbells (5–50)', category: 'Free weights', icon: '🏠',
    station: { type: 'dumbbells', dumbbellPairs: range(5, 50, 2.5) },
    lifts: [{ name: 'Dumbbell Bench Press' }, { name: 'Dumbbell Shoulder Press' }, { name: 'Dumbbell Row' }, { name: 'Dumbbell Curl' }, { name: 'Goblet Squat' }],
  },
  {
    key: 'smith', name: 'Smith Machine', category: 'Machines', icon: '🗜️',
    station: { type: 'plates', baseWeight: 20, plateSets: STANDARD_PLATES },
    lifts: [{ name: 'Smith Machine Squat' }, { name: 'Incline Bench Press' }, { name: 'Standing Calf Raise' }],
  },
  {
    key: 'leg-press', name: 'Leg Press (plate loaded)', category: 'Machines', icon: '🦵',
    station: { type: 'plates', baseWeight: 0, plateSets: [45, 45, 45, 45, 25, 10, 5] },
    lifts: [{ name: 'Leg Press' }, { name: 'Seated Calf Raise' }],
  },
  {
    key: 'hack-squat', name: 'Hack Squat', category: 'Machines', icon: '⛓️',
    station: { type: 'plates', baseWeight: 0, plateSets: STANDARD_PLATES },
    lifts: [{ name: 'Hack Squat' }],
  },
  {
    key: 'leg-extension', name: 'Leg Extension', category: 'Machines', icon: '🦿',
    station: { type: 'stack', minWeight: 10, maxWeight: 250, increment: 10 },
    lifts: [{ name: 'Leg Extension' }],
  },
  {
    key: 'leg-curl', name: 'Leg Curl', category: 'Machines', icon: '🔁',
    station: { type: 'stack', minWeight: 10, maxWeight: 200, increment: 10 },
    lifts: [{ name: 'Seated Leg Curl' }],
  },
  {
    key: 'chest-press', name: 'Chest Press Machine', category: 'Machines', icon: '🫸',
    station: { type: 'stack', minWeight: 10, maxWeight: 250, increment: 10 },
    lifts: [{ name: 'Chest Press' }],
  },
  {
    key: 'shoulder-press', name: 'Shoulder Press Machine', category: 'Machines', icon: '🙌',
    station: { type: 'stack', minWeight: 10, maxWeight: 200, increment: 10 },
    lifts: [{ name: 'Shoulder Press Machine' }],
  },
  {
    key: 'pec-deck', name: 'Pec Deck / Rear Delt', category: 'Machines', icon: '🦋',
    station: { type: 'stack', minWeight: 10, maxWeight: 200, increment: 10 },
    lifts: [{ name: 'Pec Deck' }, { name: 'Rear Delt Fly' }],
  },
  {
    key: 'row-machine', name: 'Seated Row Machine', category: 'Machines', icon: '🚣',
    station: { type: 'stack', minWeight: 10, maxWeight: 250, increment: 10 },
    lifts: [{ name: 'Machine Row' }],
  },
  {
    key: 'hip-abduction', name: 'Hip Abduction', category: 'Machines', icon: '🍑',
    station: { type: 'stack', minWeight: 10, maxWeight: 200, increment: 10 },
    lifts: [{ name: 'Hip Abduction' }],
  },
  {
    key: 'ab-machine', name: 'Ab Crunch Machine', category: 'Machines', icon: '🧱',
    station: { type: 'stack', minWeight: 10, maxWeight: 150, increment: 10 },
    lifts: [{ name: 'Ab Crunch Machine' }],
  },
  {
    key: 'lat-pulldown', name: 'Lat Pulldown', category: 'Cables', icon: '⬇️',
    station: { type: 'cable', minWeight: 10, maxWeight: 250, increment: 10, attachments: ['Wide Bar', 'V-Bar'] },
    lifts: [{ name: 'Lat Pulldown', attachment: 'Wide Bar' }, { name: 'Close-Grip Pulldown', attachment: 'V-Bar' }, { name: 'Straight-Arm Pulldown', attachment: 'Wide Bar' }],
  },
  {
    key: 'cable-row', name: 'Seated Cable Row', category: 'Cables', icon: '↔️',
    station: { type: 'cable', minWeight: 10, maxWeight: 250, increment: 10, attachments: ['V-Bar', 'Wide Bar'] },
    lifts: [{ name: 'Seated Cable Row', attachment: 'V-Bar' }],
  },
  {
    key: 'cable-crossover', name: 'Cable Crossover / Functional Trainer', category: 'Cables', icon: '✖️',
    station: { type: 'cable', minWeight: 5, maxWeight: 150, increment: 5, attachments: ['Rope', 'D-Handle', 'Straight Bar', 'Ankle Strap'] },
    lifts: [
      { name: 'Tricep Pushdown', attachment: 'Rope' }, { name: 'Face Pull', attachment: 'Rope' }, { name: 'Cable Curl', attachment: 'Straight Bar' },
      { name: 'Cable Fly', attachment: 'D-Handle' }, { name: 'Cable Lateral Raise', attachment: 'D-Handle' },
      { name: 'Overhead Tricep Extension', attachment: 'Rope' }, { name: 'Cable Crunch', attachment: 'Rope' }, { name: 'Cable Kickback', attachment: 'Ankle Strap' },
    ],
  },
  {
    key: 'pull-up-bar', name: 'Pull-Up / Dip Station', category: 'Bodyweight', icon: '🧗',
    station: { type: 'bodyweight', bodyWeightAdditions: [10, 25, 45] },
    lifts: [{ name: 'Pull-Up' }, { name: 'Chin-Up' }, { name: 'Dip' }, { name: 'Hanging Leg Raise' }],
  },
  {
    key: 'floor', name: 'Floor / Mat', category: 'Bodyweight', icon: '🧘',
    station: { type: 'bodyweight', bodyWeightAdditions: [] },
    lifts: [{ name: 'Push-Up' }, { name: 'Plank' }, { name: 'Walking Lunge' }],
  },
  {
    key: 'back-extension', name: 'Back Extension Bench', category: 'Bodyweight', icon: '↩️',
    station: { type: 'bodyweight', bodyWeightAdditions: [10, 25, 45] },
    lifts: [{ name: 'Back Extension' }],
  },
];

export const GYM_TEMPLATES: { key: string; name: string; description: string; presets: string[] }[] = [
  {
    key: 'commercial', name: 'Commercial gym', description: 'Racks, benches, dumbbells, cables and the common machines',
    presets: ['power-rack', 'flat-bench', 'incline-bench', 'deadlift-platform', 'dumbbells', 'smith', 'leg-press', 'leg-extension', 'leg-curl', 'lat-pulldown', 'cable-row', 'cable-crossover', 'chest-press', 'pec-deck', 'pull-up-bar'],
  },
  {
    key: 'home', name: 'Home gym', description: 'Rack with bench, adjustable dumbbells and a pull-up bar',
    presets: ['power-rack', 'flat-bench', 'home-dumbbells', 'pull-up-bar', 'floor'],
  },
  {
    key: 'hotel', name: 'Hotel / apartment gym', description: 'Dumbbells, a cable tower and bodyweight',
    presets: ['home-dumbbells', 'cable-crossover', 'floor'],
  },
];

export function findPreset(key: string) {
  return EQUIPMENT_PRESETS.find((p) => p.key === key);
}

/** Lifts for a preset, keeping only attachments the station actually has. */
export function presetLifts(preset: EquipmentPreset, names?: string[]): Lift[] {
  const wanted = names ? new Set(names) : null;
  const attachments = preset.station.attachments || [];
  return preset.lifts
    .filter((l) => !wanted || wanted.has(l.name))
    .map((l) => liftFromName(l.name, l.attachment && attachments.includes(l.attachment) ? { attachment: l.attachment } : {}));
}

/** A ready-to-save station built from a preset with all of its suggested lifts. */
export function stationFromPreset(preset: EquipmentPreset): Station {
  return { ...preset.station, id: newRecordId(), name: preset.name, lifts: presetLifts(preset) } as Station;
}

/** Stations for a gym template, skipping any whose name the gym already has. */
export function stationsFromTemplate(templateKey: string, existing: Station[] = []): Station[] {
  const template = GYM_TEMPLATES.find((t) => t.key === templateKey);
  if (!template) return [];
  const taken = new Set(existing.map((s) => s.name.toLowerCase()));
  return template.presets
    .map(findPreset)
    .filter((p): p is EquipmentPreset => !!p && !taken.has(p.name.toLowerCase()))
    .map(stationFromPreset);
}

const TYPE_SUGGESTIONS: Record<StationType, string[]> = {
  plates: ['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press', 'Barbell Row', 'Romanian Deadlift', 'Hip Thrust', 'Barbell Curl'],
  stack: ['Leg Extension', 'Seated Leg Curl', 'Chest Press', 'Shoulder Press Machine', 'Machine Row', 'Pec Deck'],
  cable: ['Lat Pulldown', 'Seated Cable Row', 'Tricep Pushdown', 'Face Pull', 'Cable Curl', 'Cable Fly', 'Cable Crunch'],
  dumbbells: ['Dumbbell Bench Press', 'Dumbbell Shoulder Press', 'Dumbbell Row', 'Dumbbell Curl', 'Lateral Raise', 'Goblet Squat'],
  bodyweight: ['Pull-Up', 'Chin-Up', 'Dip', 'Push-Up', 'Hanging Leg Raise', 'Plank'],
};

/**
 * Lift names worth suggesting for a station: its matching preset's lifts
 * (by name) or common lifts for its type, minus those it already has.
 */
export function suggestedLiftNames(station: Pick<Station, 'name' | 'type'> & { lifts?: Lift[] }): string[] {
  const preset = EQUIPMENT_PRESETS.find((p) => norm(p.name) === norm(station.name || ''));
  const names = preset ? preset.lifts.map((l) => l.name) : TYPE_SUGGESTIONS[station.type] || [];
  const have = new Set((station.lifts || []).map((l) => norm(l.name)));
  return names.filter((n) => !have.has(norm(n)));
}
