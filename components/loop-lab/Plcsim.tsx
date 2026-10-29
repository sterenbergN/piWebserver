'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { controllerMeta } from '@/lib/loop-lab/controllers';
import { exportSilKit, SIL_DB, SIL_FC } from '@/lib/loop-lab/export';
import type { ProcessDef } from '@/lib/loop-lab/model';
import { BRIDGE_PORT, BridgeClient, attachRequest, plcController, type BridgeAttached, type BridgeHello, type BridgeStepped, type PlcStats } from '@/lib/loop-lab/plcsim';
import { runScenario, runScenarioExternal, type Run } from '@/lib/loop-lab/sim';
import type { Experiment } from '@/lib/loop-lab/setup';
import { fmt } from './Chart';
import { CodeBlock } from './Views';
import { TrendPanel } from './Results';

type Result = { plc: Run; ref: Run; stats: PlcStats; dCv: number; dPv: number; instance: string };

/** Largest difference between two traces of the same length. */
const maxDiff = (a: Float64Array, b: Float64Array) => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

/** Run the test scripts against the exported SCL on a virtual S7-1500 (PLCSIM Advanced, through the local bridge). */
export function PlcsimPanel({ proc, exp }: { proc: ProcessDef; exp: Experiment }) {
  const kit = useMemo(() => exportSilKit(proc, exp.controller, exp.params), [proc, exp.controller, exp.params]);
  const [port, setPort] = useState(BRIDGE_PORT);
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [hello, setHello] = useState<BridgeHello | null>(null);
  const [instance, setInstance] = useState('');
  const [scenarioId, setScenarioId] = useState(proc.scenarios[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => client?.close(), [client]);
  useEffect(() => { setScenarioId(proc.scenarios[0]?.id ?? ''); setResult(null); }, [proc]);

  const fileName = `LoopLab_${proc.tags.loop.replace('-', '_')}_${exp.controller.kind}.scl`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([kit.source], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const connect = async () => {
    setError(null);
    setBusy('Connecting…');
    try {
      const c = await BridgeClient.connect(`ws://localhost:${port}/`);
      c.onClose = () => { setClient(null); setHello(null); };
      const h = await c.hello();
      setClient(c);
      setHello(h);
      setInstance((cur) => (h.instances.some((i) => i.name === cur) ? cur : h.instances[0]?.name ?? ''));
    } catch (e) {
      setError(`${e instanceof Error ? e.message : String(e)}. Is the bridge running on this computer (tools/plcsim-bridge)?`);
    } finally { setBusy(null); }
  };

  const refresh = async () => {
    if (!client) return;
    try { const h = await client.hello(); setHello(h); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const run = async () => {
    const scenario = proc.scenarios.find((s) => s.id === scenarioId);
    if (!client || !scenario || !instance) return;
    setError(null);
    setResult(null);
    setBusy(`Attaching to ${instance}…`);
    const ctl = new AbortController();
    abort.current = ctl;
    let attached = false;
    try {
      const a = await client.request<BridgeAttached>(attachRequest(instance, kit.Ts, kit.signals), 120000);
      if (a.missing.length) {
        setError(`${instance} doesn't have ${a.missing.join(', ')}. Download the kit for this controller, generate its blocks in TIA Portal and download the PLC again.`);
        return;
      }
      attached = true;
      const stats: PlcStats = { steps: 0, late: 0, doubled: 0, plcTime: 0 };
      const setup = { params: exp.params, controller: exp.controller };
      const step = (values: number[], cycles: number) => client.request<BridgeStepped>({ op: 'step', values, cycles });
      const plc = await runScenarioExternal(proc, setup, scenario, plcController(step, kit.signals, stats),
        (done, total) => setBusy(`Running on ${instance}: cycle ${done} of ${total}`), ctl.signal);
      const ref = runScenario(proc, setup, scenario);
      setResult({ plc, ref, stats, dCv: maxDiff(plc.trace.cv, ref.trace.cv), dPv: maxDiff(plc.trace.pvTrue, ref.trace.pvTrue), instance });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (attached) await client.request({ op: 'detach' }).catch(() => undefined);
      abort.current = null;
      setBusy(null);
    }
  };

  const unit = proc.pv.unit;
  return (
    <div className="ll-card">
      <div className="ll-card-head"><h3>Run it on a PLC (PLCSIM Advanced)</h3><span className="ll-small">software in the loop</span></div>
      <p className="ll-note" style={{ marginTop: 0 }}>
        The same test scripts, with the controller running as compiled SCL on a virtual S7-1500 instead of in this page.
        The plant stays here; a small bridge on your PC steps the PLC one OB30 cycle at a time, so the run is exact however
        slow the round trip, and the PLC trace lands on top of the browser&apos;s.
      </p>
      <ol className="ll-list" style={{ fontSize: '0.88rem' }}>
        <li>
          Download the kit for this controller: <button className="ll-btn is-small" onClick={download}>{fileName}</button>{' '}
          One SCL source: the blocks from the export, the signals in a DB <code>&quot;{SIL_DB}&quot;</code>, the instance DBs with their start-up tuning, and an FC <code>&quot;{SIL_FC}&quot;</code>.
        </li>
        <li>In TIA Portal, on an S7-1500: add it under External source files, Generate blocks from source, and call <code>&quot;{SIL_FC}&quot;()</code> from a Cyclic interrupt OB (OB30) set to {fmt(kit.Ts * 1000, 4)} ms. Compile and download to a PLCSIM Advanced instance.</li>
        <li>Start the bridge on the same PC: <code>dotnet run -c Release</code> in <code>tools/plcsim-bridge</code> (see its README). Then connect below.</li>
      </ol>
      <details style={{ margin: '0.4rem 0 0.8rem' }}>
        <summary className="ll-small" style={{ cursor: 'pointer' }}>What the bridge writes and reads each cycle</summary>
        <CodeBlock label="Kit signals" code={kit.signals.map((s) => `"${SIL_DB}".${s.member.padEnd(12)} ${s.type.padEnd(5)} ${s.dir === 'in' ? '← written each cycle' : s.dir === 'out' ? '→ read each cycle' : '  internal'}${s.role ? `  (${s.role})` : ''}`).join('\n')} />
      </details>

      <div className="ll-fields is-3">
        <label className="ll-field">
          <span>Bridge port</span>
          <input type="number" value={port} min={1} max={65535} disabled={!!client} onChange={(e) => setPort(Number(e.target.value) || BRIDGE_PORT)} />
        </label>
        <label className="ll-field">
          <span>Instance</span>
          <select value={instance} disabled={!hello || !!busy} onChange={(e) => setInstance(e.target.value)}>
            {!hello && <option value="">(connect first)</option>}
            {hello && !hello.instances.length && <option value="">(none running)</option>}
            {hello?.instances.map((i) => <option key={i.name} value={i.name}>{i.name} · {i.state}</option>)}
          </select>
        </label>
        <label className="ll-field">
          <span>Test</span>
          <select value={scenarioId} disabled={!!busy} onChange={(e) => setScenarioId(e.target.value)}>
            {proc.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.7rem' }}>
        {!client
          ? <button className="ll-btn is-primary" onClick={connect} disabled={!!busy}>Connect to the bridge</button>
          : <>
              <button className="ll-btn is-primary" onClick={run} disabled={!!busy || !instance}>Run on {instance || 'the PLC'}</button>
              {busy && abort.current && <button className="ll-btn" onClick={() => abort.current?.abort()}>Stop</button>}
              <button className="ll-btn" onClick={refresh} disabled={!!busy}>Refresh instances</button>
              <button className="ll-btn" onClick={() => client.close()} disabled={!!busy}>Disconnect</button>
            </>}
        <span className="ll-small" role="status">
          {busy ?? (hello ? `Bridge connected: ${hello.mock ? 'mock PLC (no PLCSIM)' : `PLCSIM Advanced API ${hello.api}`}` : '')}
        </span>
      </div>
      {error && <p className="ll-note" role="alert" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}

      {result && (
        <div style={{ marginTop: '0.9rem' }}>
          <TrendPanel proc={proc} showMeasured={false} entries={[
            { label: `${controllerMeta(exp.controller.kind).short} in the browser`, color: 'var(--habit-1)', run: result.ref },
            { label: `SCL on ${result.instance}`, color: 'var(--habit-2)', run: result.plc },
          ]} />
          <p className="ll-note">
            {result.stats.steps} PLC cycles, {fmt(result.stats.plcTime, 4)} s of PLC time.
            Largest difference from the browser: {fmt(result.dCv, 3)} % in the output, {fmt(result.dPv, 3)} {unit} in the {proc.pv.label.toLowerCase()}.{' '}
            {hello?.mock
              ? 'The mock PLC holds the valve where manual left it: this checks the connection, not the code.'
              : result.dCv < 0.5
                ? 'The SCL does what the browser does (the PLC works in 32-bit REAL, hence the small rest).'
                : 'They differ: settings changed since the kit was downloaded, or the PLC code isn’t the same algorithm. Download the kit again and compare.'}
            {result.stats.late > 0 && ` OB30 drifted ${result.stats.late} time${result.stats.late > 1 ? 's' : ''}; the bridge waited for it and re-centred.`}
          </p>
        </div>
      )}
    </div>
  );
}
