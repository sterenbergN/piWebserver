import type { ProcessDef, ProcessId } from '../model';
import { CUSTOM } from './custom';
import { DRUM } from './drum';
import { FEEDER } from './feeder';
import { FLOW } from './flow';
import { HX } from './hx';
import { STIRRED } from './stirred';
import { SURGE } from './surge';
import { TANK } from './tank';

/** In ladder order: where PID wins first, then the escalations, then your own plant. */
export const PROCESSES: ProcessDef[] = [FLOW, STIRRED, SURGE, TANK, HX, FEEDER, DRUM, CUSTOM];

export const isProcessId = (v: unknown): v is ProcessId => PROCESSES.some((p) => p.id === v);

export function getProcess(id: ProcessId): ProcessDef {
  return PROCESSES.find((p) => p.id === id) ?? FLOW;
}
