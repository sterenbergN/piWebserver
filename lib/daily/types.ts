// The daily question format. A day has one core question (answering it keeps
// your streak), optional bonus questions, and a formula sheet. Days are written
// ahead of time in packs and uploaded to the site (see validate.ts).

export const TRACKS = ['mechanical', 'controls', 'automation'] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_LABEL: Record<Track, string> = { mechanical: 'Mechanical', controls: 'Controls', automation: 'Automation' };

/** How a part is answered and graded. */
export type Answer =
  /** A number in the unit the part asks for. Within `tolerance` (relative, default 2%) or `abs`. */
  | { type: 'numeric'; value: number; unit?: string; tolerance?: number; abs?: number }
  /** Pick one option. */
  | { type: 'choice'; options: string[]; correct: number }
  /** Pick every option that applies; must match exactly. */
  | { type: 'multi'; options: string[]; correct: number[] }
  /** An interval like 0 < K < 6. `null` means unbounded on that side. */
  | { type: 'range'; min: number | null; max: number | null; tolerance?: number; abs?: number }
  /** Polynomial coefficients, highest power first (e.g. a transfer function). Compared after scaling so the denominator is monic. */
  | { type: 'coefficients'; numerator: number[]; denominator: number[]; tolerance?: number }
  /** Put these items in order (listed here in the correct order; shown shuffled). */
  | { type: 'order'; items: string[] };

/** A note shown when an answer matches a common mistake. */
export type Mistake = { value?: number; option?: number; note: string };

export type Part = {
  id: string;
  /** Extra text for this part (multi-part questions). */
  prompt?: string;
  answer: Answer;
  mistakes?: Mistake[];
};

export type Source = { title: string; detail?: string; url?: string };

/** A diagram in the worked solution, shown where the solution text has ![](figure:<id>). */
export type SolutionFigure = { id: string; svg: string; alt: string; caption?: string };

/** The built-in interactive widgets (see lib/daily/widgets.ts for each kind's params). */
export type WidgetKind = 'step2' | 'step1' | 'bode2';

/**
 * An interactive simulator in the worked solution, shown where the solution text
 * has ![](widget:<id>). The pack only picks a built-in kind and its starting
 * numbers; the site draws it. `ranges` overrides a slider's [min, max].
 */
export type SolutionWidget = { id: string; kind: WidgetKind; params: Record<string, number>; ranges?: Record<string, [number, number]>; caption?: string };

export type Question = {
  id: string;
  track: Track;
  topic: string;
  /** 1 (warm-up) … 5 (PE-level). */
  difficulty: number;
  title: string;
  /** Markdown with $math$. */
  prompt: string;
  /** Optional diagram as SVG markup (shown as an image, so it can't run anything). */
  figure?: string;
  figureAlt?: string;
  parts: Part[];
  hints?: string[];
  /** The full worked solution (markdown with math). */
  solution: string;
  /** Diagrams for the solution (SVG, shown as images); each is placed by ![](figure:<id>) in `solution`. */
  solutionFigures?: SolutionFigure[];
  /** Interactive simulators for the solution; each is placed by ![](widget:<id>) in `solution`. */
  solutionWidgets?: SolutionWidget[];
  sources: Source[];
  /** Ids of the day's formulas this question uses. */
  formulas?: string[];
  /** How the answer was verified (admin only). */
  check?: string;
};

export type Formula = { id: string; name: string; latex: string; source: string; note?: string };

export type DailyDay = {
  date: string; // YYYY-MM-DD
  /** A multi-part harder problem (Fridays). */
  boss?: boolean;
  core: Question;
  bonus: Question[];
  formulas: Formula[];
  /** One formula worth knowing, shown on its own card. */
  formulaOfTheDay?: Formula;
};

/**
 * Practice-only questions: not tied to a day, they top up the Practice tab
 * (the weekly generator aims them at topics people find hard).
 */
export type PracticeSet = {
  formulas: Formula[];
  questions: Question[];
  /** The day each question was first uploaded, by id (set by the server, not the pack). */
  added?: Record<string, string>;
};

/** What gets uploaded: any number of days, and optionally practice questions. */
export type DailyPack = { version: 1; days: DailyDay[]; practice?: PracticeSet };

/** What a problem report can be about. */
export const REPORT_KINDS = ['wrong-answer', 'unclear', 'units', 'typo', 'figure', 'source', 'other'] as const;
export const REPORT_LABEL: Record<(typeof REPORT_KINDS)[number], string> = {
  'wrong-answer': 'The answer key is wrong',
  unclear: 'The question is unclear',
  units: 'Units are wrong or missing',
  typo: 'Typo',
  figure: 'The figure is wrong',
  source: 'A source is wrong',
  other: 'Something else',
};

/** The answer a user sends for one part. */
export type PartResponse =
  | { type: 'numeric'; value: number }
  | { type: 'choice'; option: number }
  | { type: 'multi'; options: number[] }
  | { type: 'range'; min: number | null; max: number | null }
  | { type: 'coefficients'; numerator: number[]; denominator: number[] }
  | { type: 'order'; items: string[] };
