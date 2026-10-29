'use client';

import { useEffect, useState } from 'react';
import { getProcess } from '@/lib/loop-lab/processes';
import { runAll, type Run } from '@/lib/loop-lab/sim';
import { scorecard, type Scorecard } from '@/lib/loop-lab/score';
import type { Experiment } from '@/lib/loop-lab/setup';

export type RunSet = { runs: Run[]; score: Scorecard };

// Runs are deterministic (seeded noise), so results are cached by setup.
const cache = new Map<string, RunSet>();
const CACHE_LIMIT = 40;

export function computeRuns(exp: Experiment, scenarioIds?: string[], robust = true): RunSet {
  const key = JSON.stringify([exp, scenarioIds ?? null, robust]);
  const hit = cache.get(key);
  if (hit) return hit;
  const proc = getProcess(exp.process);
  const runs = runAll(proc, { params: exp.params, controller: exp.controller }, scenarioIds);
  const result = { runs, score: scorecard(proc, exp.params, exp.controller, runs, robust) };
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}

/** Several experiments through the same tests (for comparisons and case studies). */
export function useRunsMany(exps: Experiment[], scenarioIds?: string[], robust = true, delay = 250) {
  const key = JSON.stringify([exps, scenarioIds ?? null, robust]);
  const [state, setState] = useState<{ key: string; results: RunSet[] }>({ key: '', results: [] });
  useEffect(() => {
    const cached = exps.every((e) => cache.has(JSON.stringify([e, scenarioIds ?? null, robust])));
    const id = window.setTimeout(() => {
      try {
        setState({ key, results: exps.map((e) => computeRuns(e, scenarioIds, robust)) });
      } catch {
        setState({ key, results: [] });
      }
    }, cached ? 0 : delay);
    return () => window.clearTimeout(id);
  }, [key, delay]);
  return { results: state.key === key ? state.results : null, busy: state.key !== key };
}

/**
 * Run an experiment through its test scripts after the inputs settle (so typing
 * a number doesn't run the tests on every keystroke).
 */
export function useRuns(exp: Experiment | null, scenarioIds?: string[], robust = true, delay = 250) {
  const [state, setState] = useState<{ key: string; result: RunSet | null; error: string }>({ key: '', result: null, error: '' });
  const key = exp ? JSON.stringify([exp, scenarioIds ?? null, robust]) : '';
  useEffect(() => {
    if (!exp) return;
    const id = window.setTimeout(() => {
      try {
        setState({ key, result: computeRuns(exp, scenarioIds, robust), error: '' });
      } catch (e) {
        setState({ key, result: null, error: e instanceof Error ? e.message : 'Simulation failed' });
      }
    }, cache.has(key) ? 0 : delay);
    return () => window.clearTimeout(id);
    // The key covers exp and scenarioIds.
  }, [key, delay]);
  return { result: state.result, busy: state.key !== key, error: state.error };
}
