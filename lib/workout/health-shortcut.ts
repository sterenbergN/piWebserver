// The iOS Shortcuts that send Apple Health data to /api/workout/health/import:
// which Health samples to find, and which JSON fields to fill from them. The
// setup guide on the health page (including the copyable prompts for an AI
// shortcut builder) is built from this, so it always matches what the import
// route reads (see lib/workout/health.ts).

export type ShortcutSample = {
  /** Variable name to give the samples ("Set Variable"), e.g. Steps. */
  variable: string;
  /** The type to pick in "Find Health Samples". */
  type: string;
  /** Days to look back in the daily shortcut and in the backfill. */
  days: number;
  backfillDays: number;
  groupByDay?: boolean;
  /**
   * Per-reading data (heart rate, energy) is only kept two weeks and is large,
   * so the backfill sends it in a second, separate upload.
   */
  detail?: boolean;
  why: string;
  /** JSON field → property of the samples to put in it. */
  fields: { key: string; property: 'Value' | 'Start Date' | 'End Date' | 'Unit' }[];
};

export const SHORTCUT_SAMPLES: ShortcutSample[] = [
  {
    variable: 'Steps', type: 'Steps', days: 7, backfillDays: 30, groupByDay: true, why: 'Daily steps',
    fields: [{ key: 'stepsValues', property: 'Value' }, { key: 'stepsDates', property: 'Start Date' }],
  },
  {
    variable: 'Sleep', type: 'Sleep Analysis', days: 7, backfillDays: 30, why: 'Sleep and its stages',
    fields: [{ key: 'sleepValues', property: 'Value' }, { key: 'sleepStarts', property: 'Start Date' }, { key: 'sleepEnds', property: 'End Date' }],
  },
  {
    variable: 'Weight', type: 'Weight', days: 30, backfillDays: 30, why: 'Scale weight (Renpho)',
    fields: [{ key: 'weightValues', property: 'Value' }, { key: 'weightDates', property: 'Start Date' }, { key: 'weightUnit', property: 'Unit' }],
  },
  {
    variable: 'BodyFat', type: 'Body Fat Percentage', days: 30, backfillDays: 30, why: 'Body fat % (Renpho)',
    fields: [{ key: 'bodyFatValues', property: 'Value' }, { key: 'bodyFatDates', property: 'Start Date' }],
  },
  {
    variable: 'RestingHR', type: 'Resting Heart Rate', days: 7, backfillDays: 30, why: 'Readiness',
    fields: [{ key: 'restingHeartRateValues', property: 'Value' }, { key: 'restingHeartRateDates', property: 'Start Date' }],
  },
  {
    variable: 'HRV', type: 'Heart Rate Variability', days: 7, backfillDays: 30, why: 'Readiness',
    fields: [{ key: 'hrvValues', property: 'Value' }, { key: 'hrvDates', property: 'Start Date' }],
  },
  {
    variable: 'HeartRate', type: 'Heart Rate', days: 2, backfillDays: 14, detail: true, why: 'Heart rate during workouts',
    fields: [{ key: 'heartRateValues', property: 'Value' }, { key: 'heartRateDates', property: 'Start Date' }],
  },
  {
    variable: 'Energy', type: 'Active Energy', days: 2, backfillDays: 14, detail: true, why: 'Calories burned in workouts',
    fields: [{ key: 'activeEnergyValues', property: 'Value' }, { key: 'activeEnergyStarts', property: 'Start Date' }, { key: 'activeEnergyEnds', property: 'End Date' }],
  },
];

const fieldLine = (s: ShortcutSample, f: ShortcutSample['fields'][number]) =>
  `- ${f.key}: ${s.variable} › ${f.property}${f.property.endsWith('Date') ? ' (Date Format: ISO 8601, Include Time on)' : ''}`;

/** Every JSON field, in order, e.g. for copying into notes while building the shortcut by hand. */
export function shortcutFieldList() {
  return SHORTCUT_SAMPLES.flatMap((s) => s.fields.map((f) => fieldLine(s, f).slice(2))).join('\n');
}

