// The iOS Shortcut that sends Apple Health data to /api/workout/health/import:
// which Health samples to find, and which JSON fields to fill from them. The
// setup guide on the health page is built from this, so it always matches
// what the import route reads (see lib/workout/health.ts).

export type ShortcutSample = {
  /** Variable name to give the samples ("Set Variable"), e.g. Steps. */
  variable: string;
  /** The type to pick in "Find Health Samples". */
  type: string;
  /** "Start Date is in the last …" */
  range: string;
  groupByDay?: boolean;
  why: string;
  /** JSON field → property of the samples to put in it. */
  fields: { key: string; property: 'Value' | 'Start Date' | 'End Date' | 'Unit' }[];
};

export const SHORTCUT_SAMPLES: ShortcutSample[] = [
  {
    variable: 'Steps', type: 'Steps', range: '7 days', groupByDay: true, why: 'Daily steps',
    fields: [{ key: 'stepsValues', property: 'Value' }, { key: 'stepsDates', property: 'Start Date' }],
  },
  {
    variable: 'Sleep', type: 'Sleep Analysis', range: '7 days', why: 'Sleep and its stages',
    fields: [{ key: 'sleepValues', property: 'Value' }, { key: 'sleepStarts', property: 'Start Date' }, { key: 'sleepEnds', property: 'End Date' }],
  },
  {
    variable: 'Weight', type: 'Weight', range: '30 days', why: 'Scale weight (Renpho)',
    fields: [{ key: 'weightValues', property: 'Value' }, { key: 'weightDates', property: 'Start Date' }, { key: 'weightUnit', property: 'Unit' }],
  },
  {
    variable: 'BodyFat', type: 'Body Fat Percentage', range: '30 days', why: 'Body fat % (Renpho)',
    fields: [{ key: 'bodyFatValues', property: 'Value' }, { key: 'bodyFatDates', property: 'Start Date' }],
  },
  {
    variable: 'RestingHR', type: 'Resting Heart Rate', range: '7 days', why: 'Readiness',
    fields: [{ key: 'restingHeartRateValues', property: 'Value' }, { key: 'restingHeartRateDates', property: 'Start Date' }],
  },
  {
    variable: 'HRV', type: 'Heart Rate Variability', range: '7 days', why: 'Readiness',
    fields: [{ key: 'hrvValues', property: 'Value' }, { key: 'hrvDates', property: 'Start Date' }],
  },
  {
    variable: 'HeartRate', type: 'Heart Rate', range: '2 days', why: 'Heart rate during workouts',
    fields: [{ key: 'heartRateValues', property: 'Value' }, { key: 'heartRateDates', property: 'Start Date' }],
  },
  {
    variable: 'Energy', type: 'Active Energy', range: '2 days', why: 'Calories burned in workouts',
    fields: [{ key: 'activeEnergyValues', property: 'Value' }, { key: 'activeEnergyStarts', property: 'Start Date' }, { key: 'activeEnergyEnds', property: 'End Date' }],
  },
];

/** Every JSON field, in order, e.g. for copying into notes while building the shortcut. */
export function shortcutFieldList() {
  return SHORTCUT_SAMPLES.flatMap((s) => s.fields.map((f) => `${f.key} = ${s.variable} › ${f.property}${f.property.endsWith('Date') ? ' (ISO 8601)' : ''}`)).join('\n');
}
