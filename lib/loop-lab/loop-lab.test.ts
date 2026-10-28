import test from 'node:test';
import { strict as assert } from 'node:assert';
import { cexpj, cmul, cx, eig, expm, rng } from './linalg';
import { defaultParams, nominalDisturbances, toPct, valveCharacteristic, valveCharacteristicInverse } from './model';
import { getProcess } from './processes';
import { tankArea, tankVolume } from './processes/tank';
import { approximate, analyzeLoop, bode, closedLoop, isStable, linearizePlant, margins, stepResponse } from './linear';
import { DEFAULT_PID, cleanController, createController, defaultController, scheduledGains, type ControllerConfig } from './controllers';
import { Loop, runAll, runScenario } from './sim';
import { fitModel, parseTable } from './ident';
import { feedforwardDesign, tuningModel } from './tuning';
import { scorecard } from './score';
import { TUNING_RULES } from './tuning';
import { exportCode, pidCompactParams, real } from './export';
import { decodeExperiment, defaultExperiment, encodeExperiment } from './setup';

const close = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
const pid = (o: Partial<typeof DEFAULT_PID>): ControllerConfig => ({ kind: 'pid', pid: { ...DEFAULT_PID, ...o } });

test('eig: real, complex and stiff matrices', () => {
  const r = eig([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]).map((p) => p.re);
  [-1, -2, -3].forEach((v, i) => close(r[i], v, 1e-9));
  const c = eig([[0, 1], [-5, -2]]);
  close(c[0].re, -1, 1e-12);
  close(Math.abs(c[0].im), 2, 1e-12);
  const s = eig([[-1000, 1, 0], [0, -0.001, 1], [0, 0, -3]]).map((p) => p.re);
  close(s[0], -0.001, 1e-12);
  close(s[2], -1000, 1e-9);
});

test('expm matches the analytic second-order response', () => {
  const E = expm([[0, 1], [-5, -2]]);
  close(E[0][0], Math.exp(-1) * (Math.cos(2) + 0.5 * Math.sin(2)), 1e-12);
});

test('valve characteristics invert and run from 0 to 1', () => {
  for (const kind of [0, 1, 2]) {
    close(valveCharacteristic(kind, 0), 0, 1e-12);
    close(valveCharacteristic(kind, 1), 1, 1e-12);
    for (const s of [0.1, 0.5, 0.9]) close(valveCharacteristicInverse(kind, valveCharacteristic(kind, s)), s, 1e-12);
  }
});

test('tank geometry: volume integrates the area, a cylinder is πr²h', () => {
  const p = defaultParams(getProcess('tank'));
  let v = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) v += tankArea(((i + 0.5) / n) * 1.3, p) * (1.3 / n);
  close(tankVolume(1.3, p), v, 1e-6);
  close(tankVolume(1, { ...p, R: 0.5, r0: 0.5 }), Math.PI * 0.25, 1e-12);
});

test('linearized tank matches the hand derivation: τ = 2A√h/k, K = 2√h·Qmax/k', () => {
  const proc = getProcess('tank');
  const p = defaultParams(proc);
  for (const h of [0.4, 1, 1.6]) {
    const m = linearizePlant(proc, p, h);
    const k = (p.Kout * 0.5) / 3600; // m³/s per √m at the nominal 50 % outlet
    const tau = (2 * tankArea(h, p) * Math.sqrt(h)) / k;
    const slowest = 1 / Math.min(...m.poles.map((q) => -q.re));
    close(slowest, tau, tau * 1e-4, `τ at ${h} m`);
    // K in % of span per % valve: dh/dQin · Qmax/100 · 100/span
    const K = ((2 * Math.sqrt(h)) / k) * (p.Qmax / 3600 / 100) * (100 / 2);
    close(m.K, K, K * 1e-4, `K at ${h} m`);
  }
});

test('half-rule approximation keeps the slow pole and lumps the fast ones into dead time', () => {
  const proc = getProcess('tank');
  const p = defaultParams(proc);
  const f = approximate(linearizePlant(proc, p, 1), p.Ts / 2);
  close(f.theta, p.Ts / 2 + p.valveTau / 2 + p.txTau, 0.01);
  assert.ok(f.integrating);
});

