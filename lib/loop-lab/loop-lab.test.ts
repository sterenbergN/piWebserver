import test from 'node:test';
import { strict as assert } from 'node:assert';
import { cexpj, cmul, cx, eig, expm, rng } from './linalg';
import { cleanParams, defaultParams, nominalDisturbances, toPct, valveCharacteristic, valveCharacteristicInverse } from './model';
import { attachRequest, plcController, WARMUP_CYCLES } from './plcsim';
import { PROCESSES, getProcess } from './processes';
import { tankArea, tankVolume } from './processes/tank';
import { approximate, analyzeLoop, bode, closedLoop, isStable, linearizePlant, margins, stepResponse } from './linear';
import { CONTROLLER_KINDS, DEFAULT_PID, cleanController, createController, defaultController, isAvailable, scheduledGains, type ControllerConfig } from './controllers';
import { Loop, runAll, runScenario, runScenarioExternal, type ExternalController, type ExternalInputs } from './sim';
import { fitModel, parseTable } from './ident';
import { feedforwardDesign, tuningModel } from './tuning';
import { scorecard } from './score';
import { TUNING_RULES } from './tuning';
import { exportCode, exportReference, exportSilKit, pidCompactParams, real, silSignals, SIL_DB, SIL_FC } from './export';
import { decodeExperiment, defaultExperiment, encodeExperiment } from './setup';

const close = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
const pid = (o: Partial<typeof DEFAULT_PID>): ControllerConfig => ({ kind: 'pid', pid: { ...DEFAULT_PID, ...o } });
const isAvailableKind = (proc: ReturnType<typeof getProcess>, kind: string) => isAvailable(proc, kind as ControllerConfig['kind']);

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
      // An open-loop unstable plant has no tuning rule: it says so and leaves the settings alone.
      if (proc.id === 'maglev') { assert.match(r.note, /unstable on its own/); continue; }
      const pts = robustness(proc, params, r.config, 8);
      // The batch reactor's spread includes reactors that run away on their own (a stronger reaction, a fouled
      // jacket): the SIMC tuning for the start of the batch is too slow to hold those. Its case study is about that.
      if (proc.id === 'batch') { assert.ok(pts.some((p) => !p.stableAll)); continue; }
      assert.ok(pts.every((p) => p.stableAll), `${proc.id} ${kind} unstable`);
      assert.ok(Math.max(...pts.map((p) => p.worst?.ms ?? 0)) < 1.8, `${proc.id} ${kind} fragile`);
    }
  }
});

test('plant goals pick the physical setting that does it: hold-up for a slower exchanger', async () => {
  const { applyGoal, settingEffects } = await import('./plant');
  const hx = getProcess('hx');
  const slower = applyGoal(hx, defaultParams(hx), 'slower')!;
  assert.equal(slower.changes[0].key, 'Cf');
  assert.ok(slower.after!.tau > slower.before!.tau * 1.2);
  const more = applyGoal(hx, defaultParams(hx), 'deadtime')!;
  assert.ok(more.after!.theta > more.before!.theta * 1.3);
  // A bigger tank top radius makes the level slower; more inlet capacity, more gain.
  const tank = getProcess('tank');
  const e = settingEffects(tank, defaultParams(tank));
  assert.ok(e.R.dTau > 0.2 && e.Qmax.dK > 0.15);
});

// ─── Phase 3: averaging level, dead time, inverse response ─────────────────

test('surge tank: an integrator with negative gain, and auto-tune uses the room (averaging)', async () => {
  const { autoTune } = await import('./tuning');
  const proc = getProcess('surge');
  const params = defaultParams(proc);
  const m = tuningModel(proc, params, defaultController('pid', proc), proc.nominalPv);
  assert.ok(m.integrating && m.negative);
  // k′ = Qmax/(100·A)/H in %/s per %: 60/3600/100/4 m/s per % over a 3 m span.
  close(m.kPrime, (60 / 3600 / 100 / 4) * (100 / 3), 2e-5);
  const r = autoTune(proc, params, defaultController('pid', proc))!;
  assert.ok(r.config.kind === 'pid' && r.config.pid.invert && r.config.pid.Kc < 1.5 && r.config.pid.Ti > 1800, r.note);
  const tight = runAll(proc, { params, controller: pid({ Kc: 6, Ti: 450, invert: true }) }, ['surges'])[0];
  const avg = runAll(proc, { params, controller: r.config }, ['surges'])[0];
  const swing = (a: Float64Array) => Math.max(...a) - Math.min(...a);
  // The averaging loop lets the level move several times more, and the outflow far less.
  assert.ok(swing(avg.trace.pvTrue) > 3 * swing(tight.trace.pvTrue));
  assert.ok(swing(avg.trace.valve) < 0.6 * swing(tight.trace.valve));
  assert.ok(Math.max(...avg.trace.pvTrue) < proc.pv.hi * 0.85, 'stays inside the tank');
});

test('drum: the shrink counts as dead time (a right-half-plane zero), not just the lags', () => {
  const proc = getProcess('drum');
  const p = defaultParams(proc);
  const m = approximate(linearizePlant(proc, p, 0), p.Ts / 2);
  assert.ok(m.integrating);
  // Zero time constant k_sh/k − τ_sh, plus the lags: about 46 s.
  const kInt = (1000 / 3.6 / (750 * p.A)) * (100 / 600) * (100 / 100);
  const zero = p.kShrink * (100 / 600) / kInt - p.tauShrink;
  close(m.theta, zero + p.tauShrink + p.valveTau + p.txTau + p.Ts / 2, 1.5);
});

test('drum: feedforward on an integrator matches the mass balance; three-element beats level-only', () => {
  const proc = getProcess('drum');
  const params = defaultParams(proc);
  const ffValve = feedforwardDesign(proc, params, defaultController('feedforward', proc), 0, 'qs')!;
  close(ffValve.gain, 1, 0.02, 'one t/h of feedwater (1 % of valve) per t/h of steam');
  const casc = defaultController('cascade', proc);
  const ffInner = feedforwardDesign(proc, params, casc, 0, 'qs')!;
  close(ffInner.gain, 100 / 120, 0.02, 'in % of the 0–120 t/h feedwater span');
  const peak = (c: ControllerConfig, s: string) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, [s]), false).worstPeak;
  const single = defaultController('pid', proc);
  const three: ControllerConfig = { ...(casc as Extract<ControllerConfig, { kind: 'cascade' }>), ff: [{ from: 'qs', gain: 0.833, lead: 0, lag: 0 }] };
  assert.ok(peak(three, 'load-steps') < 0.3 * peak(single, 'load-steps'));
  assert.ok(peak(three, 'fw-pressure') < 0.1 * peak(single, 'fw-pressure'));
});

