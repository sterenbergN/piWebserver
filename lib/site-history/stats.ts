// Everything the history page works out from the commit list. Pure, so it can be tested.
import { SUPPORT_AREAS, areaForPath } from './areas.mjs';
import type { HistoryCommit, HistoryData } from './types';

const DAY_MS = 86_400_000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dayOf = (c: HistoryCommit) => c.d.slice(0, 10);
const dayNum = (day: string) => Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / DAY_MS);
const fromDayNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Days between two "YYYY-MM-DD" strings. */
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);
/** The Monday on or before a day. */
export function weekStart(day: string) {
  const n = dayNum(day);
  const dow = (n + 3) % 7; // 1970-01-01 was a Thursday: Monday = 0
  return fromDayNum(n - dow);
}
export function formatDay(day: string, withYear = false) {
  const m = SHORT_MONTHS[+day.slice(5, 7) - 1];
  return `${m} ${+day.slice(8, 10)}${withYear ? `, ${day.slice(0, 4)}` : ''}`;
}
export const isSiteArea = (a: string) => !SUPPORT_AREAS.includes(a);

// ---- headline numbers ----

export interface Summary {
  commits: number;
  firstDay: string;
  lastDay: string;
  daysSinceFirst: number;
  activeDays: number;
  added: number;
  removed: number;
  net: number;
  areas: number;
  busiestWeek: { start: string; commits: number } | null;
}

export function summarize(commits: HistoryCommit[], today: string): Summary {
  const days = new Set<string>();
  const weeks = new Map<string, number>();
  const areas = new Set<string>();
  let added = 0;
  let removed = 0;
  for (const c of commits) {
    const day = dayOf(c);
    days.add(day);
    const w = weekStart(day);
    weeks.set(w, (weeks.get(w) ?? 0) + 1);
    added += c.ad;
    removed += c.de;
    for (const a of c.a) if (isSiteArea(a)) areas.add(a);
  }
  let busiest: Summary['busiestWeek'] = null;
  for (const [start, n] of weeks) if (!busiest || n > busiest.commits) busiest = { start, commits: n };
  const firstDay = commits.length ? dayOf(commits[0]) : today;
  const lastDay = commits.length ? dayOf(commits[commits.length - 1]) : today;
  return {
    commits: commits.length,
    firstDay,
    lastDay,
    daysSinceFirst: Math.max(0, daysBetween(firstDay, today)),
    activeDays: days.size,
    added,
    removed,
    net: added - removed,
    areas: areas.size,
    busiestWeek: busiest,
  };
}

// ---- heatmap ----

export interface HeatCell { day: string; count: number }
export interface Heatmap {
  /** Columns are weeks (oldest first); each has seven rows, Monday first, null outside the range. */
  weeks: (HeatCell | null)[][];
  max: number;
  /** [column, "Oct"] where a new month starts. */
  months: [number, string][];
}

export function heatmap(commits: HistoryCommit[]): Heatmap {
  if (!commits.length) return { weeks: [], max: 0, months: [] };
  const counts = new Map<string, number>();
  for (const c of commits) counts.set(dayOf(c), (counts.get(dayOf(c)) ?? 0) + 1);
  const first = dayOf(commits[0]);
  const last = dayOf(commits[commits.length - 1]);
  const start = dayNum(weekStart(first));
  const end = dayNum(last);
  const weeks: (HeatCell | null)[][] = [];
  const months: [number, string][] = [];
  let max = 0;
  let seenMonth = '';
  for (let n = start; n <= end; n += 7) {
    const col: (HeatCell | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const day = fromDayNum(n + i);
      if (n + i < dayNum(first) || n + i > end) { col.push(null); continue; }
      const count = counts.get(day) ?? 0;
      if (count > max) max = count;
      col.push({ day, count });
    }
    const firstReal = col.find(Boolean);
    if (firstReal) {
      const ym = firstReal.day.slice(0, 7);
      if (ym !== seenMonth) { seenMonth = ym; months.push([weeks.length, SHORT_MONTHS[+ym.slice(5, 7) - 1]]); }
    }
    weeks.push(col);
  }
  return { weeks, max, months };
}