test('margins of an integrator with dead time: PM = 90° − ωcθ, GM = π/(2θK)', () => {
  const K = 0.5, theta = 0.4;
  const ws = Array.from({ length: 2000 }, (_, i) => 1e-3 * 10 ** (i / 400));
  const m = margins(bode(ws, (w) => cmul(cx(K), { re: 0, im: -1 / w }), theta));
  close(m.pm, 90 - (K * theta * 180) / Math.PI, 0.05);
  close(10 ** (m.gm / 20), Math.PI / (2 * theta * K), 0.01);
});

test('closed loop: P control of a first-order plant settles at K·Kc/(1+K·Kc)', () => {
  const proc = getProcess('flow');
  const p = { ...defaultParams(proc), txDelay: 0 };
  const a = analyzeLoop(proc, p, pid({ Kc: 0.5, Ti: 0 }), 30)!;
  const cl = closedLoop(a.plant, a.ctrl, a.delay);
  assert.ok(isStable(cl.poles));
  const r = stepResponse(cl, 0, 30, 600);
  const KK = a.plant.K * 0.5;
  close(r.y[r.y.length - 1], KK / (1 + KK), 1e-3);
});

test('PI removes offset; the simulated flow loop reaches each setpoint', () => {
  const proc = getProcess('flow');
  const run = runScenario(proc, { params: { ...defaultParams(proc), txNoise: 0 }, controller: defaultController('pid', proc) }, proc.scenarios[0]);
  const last = run.trace.pvTrue.length - 1;
  close(run.trace.pvTrue[last], run.trace.sp[last], 0.05);
});

test('switching manual → auto is bumpless', () => {
  const proc = getProcess('flow');
  const loop = new Loop(proc, { params: { ...defaultParams(proc), txNoise: 0 }, controller: defaultController('pid', proc) }, { sp: 30 });
  for (let i = 0; i < 50; i++) loop.step();
  loop.setMode(false);
  loop.manualOut = 60;
  for (let i = 0; i < 100; i++) loop.step();
  const before = loop.step().cv;
  loop.setMode(true);
  const after = loop.step().cv;
  close(after, before, 1.5);
});

test('scheduled gains interpolate and hold flat outside the table', () => {
  const pts = [{ at: 0, Kc: 1, Ti: 10, Td: 0 }, { at: 1, Kc: 3, Ti: 30, Td: 0 }];
  close(scheduledGains(pts, 0.5).Kc, 2, 1e-12);
  close(scheduledGains(pts, -1).Kc, 1, 1e-12);
  close(scheduledGains(pts, 2).Ti, 30, 1e-12);
});

test('the PID block: P-only output is Kc × error in % of span', () => {
  const proc = getProcess('flow');
  const c = createController(proc, pid({ Kc: 2, Ti: 0, b: 1 }), defaultParams(proc), 0.1);
  const aux = { pv2: NaN, d: nominalDisturbances(proc) };
  c.track(50, 30, 30, aux);
  const u = c.step(33, 30, aux);
  close(u, 50 + 2 * (toPct(proc, 33) - toPct(proc, 30)), 1e-9);
});

test('anti-windup: no protection overshoots more after the tank supply returns', () => {
  const proc = getProcess('tank');
  const params = { ...defaultParams(proc), txNoise: 0 };
  const sc = proc.scenarios.find((s) => s.id === 'supply-fault')!;
  const peak = (antiWindup: 'clamp' | 'none') => {
    const r = runScenario(proc, { params, controller: pid({ Kc: 3, Ti: 245, antiWindup }) }, sc);
    return Math.max(...r.trace.pvTrue) - 1;
  };
  assert.ok(peak('none') > peak('clamp') + 0.02);
});