export type ShortcutKind = 'daily' | 'backfill';
export const SHORTCUT_NAMES: Record<ShortcutKind, string> = { daily: 'Sync Health – Daily', backfill: 'Sync Health – Last 30 Days' };
export const KEY_PLACEHOLDER = 'PASTE-YOUR-SYNC-KEY-HERE';

/**
 * Plain-language instructions for an AI shortcut builder (or a person) to make
 * one of the two shortcuts exactly as the import expects. The daily one sends
 * everything in one upload; the backfill sends 30 days of daily data, then two
 * weeks of heart rate and energy as a second upload.
 */
export function shortcutPrompt(kind: ShortcutKind, { url, key }: { url: string; key?: string | null }) {
  const daily = kind === 'daily';
  const days = (s: ShortcutSample) => (daily ? s.days : s.backfillDays);
  const rows = (list: ShortcutSample[], start = 1) => list.map((s, i) =>
    `${start + i}. ${s.type}: last ${days(s)} days${s.groupByDay ? ', Group By set to Day' : ''}. Save it with Set Variable as "${s.variable}".`).join('\n');
  const fields = (list: ShortcutSample[]) => list.flatMap((s) => s.fields.map((f) => fieldLine(s, f))).join('\n');
  const upload = (list: ShortcutSample[], label: string) => [
    `Add "Get Contents of URL"${label}:`,
    `- URL: ${url}`,
    '- Method: POST',
    '- Request Body: JSON',
    '- In the JSON body, add these fields. Every field is of type Text.',
    `- key: ${key || KEY_PLACEHOLDER} (type this text exactly)`,
    fields(list),
    'For each field above except "key", insert the named variable, tap it and choose the property shown. For every Start Date or End Date, also set that variable\'s Date Format to ISO 8601 and turn Include Time on. A list of samples turns into one item per line, which is exactly what the website expects.',
  ].join('\n');
  const notify = (n: string) => `Add "Get Dictionary Value" to get the value for the key "message" from ${n}, then add "Show Notification" that shows it.`;

  const intro = [
    `Build an Apple Shortcut named "${SHORTCUT_NAMES[kind]}".`,
    daily
      ? 'It reads my recent Apple Health data and uploads it to my website. I will run it automatically every morning and evening.'
      : 'It reads the last 30 days of my Apple Health data and uploads it to my website once, to fill in history.',
    'Follow these steps exactly, in order, and do not add any other actions.',
  ].join(' ');
  const find = 'Add one "Find Health Samples" action for each item below. In each one, choose the sample type shown, add the filter "Start Date is in the last N days" with the number of days shown, leave Limit off, and sort by Start Date, oldest first. Directly after each one, add "Set Variable" to save its result under the variable name shown.';

  if (daily) {
    return [
      intro, '',
      'STEP 1: Read the Health data', find, rows(SHORTCUT_SAMPLES), '',
      'STEP 2: Upload it', upload(SHORTCUT_SAMPLES, ''), '',
      'STEP 3: Show the result', notify('the Contents of URL result'),
    ].join('\n');
  }
  const summary = SHORTCUT_SAMPLES.filter((s) => !s.detail);
  const detail = SHORTCUT_SAMPLES.filter((s) => s.detail);
  return [
    intro, '',
    'STEP 1: Read 30 days of daily data', find, rows(summary), '',
    'STEP 2: Upload the daily data', upload(summary, ' (the first upload)'), '',
    'STEP 3: Show the first result', notify('the first Contents of URL result'), '',
    'STEP 4: Read two weeks of heart rate and energy', find, rows(detail, summary.length + 1), '',
    'STEP 5: Upload it separately', upload(detail, ' (a second, separate upload with only these fields)'), '',
    'STEP 6: Show the second result', notify('the second Contents of URL result'),
  ].join('\n');
}