// ---- code size over time ----

export interface SizePoint { day: string; loc: number }

/** Net lines of code at the end of each day that had commits. */
export function sizeOverTime(commits: HistoryCommit[]): SizePoint[] {
  const out: SizePoint[] = [];
  let loc = 0;
  for (const c of commits) {
    loc += c.ad - c.de;
    const day = dayOf(c);
    if (out.length && out[out.length - 1].day === day) out[out.length - 1].loc = loc;
    else out.push({ day, loc });
  }
  return out;
}

/** Net lines of code once the commit at `index` has landed. */
export function sizeAt(commits: HistoryCommit[], index: number) {
  let loc = 0;
  for (let i = 0; i <= index && i < commits.length; i++) loc += commits[i].ad - commits[i].de;
  return loc;
}

// ---- areas ----

export interface AreaStat {
  name: string;
  count: number;
  born: string;
  last: string;
  /** Commits per time slice across the whole history. */
  spark: number[];
  support: boolean;
}

export function areaStats(commits: HistoryCommit[], slices = 24): AreaStat[] {
  if (!commits.length) return [];
  const first = dayNum(dayOf(commits[0]));
  const span = Math.max(1, dayNum(dayOf(commits[commits.length - 1])) - first + 1);
  const map = new Map<string, AreaStat>();
  for (const c of commits) {
    const day = dayOf(c);
    const slice = Math.min(slices - 1, Math.floor(((dayNum(day) - first) / span) * slices));
    for (const name of c.a) {
      let s = map.get(name);
      if (!s) { s = { name, count: 0, born: day, last: day, spark: new Array(slices).fill(0), support: !isSiteArea(name) }; map.set(name, s); }
      s.count++;
      s.last = day;
      s.spark[slice]++;
    }
  }
  return [...map.values()].sort((a, b) => Number(a.support) - Number(b.support) || b.count - a.count || a.name.localeCompare(b.name));
}

// ---- connections ----

export interface Pair { a: string; b: string; n: number }