test('scorecard: on the flow loop PI beats on-off, PID buys little for a lot of valve travel', () => {
  const proc = getProcess('flow');
  const params = defaultParams(proc);
  const score = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }), false);
  const pi = score(defaultController('pid', proc));
  const onoff = score(defaultController('onoff', proc));
  const pidd = score(pid({ Kc: 0.6, Ti: 1.8, Td: 0.3 }));
  assert.ok(pi.iae < onoff.iae / 2);
  assert.ok(pidd.travel > pi.travel * 1.5);
});

test('scorecard: on the conical tank one PI tuning overshoots near the top, scheduling fixes it', () => {
  const proc = getProcess('tank');
  const params = defaultParams(proc);
  const ids = ['sp-range'];
  const base = defaultController('pid', proc);
  const sched: ControllerConfig = { kind: 'schedule', pid: { ...DEFAULT_PID, Kc: 3, Ti: 245 }, on: 'pv', points: [{ at: 0.4, Kc: 3, Ti: 245, Td: 0 }, { at: 1, Kc: 9.8, Ti: 245, Td: 0 }, { at: 1.6, Kc: 20, Ti: 245, Td: 0 }] };
  const a = scorecard(proc, params, base, runAll(proc, { params, controller: base }, ids), false);
  const b = scorecard(proc, params, sched, runAll(proc, { params, controller: sched }, ids), false);
  assert.ok(a.worstOvershoot > 10);
  assert.ok(b.worstOvershoot < 5);
});

test('tuning rules give positive, finite settings on both processes', () => {
  for (const id of ['flow', 'tank'] as const) {
    const proc = getProcess(id);
    const p = defaultParams(proc);
    const f = approximate(linearizePlant(proc, p, proc.nominalPv), p.Ts / 2);
    for (const rule of TUNING_RULES) for (const type of rule.types) {
      const t = rule.tune(f, type, f.theta * 3);
      assert.ok(t && t.Kc > 0 && t.Ti >= 0 && t.Td >= 0, `${rule.id} ${type} on ${id}`);
    }
  }
});

