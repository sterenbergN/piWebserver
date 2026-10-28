import { findCharacterization, type ControllerConfig, type PidParams } from './controllers';
import { cleanParams, pvSpan, type Params, type ProcessDef } from './model';

// Code and parameter exports for the automation view: TIA Portal SCL, IEC
// 61131-3 Structured Text (CODESYS, TwinCAT), a plain reference
// implementation, and the equivalent PID_Compact settings.

/** A REAL literal: always has a decimal point, exponent as E. */
export function real(v: number) {
  if (!Number.isFinite(v)) return '0.0';
  const n = Number(v.toPrecision(5));
  if (n !== 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e7)) {
    const [m, e] = n.toExponential().split('e');
    return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
  }
  const s = n.toString();
  return s.includes('.') ? s : `${s}.0`;
}

type Dialect = 'scl' | 'st';

/** Tag-free names for the blocks. */
const NAMES = { pid: 'LL_PID', onoff: 'LL_OnOff', schedule: 'LL_Schedule', volume: 'LL_TankVolume', valveInv: 'LL_ValveInverse' };

function blockHeader(d: Dialect, kind: 'FUNCTION_BLOCK' | 'FUNCTION', name: string, ret?: string) {
  if (d === 'scl') return `${kind} "${name}"${ret ? ` : ${ret}` : ''}\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1`;
  return `${kind} ${name}${ret ? ` : ${ret}` : ''}`;
}

/** SCL refers to locals as #name; IEC ST just uses the name. */
const loc = (d: Dialect) => (name: string) => (d === 'scl' ? `#${name}` : name);