test('Smith predictor: with the model right it settles setpoint steps much faster than PI', () => {
  const proc = getProcess('feeder');
  const params = defaultParams(proc);
  const piCfg = pid({ Kc: 0.1, Ti: 5.5 });
  const smith = defaultController('smith', proc);
  const iae = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['sp-steps']), false).iae;
  assert.ok(iae(smith) < 0.6 * iae(piCfg));
  // The PID sees the prediction: during a rate step it moves θ before the scale does.
  const r = runAll(proc, { params, controller: smith }, ['sp-steps'])[0];
  const i = r.trace.t.findIndex((t) => t >= 30);
  assert.ok(r.trace.pred[i] - 10 > 5 * Math.abs(r.trace.pv[i] - 10) + 0.5, 'prediction runs ahead of the measurement');
});

test('Smith predictor: linear loop matches the theory, and a dead-time error costs margin', async () => {
  const { robustness } = await import('./linear');
  const proc = getProcess('feeder');
  const params = defaultParams(proc);
  const smith = defaultController('smith', proc);
  const a = analyzeLoop(proc, params, smith, proc.nominalPv)!;
  assert.ok(isStable(closedLoop(a.plant, a.ctrl, a.delay).poles));
  assert.ok(a.margins.pm > 30 && a.margins.pm < 180 && a.margins.ms < 2.2);
  const pts = robustness(proc, params, smith, 8);
  assert.ok(pts.every((p) => p.stableAll));
  // Tuned for the lag alone, the same predictor is fragile.
  const fast = { ...smith, pid: { ...(smith as Extract<ControllerConfig, { kind: 'smith' }>).pid, Kc: 1.2 } };
  const worst = (c: ControllerConfig) => Math.max(...robustness(proc, params, c, 8).map((p) => p.worst?.ms ?? 0));
  assert.ok(worst(fast) > worst(smith) + 0.2);
});

test('Smith predictor: manual → auto is bumpless, and the config survives a link', () => {
  const proc = getProcess('feeder');
  const params = defaultParams(proc);
  const cfg = defaultController('smith', proc);
  const loop = new Loop(proc, { params, controller: cfg }, { sp: 10 });
  loop.setMode(false);
  for (let i = 0; i < 20; i++) loop.step();
  const before = loop.step().cv;
  loop.setMode(true);
  close(loop.step().cv, before, 0.5);
  assert.deepEqual(cleanController(JSON.parse(JSON.stringify(cfg)), proc), cfg);
});

test('exports: the Smith predictor block has a ring buffer and runs before the PID', () => {
  const proc = getProcess('feeder');
  const cfg = defaultController('smith', proc);
  const scl = exportCode(proc, cfg, defaultParams(proc), 'scl');
  assert.match(scl, /FUNCTION_BLOCK "LL_Smith"/);
  assert.match(scl, /Buffer : Array\[0\.\.999\] of Real/);
  assert.ok(scl.indexOf('"WIC_701_Smith_DB"(') < scl.lastIndexOf('"WIC_701_DB"('), 'predictor called first');
  assert.match(scl, /Input := "WIC_701_Smith_DB"\.Corrected/);
  const st = exportCode(proc, cfg, defaultParams(proc), 'st');
  assert.ok(!st.includes('#'), 'IEC ST has no # locals');
  assert.equal(pidCompactParams(proc, cfg, defaultParams(proc))![0].name, 'Smith predictor');
});

test('every case study preset is a valid controller for its process, and its test scripts exist', async () => {
  const { CASES } = await import('./content');
  for (const c of CASES) {
    const proc = getProcess(c.process);
    for (const step of c.steps) {
      for (const s of step.scenarios ?? []) assert.ok(proc.scenarios.some((x) => x.id === s), `${c.id}: ${s}`);
      for (const pr of step.presets ?? []) assert.deepEqual(cleanController(pr.controller, proc), pr.controller, `${c.id}: ${pr.label}`);
    }
  }
});

// ─── Phase 3b: override, split-range, ratio ────────────────────────────────

test('override: a steam flow limiter holds the limit, and tracking avoids windup both ways', () => {
  const proc = getProcess('hx');
  const params = defaultParams(proc);
  const o = defaultController('override', proc) as Extract<ControllerConfig, { kind: 'override' }>;
  assert.equal(o.on, 'pv2');
  const run = (c: ControllerConfig) => runAll(proc, { params, controller: c }, ['steam-limit'])[0].trace;
  const max = (a: Float64Array, from: number, to: number, t: Float64Array) => Math.max(...Array.from(a).filter((_, i) => t[i] >= from && t[i] < to));
  const free = run(pid({ Kc: 1.5, Ti: 29 })), tracked = run(o), wound = run({ ...o, tracking: false });
  assert.ok(max(free.pv2, 20, 260, free.t) > 1080, 'without a limit the steam goes over');
  assert.ok(max(tracked.pv2, 20, 260, tracked.t) < 1025, 'the limiter holds 1000 kg/h');
  assert.ok(max(wound.pv2, 20, 260, wound.t) > max(tracked.pv2, 20, 260, tracked.t) + 20, 'a wound-up limiter takes over late');
  assert.ok(max(wound.pvTrue, 260, 440, wound.t) > max(tracked.pvTrue, 260, 440, tracked.t) + 3, 'a wound-up temperature controller hands back late');
  // The linear view is the normal loop.
  const a = analyzeLoop(proc, params, o, 60)!;
  assert.equal(a.ctrl.kind, 'single');
});

test('override on the same measurement: a high-level limit on the surge tank', () => {
  const proc = getProcess('surge');
  const params = defaultParams(proc);
  const avg = pid({ Kc: 0.73, Ti: 3920, invert: true });
  const o = defaultController('override', proc);
  const top = (c: ControllerConfig) => Math.max(...runAll(proc, { params, controller: c }, ['big-surge'])[0].trace.pvTrue);
  assert.ok(top(avg) > 2.7);
  assert.ok(top(o) < 2.6);
});