/** How many commits touched each pair of site areas together (support areas left out). */
export function coChange(commits: HistoryCommit[]): Pair[] {
  const pairs = new Map<string, Pair>();
  for (const c of commits) {
    const areas = c.a.filter(isSiteArea).sort();
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        const key = `${areas[i]}|${areas[j]}`;
        const p = pairs.get(key);
        if (p) p.n++;
        else pairs.set(key, { a: areas[i], b: areas[j], n: 1 });
      }
    }
  }
  return [...pairs.values()].sort((x, y) => y.n - x.n || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

export interface GraphNode { name: string; count: number; x: number; y: number }

/**
 * A small fixed-iteration force layout, so the same input always draws the same picture.
 * Heavier edges pull their ends closer; all nodes push apart; a light pull to the middle.
 */
export function layoutGraph(nodes: { name: string; count: number }[], edges: Pair[], width: number, height: number): GraphNode[] {
  const n = nodes.length;
  const pad = 34;
  const cx = width / 2;
  const cy = height / 2;
  const pos = nodes.map((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2;
    return { ...node, x: cx + Math.cos(angle) * width * 0.3, y: cy + Math.sin(angle) * height * 0.3, vx: 0, vy: 0 };
  });
  const index = new Map(pos.map((p, i) => [p.name, i]));
  const maxW = Math.max(1, ...edges.map((e) => e.n));
  const ideal = Math.sqrt((width * height) / Math.max(1, n)) * 0.75;
  for (let step = 0; step < 300; step++) {
    const cool = 1 - step / 300;
    for (const p of pos) { p.vx = 0; p.vy = 0; }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = 0.01 * (i + 1); dy = 0.01; d = Math.hypot(dx, dy); }
        const f = (ideal * ideal) / d;
        pos[i].vx += (dx / d) * f; pos[i].vy += (dy / d) * f;
        pos[j].vx -= (dx / d) * f; pos[j].vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const i = index.get(e.a);
      const j = index.get(e.b);
      if (i === undefined || j === undefined) continue;
      const dx = pos[i].x - pos[j].x;
      const dy = pos[i].y - pos[j].y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / ideal) * (0.3 + (0.7 * e.n) / maxW);
      pos[i].vx -= (dx / d) * f; pos[i].vy -= (dy / d) * f;
      pos[j].vx += (dx / d) * f; pos[j].vy += (dy / d) * f;
    }
    for (const p of pos) {
      p.vx += (cx - p.x) * 0.6;
      p.vy += (cy - p.y) * 0.6;
      const speed = Math.hypot(p.vx, p.vy) || 1;
      const move = Math.min(speed, 12 * cool + 0.5);
      p.x = Math.min(width - pad, Math.max(pad, p.x + (p.vx / speed) * move));
      p.y = Math.min(height - pad, Math.max(pad, p.y + (p.vy / speed) * move));
    }
  }
  return pos.map((p) => ({ name: p.name, count: p.count, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}

// ---- timeline ----

export interface WeekGroup { start: string; label: string; commits: HistoryCommit[] }
export interface MonthGroup { key: string; label: string; count: number; weeks: WeekGroup[] }

/** Newest month first, and inside it newest week first; commits newest first. */
export function groupTimeline(commits: HistoryCommit[]): MonthGroup[] {
  const months = new Map<string, MonthGroup>();
  for (const c of [...commits].reverse()) {
    const day = dayOf(c);
    const key = day.slice(0, 7);
    let m = months.get(key);
    if (!m) { m = { key, label: `${MONTH_NAMES[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`, count: 0, weeks: [] }; months.set(key, m); }
    m.count++;
    const start = weekStart(day);
    let w = m.weeks.find((x) => x.start === start);
    if (!w) { w = { start, label: `Week of ${formatDay(start)}`, commits: [] }; m.weeks.push(w); }
    w.commits.push(c);
  }
  return [...months.values()];
}

export function filterCommits(commits: HistoryCommit[], area: string | null, query: string) {
  const q = query.trim().toLowerCase();
  if (!area && !q) return commits;
  return commits.filter((c) =>
    (!area || c.a.includes(area)) &&
    (!q || c.s.toLowerCase().includes(q) || (c.b ?? '').toLowerCase().includes(q) || c.a.some((a) => a.toLowerCase().includes(q))));
}

// ---- checkpoints ----

export interface CheckpointView {
  index: number;
  label: string;
  kind: string;
  hash: string;
  day: string;
  loc: number;
  commitNumber: number;
  routes: string[];
  added: string[];
  removed: string[];
}

export function checkpointView(data: HistoryData, i: number): CheckpointView | null {
  const cp = data.checkpoints[i];
  if (!cp) return null;
  const commit = data.commits[cp.c];
  const routes = cp.r.map((r) => data.routes[r]).filter(Boolean).sort();
  const before = new Set((data.checkpoints[i - 1]?.r ?? []).map((r) => data.routes[r]));
  const now = new Set(routes);
  return {
    index: i,
    label: cp.label,
    kind: cp.kind,
    hash: commit.h,
    day: dayOf(commit),
    loc: sizeAt(data.commits, cp.c),
    commitNumber: cp.c + 1,
    routes,
    added: i === 0 ? [] : routes.filter((r) => !before.has(r)),
    removed: i === 0 ? [] : [...before].filter((r) => !now.has(r)).sort(),
  };
}

export const commitUrl = (repo: string | null, hash: string) => (repo ? `${repo}/commit/${hash}` : null);
export const treeUrl = (repo: string | null, hash: string) => (repo ? `${repo}/tree/${hash}` : null);

/** 12345 -> "12.3k". */
export function compact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---- story: growth, milestones, focus, rhythm ----

const minuteOf = (c: HistoryCommit) => dayNum(dayOf(c)) * 1440 + Number(c.d.slice(11, 13)) * 60 + Number(c.d.slice(14, 16));

export interface GrowthPoint {
  day: string;
  /** Lines of code at the end of the day. */
  loc: number;
  /** Pages at the end of the day, from the latest checkpoint at or before it. */
  pages: number;
  /** Commits so far, and on this day. */
  total: number;
  commits: number;
}

/** One point per day with commits: code size, page count and commit count as they stood that evening. */
export function growth(data: HistoryData): GrowthPoint[] {
  const pagesAt = new Array<number>(data.commits.length).fill(0);
  const cps = [...data.checkpoints].sort((a, b) => a.c - b.c);
  let k = -1;
  for (let i = 0; i < data.commits.length; i++) {
    while (k + 1 < cps.length && cps[k + 1].c <= i) k++;
    pagesAt[i] = k >= 0 ? cps[k].r.length : 0;
  }
  const out: GrowthPoint[] = [];
  let loc = 0;
  data.commits.forEach((c, i) => {
    loc += c.ad - c.de;
    const day = dayOf(c);
    const last = out[out.length - 1];
    if (last && last.day === day) { last.loc = loc; last.pages = pagesAt[i]; last.total = i + 1; last.commits++; }
    else out.push({ day, loc, pages: pagesAt[i], total: i + 1, commits: 1 });
  });
  return out;
}

export interface Milestone { area: string; day: string; index: number; loc: number; count: number }

/** The commit where each site area first appeared, oldest first, with the code size then and the area's lifetime commits. */
export function milestones(commits: HistoryCommit[]): Milestone[] {
  const counts = new Map<string, number>();
  for (const c of commits) for (const a of c.a) counts.set(a, (counts.get(a) ?? 0) + 1);
  const out: Milestone[] = [];
  const seen = new Set<string>();
  let loc = 0;
  commits.forEach((c, i) => {
    loc += c.ad - c.de;
    for (const a of c.a) {
      if (seen.has(a) || !isSiteArea(a)) continue;
      seen.add(a);
      out.push({ area: a, day: dayOf(c), index: i, loc, count: counts.get(a) ?? 0 });
    }
  });
  return out;
}

/** Site areas by commits, busiest first (ties by name). */
export function topSiteAreas(commits: HistoryCommit[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const c of commits) for (const a of c.a) if (isSiteArea(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, n).map(([a]) => a);
}

/**
 * Colours for the busiest site areas, from the site's eight-colour chart palette. Everything else
 * stays neutral: past eight, hues stop being tellable apart. They're handed out in the order the
 * areas appeared, so stacked bands (also in birth order) sit next to their palette neighbours.
 */
export function areaPalette(commits: HistoryCommit[], n = 8): Record<string, string> {
  const top = new Set(topSiteAreas(commits, n));
  const born = milestones(commits).filter((m) => top.has(m.area));
  return Object.fromEntries(born.map((m, i) => [m.area, `var(--habit-${i + 1})`]));
}

export interface AreaWeeks {
  /** Every Monday from the first commit's week to the last, empty weeks included. */
  weeks: string[];
  /** Bottom band first. Values are commits, each shared evenly between the areas it touched. */
  series: { name: string; values: number[]; total: number }[];
  totals: number[];
}

/** Commits per week for each of `keep` (in that order), with everything else folded into one band on top. */
export function weeklyByArea(commits: HistoryCommit[], keep: string[], otherName = 'Everything else'): AreaWeeks {
  if (!commits.length) return { weeks: [], series: [], totals: [] };
  const first = dayNum(weekStart(dayOf(commits[0])));
  const last = dayNum(weekStart(dayOf(commits[commits.length - 1])));
  const weeks: string[] = [];
  for (let n = first; n <= last; n += 7) weeks.push(fromDayNum(n));
  const names = [...keep, otherName];
  const rows = names.map(() => new Array<number>(weeks.length).fill(0));
  const totals = new Array<number>(weeks.length).fill(0);
  const slot = new Map(keep.map((a, i) => [a, i]));
  for (const c of commits) {
    const w = (dayNum(weekStart(dayOf(c))) - first) / 7;
    if (w < 0 || w >= weeks.length) continue;
    const areas = c.a.length ? c.a : ['Other'];
    for (const a of areas) rows[slot.get(a) ?? keep.length][w] += 1 / areas.length;
    totals[w]++;
  }
  const series = names.map((name, i) => ({ name, values: rows[i].map((v) => Math.round(v * 100) / 100), total: Math.round(rows[i].reduce((s, v) => s + v, 0)) }));
  return { weeks, series, totals };
}

export interface Runs {
  /** [first, last] index of each run worth drawing. */
  segments: [number, number][];
  /** Long quiet stretches between segments, and how many empty slots each left out. */
  breaks: { after: number; before: number; empty: number }[];
}

/** Splits a series at long runs of zeros (more than `maxEmpty` in a row), so a quiet summer doesn't take half the chart. */
export function collapseQuiet(values: number[], maxEmpty = 2): Runs {
  const segments: [number, number][] = [];
  const breaks: Runs['breaks'] = [];
  let start = -1;
  let lastBusy = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] <= 0) continue;
    if (start < 0) start = i;
    else if (i - lastBusy - 1 > maxEmpty) {
      segments.push([start, lastBusy]);
      breaks.push({ after: lastBusy, before: i, empty: i - lastBusy - 1 });
      start = i;
    }
    lastBusy = i;
  }
  if (start >= 0) segments.push([start, lastBusy]);
  return { segments, breaks };
}