function pidBlock(d: Dialect, proc: ProcessDef, pid: PidParams, Ts: number, inLo: number, inHi: number) {
  const v = loc(d);
  const tt = pid.Td > 0 ? `SQRT(${v('Ti')} * ${v('Td')})` : v('Ti');
  const awLine = pid.antiWindup === 'clamp'
    ? `    // Conditional integration: stop integrating while the output is pinned and the error pushes it further.
    IF NOT ((${v('v')} > ${v('OutHigh')} AND ${v('iNext')} > ${v('Integral')}) OR (${v('v')} < ${v('OutLow')} AND ${v('iNext')} < ${v('Integral')})) THEN
        ${v('Integral')} := ${v('iNext')};
    END_IF;`
    : pid.antiWindup === 'backcalc'
      ? `    // Back-calculation: bleed the integral back by how far the output is past its limit.
    ${v('Integral')} := ${v('iNext')} + ${v('Cycle')} / MAX(IN1 := ${tt}, IN2 := ${v('Cycle')}) * (${v('u')} - ${v('v')});`
      : `    // No anti-windup (for comparison only).
    ${v('Integral')} := ${v('iNext')};`;
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.pid)}
   VAR_INPUT
      Setpoint : Real;        // ${proc.pv.unit}
      Input : Real;           // measured ${proc.pv.label.toLowerCase()}, ${proc.pv.unit}
      ManualEnable : Bool;    // TRUE = manual: Output follows ManualValue
      ManualValue : Real;     // %
      Cycle : Real := ${real(Ts)};    // s, must match the cyclic interrupt the block is called from
   END_VAR
   VAR_OUTPUT
      Output : Real;          // %
   END_VAR
   VAR
      Gain : Real := ${real(pid.Kc)};        // % output per % of span
      Ti : Real := ${real(pid.Ti)};          // s, 0 = no integral action
      Td : Real := ${real(pid.Td)};          // s, 0 = no derivative action
      PWeighting : Real := ${real(pid.b)};   // setpoint weight b on P
      DWeighting : Real := ${real(pid.c)};   // setpoint weight c on D
      TdFiltRatio : Real := ${real(pid.a)};  // derivative filter = TdFiltRatio * Td
      InLow : Real := ${real(inLo)};
      InHigh : Real := ${real(inHi)};
      OutLow : Real := ${real(pid.outLo)};
      OutHigh : Real := ${real(pid.outHi)};
      Invert : Bool := ${pid.invert ? 'TRUE' : 'FALSE'};
      Integral : Real;        // integral term, in % output (so gain changes don't bump)
      DTerm : Real;
      LastED : Real;
   END_VAR
   VAR_TEMP
      sp : Real;
      pv : Real;
      dir : Real;
      e : Real;
      eP : Real;
      eD : Real;
      p : Real;
      tf : Real;
      iNext : Real;
      v : Real;
      u : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    // Scale to % of span: the gains are then independent of engineering units.
    ${v('sp')} := (${v('Setpoint')} - ${v('InLow')}) / (${v('InHigh')} - ${v('InLow')}) * 100.0;
    ${v('pv')} := (${v('Input')} - ${v('InLow')}) / (${v('InHigh')} - ${v('InLow')}) * 100.0;
    ${v('dir')} := 1.0;
    IF ${v('Invert')} THEN
        ${v('dir')} := -1.0;
    END_IF;
    ${v('e')} := ${v('dir')} * (${v('sp')} - ${v('pv')});
    ${v('eP')} := ${v('dir')} * (${v('PWeighting')} * ${v('sp')} - ${v('pv')});
    ${v('eD')} := ${v('dir')} * (${v('DWeighting')} * ${v('sp')} - ${v('pv')});
    ${v('p')} := ${v('Gain')} * ${v('eP')};

    IF ${v('ManualEnable')} THEN
        // Track: preload the integral so switching to auto doesn't bump the output.
        ${v('u')} := LIMIT(MN := ${v('OutLow')}, IN := ${v('ManualValue')}, MX := ${v('OutHigh')});
        ${v('Integral')} := ${v('u')} - ${v('p')};
        ${v('DTerm')} := 0.0;
        ${v('LastED')} := ${v('eD')};
        ${v('Output')} := ${v('u')};
        RETURN;
    END_IF;

    // Derivative on c*SP - PV through a first-order filter (backward Euler).
    IF ${v('Td')} > 0.0 THEN
        ${v('tf')} := MAX(IN1 := ${v('TdFiltRatio')} * ${v('Td')}, IN2 := 1.0E-6);
        ${v('DTerm')} := ${v('tf')} / (${v('tf')} + ${v('Cycle')}) * ${v('DTerm')}
                  + ${v('Gain')} * ${v('Td')} / (${v('tf')} + ${v('Cycle')}) * (${v('eD')} - ${v('LastED')});
    ELSE
        ${v('DTerm')} := 0.0;
    END_IF;
    ${v('LastED')} := ${v('eD')};

    IF ${v('Ti')} > 0.0 THEN
        ${v('iNext')} := ${v('Integral')} + ${v('Gain')} * ${v('Cycle')} / ${v('Ti')} * ${v('e')};
    ELSE
        ${v('iNext')} := ${v('Integral')};
    END_IF;

    ${v('v')} := ${v('p')} + ${v('iNext')} + ${v('DTerm')};
    ${v('u')} := LIMIT(MN := ${v('OutLow')}, IN := ${v('v')}, MX := ${v('OutHigh')});

    IF ${v('Ti')} > 0.0 THEN
${awLine}
    END_IF;

    ${v('Output')} := ${v('u')};
