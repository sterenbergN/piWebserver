// The shape of public/site-history.json, written by scripts/site-history.mjs.

export interface HistoryCommit {
  /** Short hash. */
  h: string;
  /** Author-local "YYYY-MM-DDTHH:MM" (a plain string so server and browser always agree). */
  d: string;
  /** Subject line. */
  s: string;
  /** Message body, cleaned and capped. */
  b?: string;
  /** Site areas it touched, strongest first. */
  a: string[];
  /** Code files changed. */
  f: number;
  /** Lines added / removed (code only: no lockfiles, data, images). */
  ad: number;
  de: number;
  /** Up to three of the biggest files it changed. */
  tf: string[];
}

export interface HistoryCheckpoint {
  /** Index into commits. */
  c: number;
  label: string;
  kind: 'start' | 'month' | 'area' | 'now';
  /** Indexes into routes: the pages that existed at this commit. */
  r: number[];
}

export interface HistoryData {
  v: 1;
  /** ISO time the file was made. */
  generated: string;
  /** GitHub URL when the repository is public, else null. */
  repo: string | null;
  /** True when the checkout was shallow, so history is partial. */
  shallow: boolean;
  routes: string[];
  commits: HistoryCommit[];
  checkpoints: HistoryCheckpoint[];
}
