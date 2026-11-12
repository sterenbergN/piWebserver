// Runs a test on drifted plants off the page's thread, one plant at a time, posting each result
// as it comes so the page can draw them while the rest run.
import type { ControllerConfig } from '@/lib/loop-lab/controllers';
import { driftedPlants, runDrifted } from '@/lib/loop-lab/drift';
import type { Params, ProcessId, Scenario } from '@/lib/loop-lab/model';
import { getProcess } from '@/lib/loop-lab/processes';

export type DriftRequest = { process: ProcessId; params: Params; controller: ControllerConfig; scenario: Scenario; samples: number };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<DriftRequest>) => void) | null; postMessage: (m: unknown) => void };

ctx.onmessage = (e) => {
  const { process, params, controller, scenario, samples } = e.data;
  try {
    const proc = getProcess(process);
    const plants = driftedPlants(proc, samples);
    plants.forEach((factors, i) => ctx.postMessage({ i, run: runDrifted(proc, params, controller, scenario, factors) }));
    ctx.postMessage({ done: true });
  } catch (err) {
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