END_FUNCTION_BLOCK`;
}

function onOffBlock(d: Dialect, proc: ProcessDef, c: Extract<ControllerConfig, { kind: 'onoff' }>) {
  const v = loc(d);
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.onoff)}
   VAR_INPUT
      Setpoint : Real;    // ${proc.pv.unit}
      Input : Real;       // ${proc.pv.unit}
   END_VAR
   VAR_OUTPUT
      Output : Real;      // %
   END_VAR
   VAR
      Hysteresis : Real := ${real((c.hyst / 100) * pvSpan(proc))};   // ${proc.pv.unit}, total band
      OutOn : Real := ${real(c.outOn)};
      OutOff : Real := ${real(c.outOff)};
      IsOn : Bool;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    IF ${v('Input')} < ${v('Setpoint')} - ${v('Hysteresis')} / 2.0 THEN
        ${v('IsOn')} := TRUE;
    ELSIF ${v('Input')} > ${v('Setpoint')} + ${v('Hysteresis')} / 2.0 THEN
        ${v('IsOn')} := FALSE;
    END_IF;
    IF ${v('IsOn')} THEN
        ${v('Output')} := ${v('OutOn')};
    ELSE
        ${v('Output')} := ${v('OutOff')};
    END_IF;
END_FUNCTION_BLOCK`;
}

function scheduleFunction(d: Dialect, points: { at: number; Kc: number; Ti: number; Td: number }[]) {
  const v = loc(d);
  // Sorted, and a repeated breakpoint dropped (it would divide by zero).
  const pts = [...points].sort((a, b) => a.at - b.at).filter((p, i, arr) => i === 0 || p.at > arr[i - 1].at);
  const set =(p: { Kc: number; Ti: number; Td: number }, indent: string) =>
    `${indent}${v('Gain')} := ${real(p.Kc)};
${indent}${v('Ti')} := ${real(p.Ti)};
${indent}${v('Td')} := ${real(p.Td)};`;
  const lerp = (key: 'Kc' | 'Ti' | 'Td', a: (typeof pts)[number], b: (typeof pts)[number]) =>
    `${real(a[key])} + ${v('w')} * (${real(b[key])} - ${real(a[key])})`;
  const branches: string[] = [`    IF ${v('X')} <= ${real(pts[0].at)} THEN
${set(pts[0], '        ')}`];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    branches.push(`    ELSIF ${v('X')} <= ${real(b.at)} THEN
        ${v('w')} := (${v('X')} - ${real(a.at)}) / ${real(b.at - a.at)};
        ${v('Gain')} := ${lerp('Kc', a, b)};
        ${v('Ti')} := ${lerp('Ti', a, b)};
        ${v('Td')} := ${lerp('Td', a, b)};`);
  }
  branches.push(`    ELSE
${set(pts[pts.length - 1], '        ')}
    END_IF;`);
  return `${blockHeader(d, 'FUNCTION', NAMES.schedule, 'Void')}
   VAR_INPUT
      X : Real;           // scheduling variable
   END_VAR
   VAR_OUTPUT
      Gain : Real;
      Ti : Real;
      Td : Real;
   END_VAR
   VAR_TEMP
      w : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    // Linear interpolation between the breakpoints, held flat outside them.
${branches.join('\n')}
END_FUNCTION`;
}