test('exports: SCL and Structured Text blocks, PID_Compact gain in engineering units', () => {
  const proc = getProcess('tank');
  const params = defaultParams(proc);
  for (const kind of ['onoff', 'pid', 'schedule', 'characterized'] as const) {
    const c = defaultController(kind, proc);
    const scl = exportCode(proc, c, params, 'scl');
    const st = exportCode(proc, c, params, 'st');
    assert.match(scl, /FUNCTION_BLOCK "LL_/);
    assert.match(scl, /BEGIN/);
    assert.doesNotMatch(st, /#\w/);
    assert.match(st, /END_FUNCTION_BLOCK/);
  }
  const rows = pidCompactParams(proc, defaultController('pid', proc), params)!;
  close(Number(rows.find((r) => r.name.endsWith('Gain'))!.value), (3 * 100) / 2, 1e-9);
  assert.equal(real(2), '2.0');
  assert.equal(real(0.00001234), '1.234E-5');
  assert.equal(real(-0.5), '-0.5');
});

test('experiments round-trip through a link and bad values are clamped', () => {
  const e = defaultExperiment('tank');
  assert.deepEqual(decodeExperiment(encodeExperiment(e)), e);
  assert.equal(decodeExperiment('not base64!'), null);
  const c = cleanController({ kind: 'pid', pid: { Kc: -5, Ti: 'x', antiWindup: 'bogus' } }, getProcess('flow'));
  assert.equal(c.kind, 'pid');
  if (c.kind === 'pid') {
    assert.equal(c.pid.Kc, 0);
    assert.equal(c.pid.antiWindup, 'clamp');
  }
});

test('delay phase is exact: e^{-jωθ} has unit gain', () => {
  const v = cexpj(-3);
  close(Math.hypot(v.re, v.im), 1, 1e-15);
});

// ─── Phase 2: feedforward, cascade, identification ─────────────────────────

const hxScore = (c: ControllerConfig, ids: string[]) => {
  const proc = getProcess('hx');
  const params = defaultParams(proc);
  return scorecard(proc, params, c, runAll(proc, { params, controller: c }, ids), false);
};

test('heat exchanger: cascade on steam flow all but removes steam pressure upsets', () => {
  const proc = getProcess('hx');
  const pi = hxScore(defaultController('pid', proc), ['steam-pressure']);
  const casc = hxScore(defaultController('cascade', proc), ['steam-pressure']);
  assert.ok(casc.worstPeak * 5 < pi.worstPeak, `cascade ${casc.worstPeak} vs PI ${pi.worstPeak}`);
});

test('heat exchanger: feedforward from the measured flow cuts flow upsets, and does nothing for steam pressure', () => {
  const proc = getProcess('hx');
  const pi = hxScore(defaultController('pid', proc), ['flow-upset', 'steam-pressure']);
  const ff = hxScore(defaultController('feedforward', proc), ['flow-upset', 'steam-pressure']);
  const by = (sc: typeof pi, id: string) => sc.tests.find((x) => x.scenarioId === id)!;
  assert.ok(by(ff, 'flow-upset').upsets.every((u, i) => u.peak * 2.5 < by(pi, 'flow-upset').upsets[i].peak));
  close(by(ff, 'steam-pressure').iae, by(pi, 'steam-pressure').iae, by(pi, 'steam-pressure').iae * 0.02);
});

test('feedforward design from the model matches the energy balance', () => {
  const proc = getProcess('hx');
  const p = defaultParams(proc);
  const ff = feedforwardDesign(proc, p, defaultController('pid', proc), 60, 'F')!;
  // Extra steam per m³/h: ρc_p·ΔT·3600/λ kg/h, as % of the valve's K_st·P_s.
  const expected = ((((1000 * 4.18) / 3600) * 40 * 3600) / p.lambda / (p.Kst * 4)) * 100;
  close(ff.gain, expected, expected * 0.05);
});

test('cascade: the inner loop model is the valve and flow transmitter, not the thermal lags', () => {
  const proc = getProcess('hx');
  const m = tuningModel(proc, defaultParams(proc), defaultController('cascade', proc), 60, 'inner');
  assert.ok(m.tau < 5 && m.theta < 2, `τ ${m.tau}, θ ${m.theta}`);
  const outer = tuningModel(proc, defaultParams(proc), defaultController('cascade', proc), 60, 'outer');
  assert.ok(outer.tau > 20);
});

test('cascade closed loop (linear) is stable and tracks the setpoint', () => {
  const proc = getProcess('hx');
  const a = analyzeLoop(proc, defaultParams(proc), defaultController('cascade', proc), 60)!;
  assert.ok(a.inner && Number.isFinite(a.inner.margins.pm) && Number.isFinite(a.margins.pm));
  const cl = closedLoop(a.plant, a.ctrl, a.delay);
  assert.ok(isStable(cl.poles));
  const r = stepResponse(cl, 0, 600, 600);
  close(r.y[r.y.length - 1], 1, 0.01);
});

test('feedforward with no lead-lag adds gain × the disturbance change at once', () => {
  const proc = getProcess('hx');
  const c = createController(proc, { kind: 'feedforward', pid: { ...DEFAULT_PID, Kc: 0, Ti: 0 }, ff: [{ from: 'F', gain: 5, lead: 0, lag: 0 }] }, defaultParams(proc), 0.5);
  const d = nominalDisturbances(proc);
  c.track(40, 60, 60, { pv2: NaN, d });
  close(c.step(60, 60, { pv2: NaN, d: { ...d, F: 12 } }), 40 + 5 * 2, 1e-9);
});

test('stirred tank: derivative buys margin, so PID can use a gain PI cannot', () => {
  const proc = getProcess('stirred');
  const params = defaultParams(proc);
  const score = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['feed-temp']), true);
  const piTight = score(pid({ Kc: 13.4, Ti: 373 }));
  const pidd = score(pid({ Kc: 13.4, Ti: 373, Td: 37.5, a: 0.5 }));
  const pi = score(defaultController('pid', proc));
  assert.ok(pidd.worstMs < piTight.worstMs - 0.3);
  assert.ok(pidd.worstPeak < pi.worstPeak * 0.8);
});

