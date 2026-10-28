import type { ProcessDef, ProcessId } from '../model';
import { FLOW } from './flow';
import { TANK } from './tank';

export const PROCESSES: ProcessDef[] = [FLOW, TANK];

export const isProcessId = (v: unknown): v is ProcessId => PROCESSES.some((p) => p.id === v);

export function getProcess(id: ProcessId): ProcessDef {
  return PROCESSES.find((p) => p.id === id) ?? FLOW;
}
