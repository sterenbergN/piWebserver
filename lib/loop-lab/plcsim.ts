import { SIL_COUNTER, SIL_DB, type SilRole, type SilSignal } from './export';
import type { ExternalController, ExternalInputs } from './sim';

// The browser side of the PLCSIM Advanced bridge (tools/plcsim-bridge): a small
// program on the engineering PC that drives a virtual S7-1500 through the
// PLCSIM Advanced API and talks to this page over a WebSocket on localhost.
//
// Lock-step: the plant here waits at each cycle while the bridge writes the
// readings into "LoopLab_IO", lets the virtual PLC run one OB30 period of
// virtual time (so "LoopLab_Cycle" runs exactly once), and reads the valve
// signals back. The PLC's clock only moves when the plant's does.
//
// Protocol (JSON text frames, every request carries an id the reply echoes):
//   → { op: 'hello' }                       ← { op: 'hello', bridge, version, api, mock, instances: [{ name, state }] }
//   → { op: 'attach', instance, ts, write: [{ tag, type, role }], read: [{ tag, type, role }], counter }
//                                           ← { op: 'attached', instance, cpu, state, missing: [tag], counter: bool }
//   → { op: 'step', cycles, values: [..] }  ← { op: 'stepped', values: [..], ran, late, time }
//   → { op: 'detach' }                      ← { op: 'detached' }
//   any failure                             ← { op: 'error', message }

export const BRIDGE_PORT = 8765;
export const BRIDGE_VERSION = 1;

export type BridgeInstance = { name: string; state: string };
export type BridgeHello = { op: 'hello'; bridge: string; version: number; api: string; mock: boolean; instances: BridgeInstance[] };
export type BridgeAttached = { op: 'attached'; instance: string; cpu: string; state: string; missing: string[]; counter: boolean };
export type BridgeStepped = { op: 'stepped'; values: number[]; ran: number; late: boolean; time: number };

/** The bridge's name for a member of the signal DB. */
export const silTag = (member: string) => `"${SIL_DB}".${member}`;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class BridgeClient {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  onClose?: () => void;

  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      let msg: { id?: number; op?: string; message?: string };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!p) return;
      this.pending.delete(msg.id!);
      if (msg.op === 'error') p.reject(new Error(msg.message ?? 'The bridge reported an error'));
      else p.resolve(msg);
    };
    ws.onclose = () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('The bridge closed the connection'));
      this.pending.clear();
      this.onClose?.();
    };
  }

  static connect(url = `ws://localhost:${BRIDGE_PORT}/`, timeoutMs = 3000): Promise<BridgeClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); return; }
      const timer = setTimeout(() => { ws.close(); reject(new Error(`No bridge answering at ${url}`)); }, timeoutMs);
      ws.onopen = () => { clearTimeout(timer); resolve(new BridgeClient(ws)); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`No bridge answering at ${url}`)); };
    });
  }

  get open() { return !this.closed; }

  request<T>(msg: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Not connected to the bridge'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`The bridge did not answer '${String(msg.op)}' within ${timeoutMs / 1000} s`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  hello() { return this.request<BridgeHello>({ op: 'hello' }); }

  close() { this.closed = true; this.ws.close(); }
}

/** What the bridge needs to know to attach: which members to write and read, in a fixed order. */
export function attachRequest(instance: string, Ts: number, signals: SilSignal[]) {
  const io = (dir: 'in' | 'out') => signals.filter((s) => s.dir === dir).map((s) => ({ tag: silTag(s.member), type: s.type, role: s.role }));
  return { op: 'attach', instance, ts: Ts, write: io('in'), read: io('out'), counter: silTag(SIL_COUNTER) };
}

/** The value the plant gives a signal this cycle. */
export function roleValue(role: SilRole, x: ExternalInputs): number {
  switch (role) {
    case 'sp': return x.sp;
    case 'pv': return x.pv;
    case 'pv2': return x.pv2;
    case 'sp2': return x.sp2;
    case 'manual': return x.auto ? 0 : 1;
    case 'manualOut': return x.manualOut;
    case 'manualOut2': return x.manualOut2;
    case 'cv': case 'cv2': return NaN;
    default: return x.d[role.slice(2)] ?? 0;
  }
}

export type PlcStats = { steps: number; late: number; doubled: number; plcTime: number };

/** How many cycles the PLC spends in manual at the start, tracking the plant before the test begins. */
export const WARMUP_CYCLES = 5;

/**
 * The PLC as the loop's controller. `step` is one round trip to the bridge:
 * write the readings, run a cycle, read the outputs (in the order given at attach).
 */
export function plcController(step: (values: number[], cycles: number) => Promise<BridgeStepped>, signals: SilSignal[], stats: PlcStats): ExternalController {
  const writes = signals.filter((s) => s.dir === 'in');
  const reads = signals.filter((s) => s.dir === 'out');
  const iCv = reads.findIndex((s) => s.role === 'cv');
  const iCv2 = reads.findIndex((s) => s.role === 'cv2');
  const run = async (values: number[], cycles: number) => {
    const r = await step(values, cycles);
    stats.steps++;
    if (r.late) stats.late++;
    if (r.ran > cycles) stats.doubled++;
    stats.plcTime = r.time;
    return r;
  };
  return {
    async start(x, valve, valve2) {
      // Manual at the plant's steady state: every block tracks, so the switch to auto is bumpless.
      const held = { ...x, auto: false, manualOut: valve, manualOut2: valve2 };
      await run(writes.map((s) => roleValue(s.role!, held)), WARMUP_CYCLES);
    },
    async cycle(x) {
      const r = await run(writes.map((s) => roleValue(s.role!, x)), 1);
      return { cv: iCv >= 0 ? r.values[iCv] : NaN, cv2: iCv2 >= 0 ? r.values[iCv2] : undefined };
    },
  };
}