test('identification recovers a first-order-plus-dead-time process', () => {
  const r = rng(3);
  const dt = 0.5, K = 2, tau = 30, theta = 7;
  const t: number[] = [], u: number[] = [], y: number[] = [];
  let x = 0;
  const hist: number[] = [];
  for (let k = 0; k < 1200; k++) {
    const tt = k * dt;
    const uu = 40 + (tt > 50 ? 10 : 0) - (tt > 250 ? 20 : 0);
    t.push(tt); u.push(uu); hist.push(uu - 40);
    const ud = k >= theta / dt ? hist[k - theta / dt] : 0;
    x = Math.exp(-dt / tau) * x + (1 - Math.exp(-dt / tau)) * K * ud;
    y.push(30 + x + 0.1 * r.gauss());
  }
  const f = fitModel(t, u, y, 'fopdt')!;
  close(f.K, K, 0.03);
  close(f.tau1, tau, 1.5);
  close(f.theta, theta, 0.75);
  assert.ok(f.fit > 95);
});

test('CSV parsing: semicolons with decimal commas, a header row, and timestamps', () => {
  const a = parseTable('Trace\nTime [s];Output [%];TT-301 [°C]\n0,0;40,5;60,1\n0,5;41,0;60,2\n');
  assert.deepEqual(a.columns, ['Time [s]', 'Output [%]', 'TT-301 [°C]']);
  assert.deepEqual(a.rows[1], [0.5, 41, 60.2]);
  const b = parseTable('time,u,y\n2026-10-28 10:00:00,1,2\n2026-10-28 10:00:02,1,3\n');
  close(b.rows[1][0] - b.rows[0][0], 2, 1e-9);
});

test('an identified integrating plant runs its (scaled) tests and reaches the setpoint', () => {
  const proc = getProcess('custom');
  const params = { ...defaultParams(proc), integrating: 1, K: 0.5, tau1: 50, txDelay: 4, txNoise: 0 };
  const run = runScenario(proc, { params, controller: pid({ Kc: 4, Ti: 60 }) }, proc.scenarios[0]);
  assert.ok(run.scenario.duration > proc.scenarios[0].duration);
  const last = run.trace.pvTrue.length - 1;
  close(run.trace.pvTrue[last], run.trace.sp[last], 0.5);
});

test('exports: cascade has a master and a slave, feedforward a lead-lag block', () => {
  const proc = getProcess('hx');
  const params = defaultParams(proc);
  const base = defaultController('cascade', proc) as Extract<ControllerConfig, { kind: 'cascade' }>;
  const casc = exportCode(proc, { ...base, ff: [{ from: 'F', gain: 4, lead: 0, lag: 0 }] }, params, 'scl');
  assert.match(casc, /"FIC_301_DB"\(Setpoint := "SP2"/);
  assert.match(casc, /HoldIntegral := "FIC_301_DB".AtLimit/);
  assert.match(casc, /FUNCTION_BLOCK "LL_LeadLag"/);
  const st = exportCode(proc, defaultController('feedforward', proc), params, 'st');
  assert.match(st, /Feedforward := FF_F.Out \+ FF_Tin.Out/);
  assert.equal(pidCompactParams(proc, defaultController('cascade', proc), params)![0].name, 'Cascade');
});

test('auto-tune gives a stable, robust starting point for every process and controller', async () => {
  const { autoTune } = await import('./tuning');
  const { PROCESSES } = await import('./processes');
  const { isAvailable } = await import('./controllers');
  const { robustness } = await import('./linear');
  for (const proc of PROCESSES) {
    for (const kind of ['pid', 'schedule', 'characterized', 'feedforward', 'cascade'] as const) {
      if (!isAvailable(proc, kind)) continue;
      const params = defaultParams(proc);
      const r = autoTune(proc, params, defaultController(kind, proc));
      assert.ok(r, `${proc.id} ${kind}`);
      const pts = robustness(proc, params, r.config, 8);
      assert.ok(pts.every((p) => p.stableAll), `${proc.id} ${kind} unstable`);
      assert.ok(Math.max(...pts.map((p) => p.worst?.ms ?? 0)) < 1.8, `${proc.id} ${kind} fragile`);
    }
  }
});
