import { cleanController, defaultController, type ControllerConfig } from './controllers';
import { cleanParams, defaultParams, type Params, type ProcessId } from './model';
import { getProcess, isProcessId } from './processes';

// An experiment: a process with its parameters and a controller. Shared as a
// link (?setup=…) and saved in the notebook.

export type Experiment = { process: ProcessId; params: Params; controller: ControllerConfig };

export function defaultExperiment(process: ProcessId = 'flow'): Experiment {
  const proc = getProcess(process);
  return { process, params: defaultParams(proc), controller: defaultController('pid', proc) };
}

export function cleanExperiment(raw: unknown): Experiment | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r || !isProcessId(r.process)) return null;
  const proc = getProcess(r.process);
  return { process: proc.id, params: cleanParams(proc, r.params), controller: cleanController(r.controller, proc) };
}

// base64url of the JSON, so a setup fits in a link.
export function encodeExperiment(e: Experiment) {
  const bytes = new TextEncoder().encode(JSON.stringify(e));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeExperiment(s: string): Experiment | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return cleanExperiment(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

// ─── Notebook ───────────────────────────────────────────────────────────────

export type ScoreSummary = {
  iae: number; worstOvershoot: number; worstSettling: number; worstPeak: number; worstRecovery: number;
  travel: number; cvActivity: number; worstPm: number; worstMs: number;
};

export type NotebookEntry = {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  experiment: Experiment;
  summary: ScoreSummary | null;
};

export const NOTEBOOK_LIMIT = 200;

const SUMMARY_KEYS: (keyof ScoreSummary)[] = ['iae', 'worstOvershoot', 'worstSettling', 'worstPeak', 'worstRecovery', 'travel', 'cvActivity', 'worstPm', 'worstMs'];

function cleanSummary(raw: unknown): ScoreSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // JSON has no Infinity: null stands for "never settled" and the like.
  return Object.fromEntries(SUMMARY_KEYS.map((k) => [k, r[k] === null ? Infinity : Number(r[k]) || 0])) as ScoreSummary;
}

export function toJsonSummary(s: ScoreSummary) {
  return Object.fromEntries(SUMMARY_KEYS.map((k) => [k, Number.isFinite(s[k]) ? s[k] : null]));
}

export function cleanEntry(raw: unknown): NotebookEntry | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;
  const experiment = cleanExperiment(r.experiment);
  if (!experiment || typeof r.id !== 'string' || !/^[\w-]{1,40}$/.test(r.id)) return null;
  return {
    id: r.id,
    name: String(r.name ?? '').slice(0, 120) || 'Untitled',
    note: String(r.note ?? '').slice(0, 2000),
    createdAt: typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : new Date().toISOString(),
    experiment,
    summary: cleanSummary(r.summary),
  };
}

export function cleanNotebook(raw: unknown): NotebookEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(cleanEntry).filter((e): e is NotebookEntry => !!e).slice(0, NOTEBOOK_LIMIT);
}

export function serializeEntry(e: NotebookEntry) {
  return { ...e, summary: e.summary ? toJsonSummary(e.summary) : null };
}