test('split-range: valve ranges, the balanced characterization, and one tuning that fails on the other side', async () => {
  const { splitValves, balancePoint } = await import('./processes/jacket');
  const { robustness } = await import('./linear');
  const proc = getProcess('jacket');
  const p = defaultParams(proc);
  assert.deepEqual(splitValves(0, p), { cool: 1, heat: 0 });
  assert.deepEqual(splitValves(1, p), { cool: 0, heat: 1 });
  assert.deepEqual(splitValves(0.5, p), { cool: 0, heat: 0 });
  const g = splitValves(0.5, { ...p, gap: 10 });
  assert.ok(g.cool === 0 && g.heat === 0 && splitValves(0.44, { ...p, gap: 10 }).cool > 0);
  close(balancePoint(p), (800 / 1050) * 100, 0.5);
  const ch = proc.characterizations[0];
  for (const u of [0, 20, 50, 75, 90, 100]) close(ch.inv!(ch.f(u, p), p), u, 1e-6);
  // Tuned on steam (τc = θ there), the loop is unstable where it needs cooling; the balanced split is not.
  const stable = (c: ControllerConfig, pp = p) => robustness(proc, pp, c, 4).every((r) => r.stableAll);
  assert.equal(stable(pid({ Kc: 11, Ti: 180 })), false);
  assert.equal(stable(pid({ Kc: 4.9, Ti: 170 }), { ...p, split: 76 }), true);
  assert.equal(stable({ kind: 'characterized', pid: { ...DEFAULT_PID, Kc: 4.9, Ti: 170 }, char: 'balanced-split' }), true);
});

test('ratio: the linear form is a cascade with feedforward R₀, and production changes barely move the product', async () => {
  const { ratioAt } = await import('./controllers');
  const proc = getProcess('blend');
  const params = defaultParams(proc);
  const r = defaultController('ratio', proc) as Extract<ControllerConfig, { kind: 'ratio' }>;
  const at = ratioAt(proc, r, params, 40);
  close(at.R0, 0.25, 1e-6);
  close(at.ffGain, (0.25 * 100) / 25, 1e-6);
  close(at.slope, (40 * 0.5) / 25, 1e-9);
  const a = analyzeLoop(proc, params, r, 10)!;
  assert.ok(a.ctrl.kind === 'cascade' && a.ctrl.ff[0].from === 'FA');
  assert.ok(isStable(closedLoop(a.plant, a.ctrl, a.delay).poles));
  const peak = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['throughput']), false).worstPeak;
  assert.ok(peak(r) < 0.1 * peak(pid({ Kc: 0.4, Ti: 38.5 })));
  // A fixed ratio can't see the concentrate's strength.
  const fixed = runAll(proc, { params, controller: { ...r, trim: false } }, ['strength'])[0].trace;
  close(fixed.pvTrue[fixed.pvTrue.length - 1], (0.25 * 55) / 1.25, 0.05);
});

test('ratio: the trim keeps its loop gain at any rate; additive feedforward does not', () => {
  const proc = getProcess('blend');
  const params = defaultParams(proc);
  const r = defaultController('ratio', proc);
  const ff: ControllerConfig = { kind: 'feedforward', pid: { ...DEFAULT_PID, Kc: 0.4, Ti: 38.5 }, ff: [{ from: 'FA', gain: 1, lead: 0, lag: 0 }] };
  const os = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['low-rate']), false).worstOvershoot;
  assert.ok(os(r) < 0.6 * os(ff));
  // The low-rate test starts steady at its own diluent flow.
  const t = runAll(proc, { params, controller: r }, ['low-rate'])[0].trace;
  close(t.pvTrue[0], 10, 0.01);
  close(t.dist.FA[0], 15, 1e-9);
});

test('exports: override selector with external reset, ratio station, split-range outputs', () => {
  const hx = getProcess('hx');
  const o = exportCode(hx, defaultController('override', hx), defaultParams(hx), 'scl');
  assert.match(o, /"Out" := MIN\(IN1 := "TIC_301_DB"\.Output, IN2 := "TIC_301_Ovr_DB"\.Output\);/);
  assert.match(o, /ExtResetEnable := NOT "OvrSelected"/);
  assert.match(o, /ExtReset : Real;/);
  const blend = getProcess('blend');
  const r = exportCode(blend, defaultController('ratio', blend), defaultParams(blend), 'scl');
  assert.match(r, /"SP2" := LIMIT\(MN := 0\.0, IN := "Ratio" \* "FT-801", MX := 25\.0\);/);
  const jacket = getProcess('jacket');
  const s = exportCode(jacket, defaultController('pid', jacket), { ...defaultParams(jacket), split: 76 }, 'st');
  assert.match(s, /TV_501A := LIMIT\(MN := 0\.0, IN := \(76\.0 - TY_501\) \/ 76\.0 \* 100\.0, MX := 100\.0\);/);
  for (const [proc, kind] of [[hx, 'override'], [blend, 'ratio']] as const) {
    const c = defaultController(kind, proc);
    assert.deepEqual(cleanController(JSON.parse(JSON.stringify(c)), proc), c);
  }
});

// ─── Phase 4a: state feedback, observers, LQR, Kalman ───────────────────────