function volumeFunction(d: Dialect, p: Params) {
  const v = loc(d);
  return `${blockHeader(d, 'FUNCTION', NAMES.volume, 'Real')}
   VAR_INPUT
      Level : Real;       // m
   END_VAR
   VAR CONSTANT
      H_ : Real := ${real(p.H)};    // tank height, m
      R_ : Real := ${real(p.R)};    // top radius, m
      R0_ : Real := ${real(p.r0)};  // bottom radius, m
   END_VAR
   VAR_TEMP
      h : Real;
      alpha : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    // Volume of a cone frustum filled to Level: pi * ((r0 + alpha*h)^3 - r0^3) / (3*alpha).
    ${v('h')} := LIMIT(MN := 0.0, IN := ${v('Level')}, MX := ${v('H_')});
    ${v('alpha')} := (${v('R_')} - ${v('R0_')}) / ${v('H_')};
    IF ABS(${v('alpha')}) < 1.0E-9 THEN
        ${d === 'scl' ? `#${NAMES.volume}` : NAMES.volume} := 3.14159265 * ${v('R0_')} * ${v('R0_')} * ${v('h')};
    ELSE
        ${d === 'scl' ? `#${NAMES.volume}` : NAMES.volume} := 3.14159265 * ((${v('R0_')} + ${v('alpha')} * ${v('h')}) ** 3 - ${v('R0_')} ** 3) / (3.0 * ${v('alpha')});
    END_IF;
END_FUNCTION`;
}

function valveInverseFunction(d: Dialect, kind: number) {
  const v = loc(d);
  const ret = d === 'scl' ? `#${NAMES.valveInv}` : NAMES.valveInv;
  const body = kind === 1
    ? `    // Equal percentage, rangeability 50: f = (50^s - 1) / 49  =>  s = ln(1 + 49 f) / ln(50)
    ${ret} := 100.0 * LN(1.0 + 49.0 * ${v('y')}) / LN(50.0);`
    : kind === 2
      ? `    // Quick opening: f = sqrt(s)  =>  s = f^2
    ${ret} := 100.0 * ${v('y')} * ${v('y')};`
      : `    // Linear valve: nothing to invert.
    ${ret} := 100.0 * ${v('y')};`;
  return `${blockHeader(d, 'FUNCTION', NAMES.valveInv, 'Real')}
   VAR_INPUT
      Demand : Real;      // % of full flow the controller asks for
   END_VAR
   VAR_TEMP
      y : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('y')} := LIMIT(MN := 0.0, IN := ${v('Demand')}, MX := 100.0) / 100.0;
${body}
END_FUNCTION`;
}