export interface TimeAxis {
  /** 0..1 across the chart; quiet stretches are squeezed to a fixed width. */
  at: (day: string) => number;
  /** How much of the 0..1 width one ordinary day takes. */
  dayWidth: number;
  breaks: { from: string; to: string; days: number; pos: number }[];
}

/**
 * A time scale over the days that had work, where any gap longer than `maxGap` days is drawn
 * `gapWidth` days wide instead. Days inside a gap are placed proportionally across it.
 */
export function timeAxis(days: string[], maxGap = 14, gapWidth = 6): TimeAxis {
  const sorted = [...new Set(days)].sort();
  if (!sorted.length) return { at: () => 0, dayWidth: 0, breaks: [] };
  const nums = sorted.map(dayNum);
  const units = [0];
  const breaks: { from: string; to: string; days: number; u: number }[] = [];
  for (let i = 1; i < nums.length; i++) {
    const g = nums[i] - nums[i - 1];
    if (g > maxGap) {
      breaks.push({ from: sorted[i - 1], to: sorted[i], days: g, u: units[i - 1] + gapWidth / 2 });
      units.push(units[i - 1] + gapWidth);
    } else units.push(units[i - 1] + g);
  }
  const total = Math.max(1, units[units.length - 1]);
  const at = (day: string) => {
    const n = dayNum(day);
    if (n <= nums[0]) return 0;
    if (n >= nums[nums.length - 1]) return 1;
    let lo = 0;
    let hi = nums.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (nums[mid] <= n) lo = mid; else hi = mid; }
    const t = (n - nums[lo]) / Math.max(1, nums[hi] - nums[lo]);
    return (units[lo] + t * (units[hi] - units[lo])) / total;
  };
  return { at, dayWidth: 1 / total, breaks: breaks.map((b) => ({ from: b.from, to: b.to, days: b.days, pos: b.u / total })) };
}