test('state-space numerics: Riccati (LQR), pole placement, the dual problem with two outputs', async () => {
  const { care, place, placeMulti, regulatorPoles } = await import('./statespace');
  // Double integrator, Q = I, R = 1: K = [1, √3].
  const X = care([[0, 1], [0, 0]], [[0], [1]], [[1, 0], [0, 1]], [[1]])!;
  close(X[1][0], 1, 1e-9);
  close(X[1][1], Math.sqrt(3), 1e-9);
  // Ackermann and Sylvester agree, and put the poles where asked.
  const A = [[0, 1, 0], [0, 0, 1], [2, -1, -3]], b = [0, 0, 1];
  const want = [{ re: -1, im: 0 }, { re: -2, im: 1 }, { re: -2, im: -1 }];
  const k1 = place(A, b, want)!, k2 = placeMulti(A, b.map((v) => [v]), want)![0];
  k1.forEach((v, i) => close(v, k2[i], 1e-6));
  const got = eig(A.map((r, i) => r.map((v, j) => v - b[i] * k1[j]))).map((p) => p.re).sort((x, y) => x - y);
  close(got[0], -2, 1e-6); close(got[2], -1, 1e-6);
  // Observer for two outputs: neither alone sees everything, both together do.
  const Ao = [[0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 1], [0, 0, -4, 0]];
  const C = [[1, 0, 0, 0], [0, 0, 1, 0]];
  const At = Ao.map((r, i) => r.map((_, j) => Ao[j][i])), Ct = Ao.map((_, i) => C.map((r) => r[i]));
  const target = [-2, -3, -4, -5].map((re) => ({ re, im: 0 }));
  assert.ok(placeMulti(At, Ct, target), 'two measurements make it observable');
  assert.equal(placeMulti(At, Ct.map((r) => [r[0]]), target), null, 'the first alone misses the second oscillator');
  // The pole rule: a lightly damped pair keeps its frequency and gets the damping; an unstable pole is mirrored.
  const ps = regulatorPoles([{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: -0.01, im: 2 }, { re: -0.01, im: -2 }, { re: 5, im: 0 }], 1, 0.7);
  const pair = ps.find((p) => p.im > 1.2)!;
  close(Math.hypot(pair.re, pair.im), Math.hypot(0.01, 2), 1e-9);
  close(-pair.re / Math.hypot(pair.re, pair.im), 0.7, 1e-9);
  assert.ok(ps.some((p) => Math.abs(p.re + 5) < 1e-9 && p.im === 0));
});

test('state feedback: the linear loop has the regulator\'s and the observer\'s poles (separation principle)', async () => {
  const { designStateFb } = await import('./statespace');
  for (const id of ['crane', 'servo', 'maglev'] as const) {
    const proc = getProcess(id);
    const params = defaultParams(proc);
    const c = defaultController('statefb', proc) as Extract<ControllerConfig, { kind: 'statefb' }>;
    const des = designStateFb(proc, c, params);
    assert.ok(des.ok, `${id}: ${des.error}`);
    const a = analyzeLoop(proc, params, c, proc.nominalPv)!;
    assert.equal(a.ctrl.kind, 'ss');
    const cl = closedLoop(a.plant, a.ctrl, 0);
    const mag = (p: { re: number; im: number }) => Math.hypot(p.re, p.im);
    const expected = [...des.poles, ...des.obsPoles];
    // Every designed pole is a closed-loop pole (the plant may add its unused transmitter's own pole).
    for (const p of expected) assert.ok(cl.poles.some((q) => mag({ re: q.re - p.re, im: q.im - p.im }) < 1e-4 * Math.max(1, mag(p))), `${id}: pole ${p.re}±${p.im}j missing`);
    assert.ok(isStable(closedLoop(a.plant, a.ctrl, a.delay).poles));
  }
});

test('crane: PI can\'t damp the swing; state feedback with a wind-aware observer can', () => {
  const proc = getProcess('crane');
  const params = defaultParams(proc);
  const sf = defaultController('statefb', proc) as Extract<ControllerConfig, { kind: 'statefb' }>;
  const run = (c: ControllerConfig, id: string) => runAll(proc, { params, controller: c }, [id])[0];
  const lateSway = (r: ReturnType<typeof run>) => Math.max(...Array.from(r.trace.pv2).filter((_, i) => r.trace.t[i] > 0.75 * r.scenario.duration).map(Math.abs));
  const pi = run(defaultController('pid', proc), 'moves'), st = run(sf, 'moves');
  assert.ok(lateSway(pi) > 1.5, 'the PI leaves the load swinging');
  assert.ok(lateSway(st) < 0.2, 'state feedback puts it down still');
  assert.ok(Math.max(...st.trace.pvTrue) < 25.1 && scorecard(proc, params, sf, [st], false).worstSettling < 25);
  // Wind: without a disturbance model the controller drives the trolley to "take out" a steady sway.
  const dev = (r: ReturnType<typeof run>) => Math.max(...Array.from(r.trace.pvTrue).map((v) => Math.abs(v - 20)));
  assert.ok(dev(run(sf, 'gust')) < 1.2);
  assert.ok(dev(run({ ...sf, integral: 'none' }, 'gust')) > 5);
  // With the load position alone, the wind can't be told from a trolley offset.
  const blind = runAll(proc, { params, controller: { ...sf, measure: 'pv' } }, ['gust']);
  assert.ok(blind.length === 1);
  return import('./statespace').then(({ designStateFb }) => {
    const d = designStateFb(proc, { ...sf, measure: 'pv' }, params);
    assert.equal(d.ok, false);
    assert.match(d.error!, /visible/);
  });
});

test('flexible shaft: PI on the roll is capped by the resonance; state feedback damps it', async () => {
  const { autoTune } = await import('./tuning');
  const proc = getProcess('servo');
  const params = defaultParams(proc);
  const stable = (c: ControllerConfig) => { const a = analyzeLoop(proc, params, c, proc.nominalPv)!; return isStable(closedLoop(a.plant, a.ctrl, a.delay).poles); };
  assert.equal(stable(pid({ Kc: 0.8, Ti: 1 })), true);
  assert.equal(stable(pid({ Kc: 2, Ti: 0.3 })), false);
  const t = autoTune(proc, params, defaultController('pid', proc))!;
  assert.match(t.note, /resonance/);
  assert.equal(stable(t.config), true);
  const sf = defaultController('statefb', proc);
  const sc = scorecard(proc, params, sf, runAll(proc, { params, controller: sf }), false);
  assert.ok(sc.worstSettling < 1);
  assert.ok(analyzeLoop(proc, params, sf, proc.nominalPv)!.margins.ms < 1.7);
});

test('magnetic levitation: no tuning rule; PID needs its setpoint weight; state feedback holds it', async () => {
  const { autoTune } = await import('./tuning');
  const proc = getProcess('maglev');
  const params = defaultParams(proc);
  assert.ok(linearizePlant(proc, params, 15).poles.some((p) => p.re > 30));
  assert.match(autoTune(proc, params, defaultController('pid', proc))!.note, /unstable on its own/);
  const os = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['gap-steps']), false).worstOvershoot;
  const base = defaultController('pid', proc) as Extract<ControllerConfig, { kind: 'pid' }>;
  assert.ok(os(base) < 1);
  assert.ok(os({ ...base, pid: { ...base.pid, b: 1 } }) > 100);
  const sf = defaultController('statefb', proc);
  const r = runAll(proc, { params, controller: sf });
  assert.ok(r.every((x) => Math.max(...x.trace.pvTrue) < 25), 'never drops to the pad');
  assert.ok(scorecard(proc, params, sf, r, false).worstSettling < 0.3);
});

