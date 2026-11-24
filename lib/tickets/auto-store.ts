import crypto from 'crypto';
import { updateJson } from '@/lib/json-store';
import { applyAutoIssue, fingerprintOf, isNoise, type AutoIssue } from './auto';
import { currentBuild, ticketsFile } from './store';
import { emptyTickets, normalizeTickets, type TicketsData } from './tickets';

// Filing the site's own tickets. Occurrences gather in memory for a few seconds and
// are written together, so a burst of the same error (every visitor hitting one bug)
// is one write with a count, not hundreds. Never throws: reporting a problem must
// not become a second problem.

const FLUSH_MS = 5000;
const MAX_PENDING = 200;

type Pending = { issue: AutoIssue; count: number };
const g = globalThis as unknown as { __autoTickets?: { pending: Map<string, Pending>; timer: NodeJS.Timeout | null } };
const state = (g.__autoTickets ??= { pending: new Map(), timer: null });

const newId = () => crypto.randomBytes(9).toString('base64url');

async function flush() {
  state.timer = null;
  const batch = [...state.pending.values()];
  state.pending.clear();
  if (!batch.length) return;
  try {
    await updateJson<TicketsData, void>(ticketsFile(), emptyTickets(), (stored) => {
      const { tickets } = normalizeTickets(stored);
      for (const { issue, count } of batch) applyAutoIssue(tickets, { ...issue, count }, new Date(), newId);
      stored.tickets = tickets;
    });
  } catch (error) {
    console.warn('Couldn’t file automatic tickets:', error instanceof Error ? error.message : error);
  }
}

/** Note a problem for its self-filed ticket. Fire and forget. */
export function recordAutoIssue(issue: AutoIssue) {
  try {
    if (issue.source === 'browser' && isNoise(issue.title)) return;
    const key = `${fingerprintOf(issue)}|${issue.build ?? ''}|${issue.page ?? ''}`;
    const pending = state.pending.get(key);
    if (pending) pending.count += 1;
    else if (state.pending.size < MAX_PENDING) state.pending.set(key, { issue, count: 1 });
    state.timer ??= setTimeout(() => void flush(), FLUSH_MS);
    state.timer.unref?.();
  } catch { /* never let reporting fail the caller */ }
}

/** The same, filling in the running build. */
export function recordServerIssue(issue: Omit<AutoIssue, 'build'>) {
  void currentBuild().then((build) => recordAutoIssue({ ...issue, build }), () => recordAutoIssue(issue));
}

/** A thrown error as a title and the first lines of its stack. */
export function describeError(error: unknown): { title: string; detail?: string } {
  if (error instanceof Error) {
    const frames = (error.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join('\n');
    return { title: `${error.name}: ${error.message}`.slice(0, 300), detail: frames || undefined };
  }
  return { title: String(error).slice(0, 300) };
}

/** For tests: write what's waiting now. */
export const flushAutoIssues = flush;