export interface Streak { start: string; end: string; days: number }

/** The longest run of days in a row with commits, and the run still going (ending today or yesterday). */
export function streaks(commits: HistoryCommit[], today: string): { longest: Streak | null; current: Streak | null } {
  const days = [...new Set(commits.map(dayOf))].sort();
  let longest: Streak | null = null;
  let run: Streak | null = null;
  for (const day of days) {
    if (run && daysBetween(run.end, day) === 1) run = { start: run.start, end: day, days: run.days + 1 };
    else run = { start: day, end: day, days: 1 };
    if (!longest || run.days > longest.days) longest = run;
  }
  const current = run && daysBetween(run.end, today) <= 1 ? run : null;
  return { longest, current };
}

export interface WorkSessions {
  sessions: number;
  /** Estimated minutes of work. */
  minutes: number;
  longest: { day: string; minutes: number; commits: number } | null;
}

/**
 * A rough guess at time spent: commits less than `gapMin` apart belong to one sitting, and each
 * sitting also gets `leadMin` for the work before its first commit. It can't see thinking time
 * or work that never got committed, so it's an estimate, and the page says so.
 */
export function workSessions(commits: HistoryCommit[], gapMin = 120, leadMin = 30): WorkSessions {
  const times = commits.map(minuteOf).sort((a, b) => a - b);
  if (!times.length) return { sessions: 0, minutes: 0, longest: null };
  let sessions = 0;
  let minutes = 0;
  let longest: WorkSessions['longest'] = null;
  let start = times[0];
  let prev = times[0];
  let n = 1;
  const close = () => {
    const len = prev - start + leadMin;
    sessions++;
    minutes += len;
    if (!longest || len > longest.minutes) longest = { day: fromDayNum(Math.floor(start / 1440)), minutes: len, commits: n };
  };
  for (let i = 1; i < times.length; i++) {
    if (times[i] - prev > gapMin) { close(); start = times[i]; n = 0; }
    prev = times[i];
    n++;
  }
  close();
  return { sessions, minutes, longest };
}