test('state feedback exports: one SCL block with LReal matrices, call site, reference code, no PID_Compact', () => {
  const proc = getProcess('crane');
  const params = defaultParams(proc);
  const c = defaultController('statefb', proc);
  const scl = exportCode(proc, c, params, 'scl');
  assert.match(scl, /FUNCTION_BLOCK "LL_StateFb"/);
  assert.match(scl, /Phi : Array\[0\.\.7, 0\.\.7\] of LReal := \[/);
  assert.match(scl, /"ZIC_601_DB"\(Setpoint := "SP", Input := "ZT-601", Input2 := "ZT-602"/);
  assert.match(scl, /#Output := LREAL_TO_REAL\(LIMIT\(MN := 0\.0, IN := #u, MX := 100\.0\)\);/);
  const st = exportCode(proc, c, params, 'st');
  assert.ok(!st.includes('#'));
  assert.match(exportReference(c, params.Ts, proc, params), /const Phi = \[/);
  assert.equal(pidCompactParams(proc, c, params)![0].value, 'not applicable');
  assert.deepEqual(cleanController(JSON.parse(JSON.stringify(c)), proc), c);
  // A sway camera isn't something an inner loop could control.
  assert.equal(cleanController({ kind: 'cascade' }, proc).kind, 'pid');
});

// ─── Phase 4b: two inputs, two outputs: RGA, decoupling, MPC ────────────────

test('mixing tank: the relative gain is the cold share of the inflow, and the pairing flips with temperature', async () => {
  const { mimoModel, rga11, steadyGains } = await import('./multivar');
  const proc = getProcess('mixing');
  const p = defaultParams(proc);
  for (const T of [25, 35, 55]) {
    const { m, B2 } = mimoModel(proc, p, T);
    const G = steadyGains(m, B2);
    close(rga11(G), (70 - T) / (70 - 15), 1e-3, `at ${T} °C`);
    assert.ok(G[0][0] > 0 && G[0][1] < 0 && G[1][0] > 0 && G[1][1] > 0);
  }
  // Only the 2×2 controllers (and a single loop) are offered on it, and not elsewhere.
  assert.deepEqual(['pid', 'multiloop', 'mpc', 'cascade', 'statefb'].map((k) => isAvailableKind(proc, k)), [true, true, true, false, false]);
  assert.equal(isAvailableKind(getProcess('hx'), 'mpc'), false);
});

test('2×2 simulation: both setpoints, the second valve, and scoring both variables', () => {
  const proc = getProcess('mixing');
  const params = defaultParams(proc);
  const ml = defaultController('multiloop', proc);
  const r = runAll(proc, { params, controller: ml }, ['level-steps'])[0];
  close(r.trace.pv2True[0], 1, 1e-6);
  close(r.trace.pvTrue[0], 35, 1e-6);
  const end = r.trace.t.length - 1;
  close(r.trace.pv2True[end], 0.8, 0.01);
  assert.ok(Array.from(r.trace.valve2).every((v) => v >= 0 && v <= 100));
  const sc = scorecard(proc, params, ml, [r], false);
  assert.ok(sc.tests[0].steps.every((s) => s.unit === 'm'), 'the steps are the level\'s');
  assert.ok(sc.tests[0].upsets.some((u) => /effect on temperature/.test(u.label)), 'a level step is an upset on the temperature');
  // A single PID leaves the second valve where it was.
  const one = runAll(proc, { params, controller: defaultController('pid', proc) }, ['demand'])[0];
  assert.ok(Array.from(one.trace.cv2).every((v) => Math.abs(v - one.trace.cv2[0]) < 1e-9));
});

test('decoupling: two numbers take out most of the interaction; the linear loop with both closed is stable', () => {
  const proc = getProcess('mixing');
  const params = defaultParams(proc);
  const ml = defaultController('multiloop', proc) as Extract<ControllerConfig, { kind: 'multiloop' }>;
  const tempDev = (c: ControllerConfig, id: string) => {
    const t = runAll(proc, { params, controller: c }, [id])[0].trace;
    return Math.max(...Array.from(t.pvTrue).map((v, i) => Math.abs(v - t.sp[i])));
  };
  assert.ok(tempDev(ml, 'level-steps') > 4);
  assert.ok(tempDev({ ...ml, decouple: true }, 'level-steps') < 0.3);
  assert.ok(tempDev({ ...ml, decouple: true }, 'demand') < 0.1);
  for (const c of [ml, { ...ml, decouple: true }]) {
    const a = analyzeLoop(proc, params, c, 35)!;
    assert.ok(a.ctrl.kind === 'ss' && a.ctrl.out2);
    assert.ok(isStable(closedLoop(a.plant, a.ctrl, a.delay).poles));
    assert.ok(Number.isFinite(a.margins.ms) && a.margins.ms < 2);
  }
  // At 55 °C the crossed pairing is the better one.
  const crossed: ControllerConfig = { ...ml, pairing: 'crossed', pid: { ...DEFAULT_PID, Kc: 3.8, Ti: 360, invert: true }, pid2: { ...DEFAULT_PID, Kc: 18.1, Ti: 64 } };
  assert.ok(tempDev(crossed, 'hot-recipe') < 0.5 * tempDev(ml, 'hot-recipe'));
});

test('MPC: the box QP, bumpless start, and the weights deciding what gives at the limit', async () => {
  const { boxQp, designMpc } = await import('./multivar');
  // Inside the box: the unconstrained minimum of zᵀHz + 2fᵀz, z = −H⁻¹f. Outside: clipped and still optimal.
  const H = [[2, 0.5], [0.5, 1]], f = [-1, -1];
  const z = boxQp(H, f, [-10, -10], [10, 10], [0, 0]);
  close(2 * z[0] + 0.5 * z[1], 1, 1e-6); close(0.5 * z[0] + z[1], 1, 1e-6);
  const zc = boxQp(H, f, [-10, -10], [10, 0.2], [0, 0]);
  close(zc[1], 0.2, 1e-9); close(zc[0], (1 - 0.5 * 0.2) / 2, 1e-6);
  const proc = getProcess('mixing');
  const params = defaultParams(proc);
  const mpc = defaultController('mpc', proc) as Extract<ControllerConfig, { kind: 'mpc' }>;
  assert.ok(designMpc(proc, mpc, params).ok);
  // Starting away from the design point (50 °C) without a bump.
  const peak = (c: ControllerConfig) => runAll(proc, { params, controller: c }, ['peak'])[0].trace;
  const t = peak(mpc);
  // (Its linear model is from 35 °C, so its first plan moves a little: under 1.5 %.)
  close(t.cv[0], t.valve[0], 1.5);
  assert.ok(Array.from(t.valve).every((v) => v >= 0 && v <= 100));
  // The hot valve runs out: equal weights split the loss, temperature first holds more of the temperature.
  const at = (tr: ReturnType<typeof peak>, s: number) => [tr.pvTrue[Math.round(s / 2)], tr.pv2True[Math.round(s / 2)]];
  const [Te, he] = at(t, 850), [Tt, ht] = at(peak({ ...mpc, q1: 10 }), 850);
  assert.ok(Tt > Te + 0.8 && ht < he - 0.04);
  // And it recovers without the overshoot two plain loops give.
  const two = peak(defaultController('multiloop', proc));
  const maxAfter = (tr: ReturnType<typeof peak>) => Math.max(...Array.from(tr.pvTrue).filter((_, i) => tr.t[i] > 900));
  assert.ok(maxAfter(two) > 53 && maxAfter(t) < 51);
});

test('2×2 exports: two loops with the decoupler, one MPC block; links round-trip', () => {
  const proc = getProcess('mixing');
  const params = defaultParams(proc);
  const ml = { ...(defaultController('multiloop', proc) as Extract<ControllerConfig, { kind: 'multiloop' }>), decouple: true };
  const scl = exportCode(proc, ml, params, 'scl');
  assert.match(scl, /"LIC_902_DB"\(Setpoint := "SP2", Input := "LT-902"/);
  assert.match(scl, /"UA" := [\d.]+ \+ "W1" \+ -?[\d.E-]+ \* "W2";/);
  assert.match(scl, /"FV-902" := LIMIT\(MN := 0\.0, IN := "UB", MX := 100\.0\);/);
  const mpc = defaultController('mpc', proc);
  const m = exportCode(proc, mpc, params, 'scl');
  assert.match(m, /FUNCTION_BLOCK "LL_Mpc"/);
  assert.match(m, /H : Array\[0\.\.9, 0\.\.9\] of LReal := \[/);
  assert.match(m, /"FV-902" := "TIC_901_DB"\.Output2;/);
  assert.match(exportReference(mpc, params.Ts, proc, params), /function step\(r: \[number, number\], y: \[number, number\]\)/);
  assert.equal(pidCompactParams(proc, mpc, params)![0].value, 'not applicable');
  for (const c of [ml, mpc]) assert.deepEqual(cleanController(JSON.parse(JSON.stringify(c)), proc), c);
});

// ─── Phase 4c: batch reactor, adaptive, ADRC, your own controller ───────────

test('batch reactor: the cooling margin sets gain and speed, and shrinks with the reactant left', async () => {
  const { reactionHeat } = await import('./processes/batch');
  const proc = getProcess('batch');
  const p = defaultParams(proc);
  const d = nominalDisturbances(proc);
  // 500 kW at 80 °C with a full charge, growing by about 48 kW/K.
  close(reactionHeat(80, 2, p, d), 500, 1);
  close((reactionHeat(80.01, 2, p, d) - reactionHeat(79.99, 2, p, d)) / 0.02, 48.2, 0.5);
  const fit = (charge: number) => { const m = linearizePlant(proc, p, 80, { ...d, charge }); return approximate(m, p.Ts / 2); };
  const start = fit(2), end = fit(0.2);
  assert.ok(start.K > 4 * end.K && start.tau > 2.5 * end.tau, 'four times more sensitive and slower at the start');
  // The reactant is frozen in the linear model: one stage of the batch, not its depletion.
  assert.equal(linearizePlant(proc, p, 80).A.length, 4);
  // Setpoint ramps: 2 °C/min from 40 to 80.
  const r = runAll(proc, { params: p, controller: defaultController('pid', proc) }, ['batch'])[0];
  close(r.trace.sp[Math.round(660 / r.Ts)], 40 + 20, 0.2);
});

test('adaptive: RLS finds a first-order model, SIMC retunes from it, and the gains move with the batch', async () => {
  const { Rls, fromArx, simcPi } = await import('./adaptive');
  const rls = new Rls([0.5, 0.5, 0], 100, 1);
  let y = 0;
  const g = rng(3);
  for (let k = 0; k < 400; k++) { const u = g.next() * 10; const yn = 0.9 * y + 0.2 * u + 1; rls.update([y, u, 1], yn); y = yn; }
  close(rls.theta[0], 0.9, 1e-3); close(rls.theta[1], 0.2, 1e-3); close(rls.theta[2], 1, 1e-2);
  const m = fromArx(0.9, 0.2, 1, 2);
  close(m.K, 2, 1e-9); close(m.tau, -1 / Math.log(0.9), 1e-9);
  const t = simcPi(m, 4)!;
  close(t.Kc, m.tau / (2 * 6), 1e-9); close(t.Ti, Math.min(m.tau, 24), 1e-9);
  const proc = getProcess('batch');
  const params = defaultParams(proc);
  const ad = defaultController('adaptive', proc);
  const tr = runAll(proc, { params, controller: ad }, ['hot-batch'])[0].trace;
  assert.ok(Math.max(...Array.from(tr.Kc)) > 1.2 * tr.Kc[0], 'it retunes as the reaction takes off');
  // Where the PI tuned on a quiet batch overshoots a strong one, the self-tuner doesn't.
  const peak = (c: ControllerConfig) => Math.max(...runAll(proc, { params, controller: c }, ['hot-batch'])[0].trace.pvTrue);
  assert.ok(peak(defaultController('pid', proc)) > 82 && peak(ad) < 80.5);
});

test('ADRC: observer bandwidths, the linear form, and a robust design on the reactor without a reaction model', async () => {
  const { designAdrc } = await import('./adrc');
  const des = designAdrc({ kind: 'adrc', order: 2, wc: 1, wo: 4, b0: 2 }, 0.01);
  // Observer poles all at −ω_o: L = [3ω, 3ω², ω³].
  assert.deepEqual(des.L, [12, 48, 64]);
  close(des.Dr, 0.5, 1e-12);
  const proc = getProcess('batch');
  const params = defaultParams(proc);
  const { autoTune } = await import('./tuning');
  const t = autoTune(proc, params, defaultController('adrc', proc))!;
  assert.match(t.note, /b₀/);
  const a = analyzeLoop(proc, params, t.config, 80)!;
  assert.equal(a.ctrl.kind, 'ss');
  assert.ok(isStable(closedLoop(a.plant, a.ctrl, a.delay).poles) && a.margins.ms <= 1.6);
  // Its total-disturbance estimate (as the output it takes) climbs through the hold as the reaction dies away.
  const tr = runAll(proc, { params, controller: t.config }, ['batch'])[0].trace;
  assert.ok(tr.I[Math.round(5300 / 2)] > tr.I[Math.round(2400 / 2)] + 3);
});

test('Structured Text: the language, its errors, and a PI written out matching the built-in one', async () => {
  const { compileSt, StRunner, StError, toScl, stripDeclarations } = await import('./st');
  const run = (src: string, inputs: Record<string, number> = {}) => new StRunner(compileSt(src, ['SP'], ['OUT'])).run(inputs).OUT;
  assert.equal(run('VAR x : INT; s : REAL; END_VAR FOR x := 1 TO 10 DO s := s + x; IF x = 5 THEN EXIT; END_IF; END_FOR; OUT := s;'), 15);
  assert.equal(run('OUT := MAX(IN1 := 2.0 ** 3, IN2 := 4) + SEL(G := TRUE, IN0 := 1, IN1 := 100) + LIMIT(MN := 0, IN := -5, MX := 10) + REAL_TO_INT(2.6) + 7 MOD 3;'), 112);
  assert.equal(run('IF SP > 1 THEN OUT := 1; ELSIF SP > 0 THEN OUT := 2; ELSE OUT := 3; END_IF;', { SP: 0.5 }), 2);
  assert.equal(run('(* block comment *) OUT := 1.5E1; // line comment'), 15);
  // Statics keep their values from one cycle to the next.
  const r = new StRunner(compileSt('VAR n : INT; END_VAR n := n + 1; OUT := n;', [], ['OUT']));
  r.run({}); r.run({});
  assert.equal(r.run({}).OUT, 3);
  const err = (src: string) => { try { run(src); return ''; } catch (e) { assert.ok(e instanceof StError); return e.message; } };
  assert.match(err('OUT := y;'), /isn't declared/);
  assert.match(err('SP := 3;'), /input/);
  assert.match(err('WHILE TRUE DO OUT := 1; END_WHILE;'), /endless loop/);
  assert.match(err('OUT := 1'), /Expected ";"/);
  assert.equal(toScl('x := LIMIT(MN := 0, IN := x, MX := 1);', new Set(['X', 'MN'])), '#x := LIMIT(MN := 0, IN := #x, MX := 1);');
  assert.ok(!/VAR/.test(stripDeclarations('VAR\n a : REAL;\nEND_VAR\na := 1;')));
  // The starting program is the process's PI, and runs exactly like it.
  for (const id of ['flow', 'surge'] as const) {
    const proc = getProcess(id), params = defaultParams(proc);
    const a = runAll(proc, { params, controller: defaultController('pid', proc) })[0].trace;
    const b = runAll(proc, { params, controller: defaultController('custom', proc) })[0].trace;
    a.cv.forEach((v, i) => close(b.cv[i], v, 1e-9));
  }
});

test('your own controller: edges matter, bad code holds the valve, and it exports as an FB', async () => {
  const { getCase } = await import('./content');
  const proc = getProcess('flow');
  const params = defaultParams(proc);
  const steps = getCase('write-your-own')!.steps[1].presets!;
  const sat = (c: ControllerConfig) => scorecard(proc, params, c, runAll(proc, { params, controller: c }, ['saturation']), false).iae;
  assert.ok(sat(steps[1].controller) > 1.5 * sat(steps[0].controller), 'without anti-windup the saturation test is worse');
  // Code that doesn't compile (or fails) holds the valve where it was.
  const bad = runAll(proc, { params, controller: { kind: 'custom', code: 'OUT := nope;' } }, ['sp-steps'])[0].trace;
  assert.ok(Array.from(bad.cv).every((v) => Math.abs(v - bad.cv[0]) < 1e-9));
  const c = defaultController('custom', proc);
  const scl = exportCode(proc, c, params, 'scl');
  assert.match(scl, /FUNCTION_BLOCK "LL_Custom"/);
  assert.match(scl, /#OUT := LIMIT\(MN := 0\.0, IN := #Kc \* #e \+ #I, MX := 100\.0\);/);
  assert.match(scl, /"FIC_101_DB"\(SP := "SP", PV := "FT-101", SP_PCT :=/);
  assert.ok(!exportCode(proc, c, params, 'st').includes('#'));
  for (const k of ['custom', 'adrc', 'adaptive'] as const) {
    const cfg = defaultController(k, getProcess('batch'));
    assert.deepEqual(cleanController(JSON.parse(JSON.stringify(cfg)), getProcess('batch')), cfg);
    assert.ok(exportCode(getProcess('batch'), cfg, defaultParams(getProcess('batch')), 'scl').length > 500);
  }
});

// ─── Phase 5: PLCSIM Advanced kit and bridge ────────────────────────────────

/** A stand-in for the PLC: the browser's own controller, behind the external interface. */
function inProcessPlc(proc: ReturnType<typeof getProcess>, setup: { params: Record<string, number>; controller: ControllerConfig }): ExternalController {
  const model = cleanParams(proc, setup.params);
  const ctrl = createController(proc, setup.controller, model, model.Ts);
  const aux = (x: ExternalInputs) => ({ pv2: x.pv2, d: x.d, sp2: x.sp2 });
  return {
    async start(x, valve) { ctrl.track(valve, x.sp, x.pv, aux(x)); },
    async cycle(x) {
      if (x.auto) { const cv = ctrl.step(x.sp, x.pv, aux(x)); return { cv, cv2: ctrl.out2?.() }; }
      ctrl.track(x.manualOut, x.sp, x.pv, aux(x));
      return { cv: x.manualOut };
    },
  };
}

test('PLC in the loop: an external controller reproduces the browser run exactly', async () => {
  for (const [pid, kind] of [['tank', 'pid'], ['drum', 'cascade'], ['mixing', 'mpc'], ['mixing', 'multiloop'], ['servo', 'statefb'], ['batch', 'adrc']] as const) {
    const proc = getProcess(pid);
    const setup = { params: defaultParams(proc), controller: defaultController(kind, proc) };
    for (const sc of proc.scenarios.slice(0, 2)) {
      const ref = runScenario(proc, setup, sc);
      const ext = await runScenarioExternal(proc, setup, sc, inProcessPlc(proc, setup));
      for (const k of ['pv', 'pvTrue', 'cv', 'valve', 'cv2', 'valve2'] as const) {
        assert.deepEqual(Array.from(ext.trace[k]), Array.from(ref.trace[k]), `${pid}/${kind}/${sc.id}: ${k}`);
      }
    }
  }
});

test('PLCSIM kit: signals know their roles; every member and instance DB is declared', () => {
  const mixing = getProcess('mixing');
  const sig = silSignals(mixing, defaultController('multiloop', mixing), defaultParams(mixing));
  const role = (r: string) => sig.find((s) => s.role === r);
  for (const r of ['sp', 'pv', 'pv2', 'sp2', 'manual', 'manualOut', 'manualOut2']) assert.equal(role(r)?.dir, 'in', r);
  assert.equal(role('cv')?.member, 'FV_901');
  assert.equal(role('cv2')?.member, 'FV_902');
  assert.equal(role('manual')?.type, 'Bool');
  assert.equal(sig.find((s) => s.member === 'SatA')?.dir, 'internal');
  const drum = getProcess('drum');
  const dsig = silSignals(drum, defaultController('cascade', drum), defaultParams(drum));
  assert.equal(dsig.find((s) => s.member === 'SP2')?.dir, 'internal', 'a cascade inner setpoint belongs to the PLC');
  assert.equal(dsig.find((s) => s.role === 'pv2')?.member, 'FT_502');

  let kits = 0;
  for (const proc of PROCESSES) for (const meta of CONTROLLER_KINDS) {
    if (!isAvailable(proc, meta.kind)) continue;
    const { source, signals } = exportSilKit(proc, defaultController(meta.kind, proc), defaultParams(proc));
    const id = `${proc.id}/${meta.kind}`;
    const fc = source.slice(source.indexOf(`FUNCTION "${SIL_FC}"`));
    const db = source.slice(source.indexOf(`DATA_BLOCK "${SIL_DB}"`), source.indexOf('END_DATA_BLOCK'));
    for (const m of fc.matchAll(/"LoopLab_IO"\.(\w+)/g)) assert.ok(new RegExp(`\\n\\s+${m[1]} : `).test(db), `${id}: ${m[1]} declared`);
    for (const m of fc.matchAll(/"(\w+_DB)"/g)) assert.ok(source.indexOf(`DATA_BLOCK "${m[1]}"`) >= 0 && source.indexOf(`DATA_BLOCK "${m[1]}"`) < source.indexOf(`FUNCTION "${SIL_FC}"`), `${id}: instance DB ${m[1]} before the FC`);
    for (const [open, close] of [['DATA_BLOCK "', 'END_DATA_BLOCK'], ['FUNCTION_BLOCK "', 'END_FUNCTION_BLOCK']]) {
      assert.equal(source.split(open).length, source.split(close).length, `${id}: ${open} balanced`);
    }
    assert.ok(signals.some((s) => s.role === 'cv'), `${id}: reads the valve`);
    assert.ok(signals.some((s) => s.role === 'pv'), `${id}: writes the measurement`);
    assert.ok(!/OB100\)/.test(fc) || /BEGIN\n   \w+ := /.test(source), `${id}: start-up tuning in an instance DB`);
    kits++;
  }
  assert.ok(kits > 100);
});

test('PLCSIM bridge protocol: warm-up in manual, outputs in attach order', async () => {
  const mixing = getProcess('mixing');
  const signals = silSignals(mixing, defaultController('mpc', mixing), defaultParams(mixing));
  const req = attachRequest('PLC_1', 2, signals);
  assert.ok(req.write.every((w) => w.tag.startsWith(`"${SIL_DB}".`)));
  assert.deepEqual(req.read.map((r) => r.role), signals.filter((s) => s.dir === 'out').map((s) => s.role));
  const calls: { values: number[]; cycles: number }[] = [];
  const stats = { steps: 0, late: 0, doubled: 0, plcTime: 0 };
  const plc = plcController(async (values, cycles) => {
    calls.push({ values, cycles });
    return { op: 'stepped', values: req.read.map((r) => (r.role === 'cv' ? 40 : 60)), ran: cycles, late: calls.length === 3, time: calls.length * 2 };
  }, signals, stats);
  const x: ExternalInputs = { pv: 35, pv2: 1, sp: 36, sp2: 1.1, auto: true, manualOut: 12, manualOut2: 34, d: { dOut: 70 } };
  await plc.start(x, 50, 45);
  const iManual = req.write.findIndex((w) => w.role === 'manual'), iMan = req.write.findIndex((w) => w.role === 'manualOut'), iMan2 = req.write.findIndex((w) => w.role === 'manualOut2');
  assert.equal(calls[0].cycles, WARMUP_CYCLES);
  assert.deepEqual([calls[0].values[iManual], calls[0].values[iMan], calls[0].values[iMan2]], [1, 50, 45]);
  assert.deepEqual(await plc.cycle(x), { cv: 40, cv2: 60 });
  assert.equal(calls[1].values[iManual], 0);
  assert.equal(calls[1].values[req.write.findIndex((w) => w.role === 'sp2')], 1.1);
  await plc.cycle(x);
  assert.deepEqual(stats, { steps: 3, late: 1, doubled: 0, plcTime: 6 });
});