/** How the blocks are called each cycle (OB30 in TIA; a cyclic task elsewhere). */
function callSite(d: Dialect, proc: ProcessDef, config: ControllerConfig, p: Params) {
  const tag = (name: string) => (d === 'scl' ? `"${name}"` : name.replace(/-/g, '_'));
  const db = d === 'scl' ? `"${proc.tags.loop.replace('-', '_')}_DB"` : `${proc.tags.loop.replace('-', '_')}`;
  const pv = tag(proc.tags.transmitter), out = tag(proc.tags.valve);
  const intro = d === 'scl'
    ? `// OB30 "Cyclic interrupt", cycle time ${real(p.Ts)} s (${Math.round(p.Ts * 1000)} ms).\n// ${pv} is the scaled input (NORM_X/SCALE_X from the analog card), ${out} the output to scale back to 0-27648.`
    : `// Call from a cyclic task with interval ${Math.round(p.Ts * 1000)} ms.`;
  if (config.kind === 'onoff') {
    return `${intro}\n${db}(Setpoint := ${tag('SP')}, Input := ${pv});\n${out} := ${db}.Output;`;
  }
  const lines = [intro];
  let input = pv;
  if (config.kind === 'characterized') {
    const ch = findCharacterization(proc, config.char);
    if (ch?.on === 'pv') {
      lines.push(`// Control volume rather than level: convert both measurement and setpoint.`);
      lines.push(`${tag('PV_Volume')} := ${d === 'scl' ? `"${NAMES.volume}"` : NAMES.volume}(Level := ${pv});`);
      lines.push(`${tag('SP_Volume')} := ${d === 'scl' ? `"${NAMES.volume}"` : NAMES.volume}(Level := ${tag('SP')});`);
      input = tag('PV_Volume');
      lines.push(`${db}(Setpoint := ${tag('SP_Volume')}, Input := ${input}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
      lines.push(`${out} := ${db}.Output;`);
      return lines.join('\n');
    }
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`// The controller asks for a flow fraction; turn it into a stem position.`);
    lines.push(`${out} := ${d === 'scl' ? `"${NAMES.valveInv}"` : NAMES.valveInv}(Demand := ${db}.Output);`);
    return lines.join('\n');
  }
  if (config.kind === 'schedule') {
    const x = config.on === 'sp' ? tag('SP') : pv;
    lines.push(`// Look up the gains for where the process is now, then run the PID with them.`);
    lines.push(`${d === 'scl' ? `"${NAMES.schedule}"` : NAMES.schedule}(X := ${x}, Gain => ${db}.Gain, Ti => ${db}.Ti, Td => ${db}.Td);`);
  }
  lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
  lines.push(`${out} := ${db}.Output;`);
  return lines.join('\n');
}

function pidInputRange(proc: ProcessDef, config: ControllerConfig, p: Params) {
  if (config.kind === 'characterized') {
    const ch = findCharacterization(proc, config.char);
    if (ch?.on === 'pv') return [ch.f(proc.pv.lo, p), ch.f(proc.pv.hi, p)];
  }
  return [proc.pv.lo, proc.pv.hi];
}

export function exportCode(proc: ProcessDef, config: ControllerConfig, rawParams: Params, dialect: Dialect) {
  const p = cleanParams(proc, rawParams);
  const parts: string[] = [];
  const title = dialect === 'scl' ? 'TIA Portal SCL (S7-1200 / S7-1500)' : 'IEC 61131-3 Structured Text (CODESYS, TwinCAT, ...)';
  parts.push(`// Loop Lab export: ${proc.name}, ${proc.tags.loop}\n// ${title}. Generated code: review before use on a real plant.`);
  if (config.kind === 'onoff') {
    parts.push(onOffBlock(dialect, proc, config));
  } else {
    if (config.kind === 'schedule') parts.push(scheduleFunction(dialect, config.points));
    if (config.kind === 'characterized') {
      const ch = findCharacterization(proc, config.char);
      if (ch?.id === 'volume') parts.push(volumeFunction(dialect, p));
      if (ch?.id === 'valve-inverse') parts.push(valveInverseFunction(dialect, p.valveChar));
    }
    const [lo, hi] = pidInputRange(proc, config, p);
    parts.push(pidBlock(dialect, proc, config.pid, p.Ts, lo, hi));
  }
  parts.push(callSite(dialect, proc, config, p));
  return parts.join('\n\n');
}

/** The same algorithm as plain TypeScript, with nothing hidden. */
export function exportReference(config: ControllerConfig, rawTs: number) {
  if (config.kind === 'onoff') {
    return `// On-off with hysteresis (band in % of span).
let on = false;
function onOff(spPct: number, pvPct: number): number {
  const e = spPct - pvPct;
  if (e > ${config.hyst} / 2) on = true;
  else if (e < -${config.hyst} / 2) on = false;
  return on ? ${config.outOn} : ${config.outOff};
}`;
  }
  const p = config.pid;
  return `// Ideal PID with setpoint weights, filtered derivative and ${p.antiWindup === 'none' ? 'no' : p.antiWindup === 'clamp' ? 'conditional-integration' : 'back-calculation'} anti-windup.
// Inputs in % of span, output in %. Called every Ts = ${rawTs} s.
const Ts = ${rawTs};
let Kc = ${p.Kc}, Ti = ${p.Ti}, Td = ${p.Td};  // ${config.kind === 'schedule' ? 'updated from the schedule each cycle' : 'fixed'}
const b = ${p.b}, c = ${p.c}, a = ${p.a}, lo = ${p.outLo}, hi = ${p.outHi};
let I = 0, D = 0, lastED = 0;

function pid(sp: number, pv: number): number {
  const e = sp - pv, eP = b * sp - pv, eD = c * sp - pv;
  const P = Kc * eP;
  if (Td > 0) {
    const Tf = a * Td;
    D = (Tf / (Tf + Ts)) * D + ((Kc * Td) / (Tf + Ts)) * (eD - lastED);
  } else D = 0;
  lastED = eD;
  const iNext = Ti > 0 ? I + ((Kc * Ts) / Ti) * e : I;
  const v = P + iNext + D;
  const u = Math.min(hi, Math.max(lo, v));
${p.antiWindup === 'clamp'
    ? `  // Don't integrate further into a limit.
  if (!((v > hi && iNext > I) || (v < lo && iNext < I))) I = iNext;`
    : p.antiWindup === 'backcalc'
      ? `  const Tt = Td > 0 ? Math.sqrt(Ti * Td) : Ti;
  I = iNext + (Ts / Tt) * (u - v);`
      : `  I = iNext;`}
  return u;
}

// Manual mode: call every cycle with the manual output so auto starts bumpless.
function track(u: number, sp: number, pv: number) {
  I = u - Kc * (b * sp - pv);
  D = 0;
  lastED = c * sp - pv;
}`;
}

export type ParamRow = { name: string; value: string; note: string };

/** The equivalent Siemens PID_Compact (technology object) settings, where they exist. */
export function pidCompactParams(proc: ProcessDef, config: ControllerConfig, rawParams: Params): ParamRow[] | null {
  if (config.kind === 'onoff') return null;
  const p = cleanParams(proc, rawParams);
  const pid = config.kind === 'schedule' ? { ...config.pid, ...config.points[Math.floor(config.points.length / 2)] } : config.pid;
  const [lo, hi] = pidInputRange(proc, config, p);
  const span = hi - lo;
  const unit = config.kind === 'characterized' && findCharacterization(proc, config.char)?.on === 'pv' ? findCharacterization(proc, config.char)?.unit ?? '' : proc.pv.unit;
  const rows: ParamRow[] = [
    { name: 'Retain.CtrlParams.Gain', value: real((pid.Kc * 100) / span), note: `PID_Compact works on the input in engineering units, so its gain is in %/${unit}: Kc × 100 / span (${real(span)} ${unit}). Same loop, different number — a common mix-up.` },
    { name: 'Retain.CtrlParams.Ti', value: real(pid.Ti), note: pid.Ti > 0 ? 'Integral time, s.' : '0.0 switches integral action off.' },
    { name: 'Retain.CtrlParams.Td', value: real(pid.Td), note: pid.Td > 0 ? 'Derivative time, s.' : '0.0 switches derivative action off.' },
    { name: 'Retain.CtrlParams.TdFiltRatio', value: real(pid.a), note: 'Derivative filter coefficient a: filter time = a × Td.' },
    { name: 'Retain.CtrlParams.PWeighting', value: real(pid.b), note: 'Setpoint weight b on the P term. Below 1 softens the kick on setpoint changes.' },
    { name: 'Retain.CtrlParams.DWeighting', value: real(pid.c), note: 'Setpoint weight c on the D term. 0 = derivative on measurement only (no setpoint kick).' },
    { name: 'Retain.CtrlParams.Cycle', value: real(p.Ts), note: `Controller sampling time, s. Call PID_Compact from a cyclic interrupt OB (e.g. OB30) at ${Math.round(p.Ts * 1000)} ms.` },
    { name: 'Config.OutputLowerLimit / OutputUpperLimit', value: `${real(pid.outLo)} / ${real(pid.outHi)}`, note: 'Output limits, %. PID_Compact stops integrating at these limits (its own anti-windup).' },
    { name: 'Config.InvertControl', value: pid.invert ? 'TRUE' : 'FALSE', note: 'TRUE when more output lowers the PV (e.g. a valve on the outlet).' },
    { name: 'Config.InputLowerLimit / InputUpperLimit', value: `${real(lo)} / ${real(hi)}`, note: `Measurement range, ${unit}. Use Input_PER with Config.InputScaling for a raw 0–27648 analog value.` },
  ];
  if (config.kind === 'schedule') {
    rows.unshift({ name: 'Gain scheduling', value: 'not built in', note: 'PID_Compact has one parameter set. Values below are the middle breakpoint; the exported SCL writes the scheduled gains into an LL_PID instance every cycle instead.' });
  }
  if (pid.antiWindup === 'backcalc') {
    rows.push({ name: 'Anti-windup', value: 'clamping', note: 'PID_Compact uses its own anti-windup; back-calculation needs the custom block.' });
  }
  return rows;
}