/** Commits by weekday (rows, Monday first) and hour (columns), in the author's local time. */
export function punchcard(commits: HistoryCommit[]): { grid: number[][]; max: number } {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const c of commits) {
    const dow = (dayNum(dayOf(c)) + 3) % 7;
    const h = Math.min(23, Number(c.d.slice(11, 13)) || 0);
    max = Math.max(max, ++grid[dow][h]);
  }
  return { grid, max };
}

export interface BigDay { day: string; commits: number; added: number; removed: number }

/** The `n` days with the most commits (at least `min`), busiest first. */
export function bigDays(commits: HistoryCommit[], n = 5, min = 5): BigDay[] {
  const map = new Map<string, BigDay>();
  for (const c of commits) {
    const day = dayOf(c);
    let b = map.get(day);
    if (!b) { b = { day, commits: 0, added: 0, removed: 0 }; map.set(day, b); }
    b.commits++;
    b.added += c.ad;
    b.removed += c.de;
  }
  return [...map.values()].filter((b) => b.commits >= min).sort((a, b) => b.commits - a.commits || b.added - a.added || a.day.localeCompare(b.day)).slice(0, n);
}

// ---- wayback ----

export interface MapSection { key: string; label: string; area: string; pages: string[] }

/**
 * Pages grouped by their first path segment: "/study/anki" goes in "/study". `order` is every
 * route in the order it first appeared (data.routes), so sections and tiles keep their places
 * from one checkpoint to the next and new ones join at the end.
 */
export function siteMap(routes: string[], order: string[]): MapSection[] {
  const rank = new Map(order.map((r, i) => [r, i]));
  const pos = (r: string) => rank.get(r) ?? order.length;
  const sections = new Map<string, MapSection>();
  for (const r of [...routes].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b))) {
    const key = r.split('/')[1] ?? '';
    let s = sections.get(key);
    if (!s) {
      s = { key, label: key ? `/${key}` : 'Home', area: key ? areaForPath(`app/${key}/page.tsx`) : 'Navigation', pages: [] };
      sections.set(key, s);
    }
    s.pages.push(r);
  }
  return [...sections.values()];
}

/** "Gallery is born · Blog is born" -> "Gallery and Blog arrived"; month and end markers get short names. */
export function checkpointTitle(label: string, kind: string): string {
  const parts = label.split(' · ');
  const born = parts.map((p) => /^(.+) is born$/.exec(p)?.[1]).filter((x): x is string => !!x);
  if (born.length) {
    const names = born.length === 1 ? born[0] : `${born.slice(0, -1).join(', ')} and ${born[born.length - 1]}`;
    return `${names} arrived`;
  }
  if (kind === 'start') return 'First commit';
  if (kind === 'now') return 'Now';
  const month = parts.map((p) => /^Start of (.+)$/.exec(p)?.[1]).find(Boolean);
  return month ?? parts[0];
}
