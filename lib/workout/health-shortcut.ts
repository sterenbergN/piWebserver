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
    variable: 'ActiveDaily', type: 'Active Energy', days: 7, backfillDays: 30, groupByDay: true, why: 'Calories burned moving, per day',
    fields: [{ key: 'activeEnergyDailyValues', property: 'Value' }, { key: 'activeEnergyDailyDates', property: 'Start Date' }],
  },
  {
    variable: 'Resting', type: 'Resting Energy', days: 7, backfillDays: 30, groupByDay: true, why: 'Resting calories, per day',
    fields: [{ key: 'restingEnergyValues', property: 'Value' }, { key: 'restingEnergyDates', property: 'Start Date' }],
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
    variable: 'HeartRate', type: 'Heart Rate', days: 1, backfillDays: 14, detail: true, why: 'Heart rate during workouts',
    fields: [{ key: 'heartRateValues', property: 'Value' }, { key: 'heartRateDates', property: 'Start Date' }],
  },
  {
    variable: 'Energy', type: 'Active Energy', days: 1, backfillDays: 14, detail: true, why: 'Calories burned in workouts',
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
 * Health can only be read while the phone is unlocked, so the daily shortcut
 * runs when Messages is opened (always unlocked) instead of at set times. It
 * keeps its last run time in this file (iCloud Drive › Shortcuts) and skips
 * runs less than SYNC_EVERY_HOURS apart.
 */
export const SYNC_TRIGGER_APP = 'Messages';
export const SYNC_STAMP_FILE = 'health-sync-last.txt';
export const SYNC_EVERY_HOURS = 3;

/** The 30-day shortcut uploads heart rate and energy this many readings at a time, for at most this many batches each. */
export const BACKFILL_BATCH = 2500;
export const BACKFILL_MAX_BATCHES = 20;

/**
 * Plain-language instructions for an AI shortcut builder (or a person) to make
 * one of the two shortcuts exactly as the import expects. The daily one sends
 * everything in one upload; the backfill sends 30 days of daily data, then two
 * weeks of heart rate and energy as a second upload.
 */
export function shortcutPrompt(kind: ShortcutKind, { url, key }: { url: string; key?: string | null }) {
  const daily = kind === 'daily';
  const days = (s: ShortcutSample) => (daily ? s.days : s.backfillDays);
  // Every search uses a fixed "in the last N days": a date worked out while the
  // shortcut runs (Adjust Date) found nothing when used as the filter.
  const rows = (list: ShortcutSample[], start = 1) => list.map((s, i) =>
    `${start + i}. ${s.type}: last ${days(s)} ${days(s) === 1 ? 'day' : 'days'}${s.groupByDay ? ', Group By set to Day' : ''}. Save it with Set Variable as "${s.variable}".`).join('\n');
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
      ? `It reads my recent Apple Health data and uploads it to my website. It will run automatically whenever I open ${SYNC_TRIGGER_APP}, so it must skip itself if it already ran in the last ${SYNC_EVERY_HOURS} hours, and stay silent unless something is wrong.`
      : 'It reads the last 30 days of my Apple Health data and uploads it to my website once, to fill in history.',
    'Follow these steps exactly, in order, and do not add any other actions.',
  ].join(' ');
  const find = 'Add one "Find Health Samples" action for each item below. In each one, choose the sample type shown, add the filter "Start Date is in the last N days" with the number of days shown, leave Limit off, and sort by Start Date, oldest first. Directly after each one, add "Set Variable" to save its result under the variable name shown.';

  if (daily) {
    const minutes = SYNC_EVERY_HOURS * 60;
    return [
      intro, '',
      `STEP 1: Skip if it already ran in the last ${SYNC_EVERY_HOURS} hours`,
      `1. Add "Get File from Folder". Folder: Shortcuts (in iCloud Drive). File Path: ${SYNC_STAMP_FILE}. Turn "Error If Not Found" off.`,
      '2. Add "If" with the condition: File "has any value". Inside this If:',
      '   a. Add "Get Text from Input" with the File as input.',
      '   b. Add "Get Dates from Input" with that Text as input.',
      '   c. Add "Get Time Between Dates": the time between Dates and Current Date, in Minutes.',
      `   d. Add another "If": Time Between Dates "is less than" ${minutes}. Inside it, add "Stop This Shortcut". Then End If.`,
      '3. End the first If (leave its Otherwise empty).', '',
      'STEP 2: Read the Health data', find, rows(SHORTCUT_SAMPLES), '',
      'STEP 3: Upload it', upload(SHORTCUT_SAMPLES, ''), 'Directly after this Get Contents of URL, add "Set Variable" named "Response".', '',
      'STEP 4: Remember when it ran',
      '1. Add "Format Date" on Current Date, with Date Format: Medium and Time Format: Short.',
      `2. Add "Save File" to save the Formatted Date into the Shortcuts folder (iCloud Drive) with the file path ${SYNC_STAMP_FILE}. Turn "Ask Where to Save" off and turn "Overwrite If File Exists" on.`, '',
      'STEP 5: Only speak up if something is wrong',
      'Add "Get Dictionary Value" to get the value for the key "alert" from the variable Response. Then add "If" Dictionary Value "has any value", and inside it add "Show Notification" that shows the Dictionary Value. Leave Otherwise empty. Do not show any other notification.',
    ].join('\n');
  }
  // Two weeks of watch heart rate and energy is tens of thousands of readings —
  // more than Shortcuts can turn into text at once. Each is found once with a
  // fixed range and uploaded in batches picked by position in the list (a
  // date worked out at run time finds nothing as a search filter).
  const summary = SHORTCUT_SAMPLES.filter((s) => !s.detail);
  const detail = SHORTCUT_SAMPLES.filter((s) => s.detail);
  const n = BACKFILL_BATCH.toLocaleString('en-US');
  const batches = (s: ShortcutSample, step: number) => {
    const all = `All${s.variable}`;
    const count = `${s.variable}Count`;
    return [
      `STEP ${step}: ${s.type} for the last ${s.backfillDays} days, uploaded ${n} readings at a time`,
      `1. Add "Find Health Samples": type ${s.type}, filter "Start Date is in the last ${s.backfillDays} days", Limit off, sorted by Start Date, oldest first. Then add "Set Variable" named "${all}".`,
      `2. Add "Count": Count Items in ${all}. Then add "Set Variable" named "${count}".`,
      `3. Add a "Repeat" action that repeats ${BACKFILL_MAX_BATCHES} times. Put all of the following inside the Repeat:`,
      `   a. Add "Calculate": Repeat Index × ${BACKFILL_BATCH}. Then add "Set Variable" named "To".`,
      `   b. Add "Calculate": To − ${BACKFILL_BATCH}. Then add "Set Variable" named "Done".`,
      `   c. Add "If": ${count} "is greater than" Done. Put the rest inside this If:`,
      '      i. Add "Calculate": Done + 1. Then add "Set Variable" named "From".',
      `      ii. Add "If": To "is greater than" ${count}. Inside it, add "Set Variable" named "Last" set to ${count}. In its Otherwise, add "Set Variable" named "Last" set to To. Then End If.`,
      `      iii. Add "Get Items from List": Get Items in Range, from index From to index Last, of ${all}. Then add "Set Variable" named "${s.variable}".`,
      `      iv. ${upload([s], ' with only these fields')}`,
      '   d. End the If (leave its Otherwise empty). Do not show a notification inside the Repeat.',
    ].join('\n');
  };
  return [
    intro, '',
    'STEP 1: Read 30 days of daily data', find, rows(summary), '',
    'STEP 2: Upload the daily data', upload(summary, ' (the first upload)'), '',
    'STEP 3: Show the first result', notify('this Contents of URL result'), '',
    ...detail.flatMap((s, i) => [batches(s, 4 + i), '']),
    `STEP ${4 + detail.length}: After both Repeats, add "Show Notification" with the text "Heart rate and energy backfill finished".`,
  ].join('\n');
}
