// Everything the history page works out from the commit list. Pure, so it can be tested.
import { SUPPORT_AREAS } from './areas.mjs';
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
