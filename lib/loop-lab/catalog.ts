import { CONTROLLER_KINDS, type ControllerKind } from './controllers';
import { PROCESSES } from './processes';
import { encodeExperiment, type Experiment } from './setup';

// How the processes and controllers are grouped wherever they are listed.

/** What each controller does, in a line. */
export const KIND_HINT: Record<ControllerKind, string> = {
  onoff: 'Fully on below the setpoint, off above it.',
  pid: 'Proportional, integral and derivative action: the default.',
  schedule: 'A PID whose gains change with the operating point.',
  characterized: 'A PID on a straightened-out measurement or output.',
  feedforward: 'A PID plus action on measured disturbances, before they arrive.',
  cascade: 'A fast inner loop inside the main one.',
  smith: 'A PID that sees a prediction of the measurement, with the dead time taken out.',
  override: 'A normal controller and a limit controller on one valve; the higher (or lower) output wins.',
  ratio: 'The controlled flow follows the wild flow at a set ratio, trimmed by the main measurement.',
  statefb: 'Every state of the plant, estimated by an observer from the measurements, fed back with its own gain.',
  multiloop: 'A PID on each variable, each with its own valve, and optionally a decoupler between them.',
  mpc: 'Plans both valves a few moves ahead from a model, within their limits, and re-plans every cycle.',
  adaptive: 'A PI that keeps fitting a model to what it measures and retunes itself from it.',
  adrc: 'An observer estimates everything acting on the PV besides the output, and the law cancels it.',
  custom: 'Write the controller yourself, in Structured Text, and run it on the bench.',
};

/** The ladder, in the groups it climbs through. */
export const CONTROLLER_GROUPS: { label: string; kinds: ControllerKind[] }[] = [
  { label: 'The basics', kinds: ['onoff', 'pid'] },
  { label: 'PID with help', kinds: ['schedule', 'characterized', 'feedforward', 'cascade', 'smith'] },
  { label: 'Structures around PID', kinds: ['override', 'ratio'] },
  { label: 'Model-based', kinds: ['statefb', 'multiloop', 'mpc', 'adaptive', 'adrc'] },
  { label: 'Your own', kinds: ['custom'] },
];

export const metaOf = (kind: ControllerKind) => CONTROLLER_KINDS.find((c) => c.kind === kind)!;

export const PROCESS_GROUPS = [
  { label: 'Where PID is the answer', list: PROCESSES.filter((p) => p.family === 'pid-wins') },
  { label: 'Where PID falls short', list: PROCESSES.filter((p) => p.family === 'escalation' && p.id !== 'custom') },
  { label: 'Your own data', list: PROCESSES.filter((p) => p.id === 'custom') },
];

/** The bench, set up with an experiment and open on a view. */
export const benchLink = (e: Experiment, tab = 'tests') => `/loop-lab/bench?setup=${encodeExperiment(e)}#${tab}`;
/** The bench, on a process with its defaults. */
export const benchOn = (process: string) => `/loop-lab/bench?process=${process}`;
