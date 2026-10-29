import { findCharacterization, type ControllerConfig, type FeedforwardTerm, type PidParams, type SmithModel } from './controllers';
import { cleanParams, pvSpan, type Params, type ProcessDef } from './model';
import { initialArx } from './adaptive';
import { designAdrc, type AdrcDesign } from './adrc';
import { ST_INPUTS, ST_OUTPUTS, compileCustom } from './controllers';
import { decoupler, designMpc, mimoModel, steadyGains, type MpcDesign } from './multivar';
import { stripDeclarations, toScl } from './st';
import { designStateFb, type StateFbDesign } from './statespace';

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
const NAMES = { pid: 'LL_PID', onoff: 'LL_OnOff', schedule: 'LL_Schedule', volume: 'LL_TankVolume', valveInv: 'LL_ValveInverse', leadLag: 'LL_LeadLag', smith: 'LL_Smith', stateFb: 'LL_StateFb', mpc: 'LL_Mpc', adrc: 'LL_Adrc', selfTune: 'LL_SelfTune', custom: 'LL_Custom' };

/** Longest dead time the Smith predictor block can hold, in controller cycles. */
const SMITH_BUFFER = 1000;

function blockHeader(d: Dialect, kind: 'FUNCTION_BLOCK' | 'FUNCTION', name: string, ret?: string) {
  if (d === 'scl') return `${kind} "${name}"${ret ? ` : ${ret}` : ''}\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1`;
  return `${kind} ${name}${ret ? ` : ${ret}` : ''}`;
}

/** SCL refers to locals as #name; IEC ST just uses the name. */
const loc = (d: Dialect) => (name: string) => (d === 'scl' ? `#${name}` : name);

function pidBlock(d: Dialect, pid: PidParams, Ts: number, inLo: number, inHi: number) {
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
      Setpoint : Real;        // engineering units
      Input : Real;           // measurement, engineering units
      ManualEnable : Bool;    // TRUE = manual: Output follows ManualValue
      ManualValue : Real;     // %
      Feedforward : Real;     // %, added to the output (0 when unused)
      HoldIntegral : Int;     // +1 / -1: don't integrate up / down (a cascade slave is saturated)
      ExtResetEnable : Bool;  // override: this controller is not selected, so its integral follows ExtReset
      ExtReset : Real;        // %, the selected (valve) output, for external reset feedback
      Cycle : Real := ${real(Ts)};    // s, must match the cyclic interrupt the block is called from
   END_VAR
   VAR_OUTPUT
      Output : Real;          // %
      AtLimit : Int;          // +1 / -1 when the output is pinned high / low
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
        ${v('Integral')} := ${v('u')} - ${v('p')} - ${v('Feedforward')};
        ${v('DTerm')} := 0.0;
        ${v('LastED')} := ${v('eD')};
        ${v('Output')} := ${v('u')};
        ${v('AtLimit')} := 0;
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

    IF ${v('ExtResetEnable')} AND ${v('Ti')} > 0.0 THEN
        // External reset feedback: the integral follows the selected output through a Ti lag,
        // so this controller's output is the valve signal plus its own P and D.
        ${v('iNext')} := ${v('Integral')} + ${v('Cycle')} / MAX(IN1 := ${v('Ti')}, IN2 := ${v('Cycle')}) * (${v('ExtReset')} - ${v('Integral')});
    ELSIF ${v('Ti')} > 0.0 THEN
        ${v('iNext')} := ${v('Integral')} + ${v('Gain')} * ${v('Cycle')} / ${v('Ti')} * ${v('e')};
    ELSE
        ${v('iNext')} := ${v('Integral')};
    END_IF;

    ${v('v')} := ${v('p')} + ${v('iNext')} + ${v('DTerm')} + ${v('Feedforward')};
    ${v('u')} := LIMIT(MN := ${v('OutLow')}, IN := ${v('v')}, MX := ${v('OutHigh')});

    // A saturated slave asks its master to stop integrating in that direction.
    IF ${v('ExtResetEnable')} THEN
        ${v('Integral')} := ${v('iNext')};
    ELSIF ${v('Ti')} > 0.0 AND NOT ((${v('HoldIntegral')} > 0 AND ${v('iNext')} > ${v('Integral')}) OR (${v('HoldIntegral')} < 0 AND ${v('iNext')} < ${v('Integral')})) THEN
${awLine.replace(/^/gm, '    ')}
    END_IF;

    IF ${v('v')} > ${v('OutHigh')} THEN
        ${v('AtLimit')} := 1;
    ELSIF ${v('v')} < ${v('OutLow')} THEN
        ${v('AtLimit')} := -1;
    ELSE
        ${v('AtLimit')} := 0;
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

function leadLagBlock(d: Dialect, Ts: number) {
  const v = loc(d);
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.leadLag)}
   VAR_INPUT
      In : Real;              // the measured disturbance, engineering units
      Reset : Bool;           // TRUE (e.g. in manual): re-zero on the present value
      Gain : Real;            // % per unit of the disturbance
      Lead : Real;            // s
      Lag : Real;             // s
      Cycle : Real := ${real(Ts)};
   END_VAR
   VAR_OUTPUT
      Out : Real;             // %, zero at the value it started from
   END_VAR
   VAR
      Started : Bool;
      X0 : Real;
      XPrev : Real;
      Y : Real;
   END_VAR
   VAR_TEMP
      x : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    // Deviation from where the loop was switched on, so feedforward starts bumpless.
    IF ${v('Reset')} OR NOT ${v('Started')} THEN
        ${v('X0')} := ${v('In')};
        ${v('XPrev')} := 0.0;
        ${v('Y')} := 0.0;
        ${v('Started')} := TRUE;
    END_IF;
    ${v('x')} := ${v('In')} - ${v('X0')};
    // Backward Euler of (Lead*s + 1) / (Lag*s + 1).
    ${v('Y')} := ${v('Lag')} / (${v('Lag')} + ${v('Cycle')}) * ${v('Y')}
              + (${v('Lead')} + ${v('Cycle')}) / (${v('Lag')} + ${v('Cycle')}) * ${v('x')}
              - ${v('Lead')} / (${v('Lag')} + ${v('Cycle')}) * ${v('XPrev')};
    ${v('XPrev')} := ${v('x')};
    ${v('Out')} := ${v('Gain')} * ${v('Y')};
END_FUNCTION_BLOCK`;
}

function smithBlock(d: Dialect, model: SmithModel, Ts: number, inLo: number, inHi: number) {
  const v = loc(d);
  const last = SMITH_BUFFER - 1;
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.smith)}
   VAR_INPUT
      Input : Real;           // measurement, engineering units
      PidOutput : Real;       // the PID's output from the last cycle, %
      Reset : Bool;           // TRUE (e.g. in manual): restart the model from the present output
      Cycle : Real := ${real(Ts)};
   END_VAR
   VAR_OUTPUT
      Corrected : Real;       // to the PID's Input: the measurement with the dead time predicted away
   END_VAR
   VAR
      K : Real := ${real(model.K)};          // model gain, % of span per % output
      Tau : Real := ${real(model.tau)};        // model lag, s
      DeadTime : Real := ${real(model.theta)};   // model dead time, s (at most ${SMITH_BUFFER} cycles)
      InLow : Real := ${real(inLo)};
      InHigh : Real := ${real(inHi)};
      Buffer : Array[0..${last}] of Real;   // the model output over the last DeadTime
      Head : DInt;
      Ym : Real;              // undelayed model output, % (deviation from where it started)
      U0 : Real;
      Started : Bool;
   END_VAR
   VAR_TEMP
      n : DInt;
      i : DInt;
      a : Real;
      ymd : Real;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('n')} := LIMIT(MN := 0, IN := TRUNC(${v('DeadTime')} / ${v('Cycle')}), MX := ${SMITH_BUFFER});
    IF ${v('Reset')} OR NOT ${v('Started')} THEN
        ${v('U0')} := ${v('PidOutput')};
        ${v('Ym')} := 0.0;
        ${v('Head')} := 0;
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('Buffer')}[${v('i')}] := 0.0;
        END_FOR;
        ${v('Started')} := TRUE;
    ELSE
        // One cycle of K / (Tau*s + 1) driven by last cycle's output (exact for a held output).
        ${v('a')} := 0.0;
        IF ${v('Tau')} > 0.0 THEN
            ${v('a')} := EXP(-${v('Cycle')} / ${v('Tau')});
        END_IF;
        ${v('Ym')} := ${v('a')} * ${v('Ym')} + (1.0 - ${v('a')}) * ${v('K')} * (${v('PidOutput')} - ${v('U0')});
    END_IF;

    // The same model, DeadTime later: a ring buffer of the last n values.
    IF ${v('n')} > 0 THEN
        IF ${v('Head')} >= ${v('n')} THEN
            ${v('Head')} := 0;
        END_IF;
        ${v('ymd')} := ${v('Buffer')}[${v('Head')}];
        ${v('Buffer')}[${v('Head')}] := ${v('Ym')};
        ${v('Head')} := (${v('Head')} + 1) MOD ${v('n')};
    ELSE
        ${v('ymd')} := ${v('Ym')};
    END_IF;

    // Measurement + (what the model says is coming − what the model says is arriving now).
    ${v('Corrected')} := ${v('Input')} + (${v('Ym')} - ${v('ymd')}) / 100.0 * (${v('InHigh')} - ${v('InLow')});
END_FUNCTION_BLOCK`;
}

/** An LReal literal with enough digits for an observer matrix (entries a hair away from 1). */
function lreal(v: number) {
  if (!Number.isFinite(v)) return '0.0';
  const n = Number(v.toPrecision(10));
  if (n !== 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e7)) {
    const [m, e] = n.toExponential().split('e');
    return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
  }
  const t = n.toString();
  return t.includes('.') ? t : `${t}.0`;
}

/** Array initializer, row by row, wrapped for reading. */
function arrayInit(values: number[], perLine: number, indent: string) {
  const rows: string[] = [];
  for (let i = 0; i < values.length; i += perLine) rows.push(values.slice(i, i + perLine).map(lreal).join(', '));
  return rows.join(`,\n${indent}`);
}

/**
 * State feedback with an observer, as one block: the controller's states
 * (the estimate and the integral) are updated with the discretized design,
 * then the output is computed from them. Matrices are generated for this
 * design and this cycle time.
 */
function stateFbBlock(d: Dialect, proc: ProcessDef, des: StateFbDesign) {
  const v = loc(d);
  const nc = des.disc.Phi.length, my = des.inputs.length, nw = my + 2;
  const last = nc - 1;
  const sec = proc.secondary;
  const two = des.inputs.includes('pv2') && sec;
  const ind = '         ';
  const range = (k: 'pv' | 'pv2') => (k === 'pv' ? { lo: proc.pv.lo, hi: proc.pv.hi, y0: des.y0, name: 'Input' } : { lo: sec!.lo, hi: sec!.hi, y0: des.y20, name: 'Input2' });
  const meas = des.inputs.map((k, i) => {
    const r = range(k);
    return `    ${v('W')}[${i + 1}] := (${v(r.name)} - ${real(r.lo)}) / ${real(r.hi - r.lo)} * 100.0 - ${lreal(r.y0)};`;
  }).join('\n');
  const extra = des.mode !== 'none';
  const pvRow = des.Cpv.concat(extra ? [0] : []);
  const C = des.ctrl.C;
  const zIdx = extra ? des.n : -1;
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.stateFb)}
   // ${des.states.map((st, i) => `x[${i}] ${st}`).join('; ')}.
   VAR_INPUT
      Setpoint : Real;        // ${proc.pv.unit}
      Input : Real;           // ${proc.tags.transmitter}, ${proc.pv.unit}${two ? `\n      Input2 : Real;          // ${sec!.tag}, ${sec!.unit}` : ''}
      ManualEnable : Bool;
      ManualValue : Real;     // %
   END_VAR
   VAR_OUTPUT
      Output : Real;          // %
      Estimate : Real;        // the observer's estimate of Input, ${proc.pv.unit}
   END_VAR
   VAR
      // x <- Phi*x + Gam*w with w = [last output, measurement${my > 1 ? 's' : ''}, setpoint] (deviations from the design point, %).
      Phi : Array[0..${last}, 0..${last}] of LReal := [${arrayInit(des.disc.Phi.flat(), nc, ind)}];
      Gam : Array[0..${last}, 0..${nw - 1}] of LReal := [${arrayInit(des.disc.Gamma.flat(), nw, ind)}];
      // Output = U0 + Cout*x + Nr*r: the state feedback gains with their sign.
      Cout : Array[0..${last}] of LReal := [${arrayInit(C, 8, ind)}];
      Nx : Array[0..${last}] of LReal := [${arrayInit(des.Nx.concat(extra ? [0] : []), 8, ind)}];
      Cpv : Array[0..${last}] of LReal := [${arrayInit(pvRow, 8, ind)}];
      Nr : LReal := ${lreal(des.Nr)};
      U0 : LReal := ${lreal(des.u0)};        // design point: output, %
      Y0 : LReal := ${lreal(des.y0)};        // design point: measurement, % of span
      X : Array[0..${last}] of LReal;
      XNew : Array[0..${last}] of LReal;
      W : Array[0..${nw - 1}] of LReal;
      ULast : LReal;
      Started : Bool;
   END_VAR
   VAR_TEMP
      i : Int;
      j : Int;
      r : LReal;
      dy : LReal;
      u : LReal;
      acc : LReal;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('r')} := (${v('Setpoint')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0 - ${v('Y0')};
    ${v('W')}[0] := ${v('ULast')} - ${v('U0')};
${meas}
    ${v('W')}[${nw - 1}] := ${v('r')};
    IF ${v('ManualEnable')} OR NOT ${v('Started')} THEN
        // Track: the steady state that matches the measurement${extra ? `, the ${des.integral ? 'integral' : 'disturbance estimate'} set so the output equals ManualValue` : ''}.
        ${v('dy')} := (${v('Input')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0 - ${v('Y0')};
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('X')}[${v('i')}] := ${v('Nx')}[${v('i')}] * ${v('dy')};
        END_FOR;${extra ? `
        ${v('acc')} := ${v('U0')} + ${v('Nr')} * ${v('r')};
        FOR ${v('i')} := 0 TO ${last - 1} DO
            ${v('acc')} := ${v('acc')} + ${v('Cout')}[${v('i')}] * ${v('X')}[${v('i')}];
        END_FOR;
        ${v('X')}[${zIdx}] := (${v('ManualValue')} - ${v('acc')}) / ${v('Cout')}[${zIdx}];` : ''}
        ${v('u')} := ${v('ManualValue')};
        ${v('Started')} := TRUE;
    ELSE
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('acc')} := 0.0;
            FOR ${v('j')} := 0 TO ${last} DO
                ${v('acc')} := ${v('acc')} + ${v('Phi')}[${v('i')}, ${v('j')}] * ${v('X')}[${v('j')}];
            END_FOR;
            FOR ${v('j')} := 0 TO ${nw - 1} DO
                ${v('acc')} := ${v('acc')} + ${v('Gam')}[${v('i')}, ${v('j')}] * ${v('W')}[${v('j')}];
            END_FOR;
            ${v('XNew')}[${v('i')}] := ${v('acc')};
        END_FOR;
        ${v('u')} := ${v('U0')} + ${v('Nr')} * ${v('r')};
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('u')} := ${v('u')} + ${v('Cout')}[${v('i')}] * ${v('XNew')}[${v('i')}];
        END_FOR;${des.integral ? `
        // Anti-windup: keep the old integral if the new one pushes a saturated output further.
        ${v('acc')} := ${v('Cout')}[${zIdx}] * (${v('XNew')}[${zIdx}] - ${v('X')}[${zIdx}]);
        IF (${v('u')} > 100.0 AND ${v('acc')} > 0.0) OR (${v('u')} < 0.0 AND ${v('acc')} < 0.0) THEN
            ${v('u')} := ${v('u')} - ${v('acc')};
            ${v('XNew')}[${zIdx}] := ${v('X')}[${zIdx}];
        END_IF;` : ''}
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('X')}[${v('i')}] := ${v('XNew')}[${v('i')}];
        END_FOR;
    END_IF;
    ${v('Output')} := LREAL_TO_REAL(LIMIT(MN := 0.0, IN := ${v('u')}, MX := 100.0));
    ${v('ULast')} := ${v('Output')};   // the observer needs what was really applied
    ${v('acc')} := ${v('Y0')};
    FOR ${v('i')} := 0 TO ${last} DO
        ${v('acc')} := ${v('acc')} + ${v('Cpv')}[${v('i')}] * ${v('X')}[${v('i')}];
    END_FOR;
    ${v('Estimate')} := LREAL_TO_REAL(${real(proc.pv.lo)} + ${v('acc')} / 100.0 * ${real(proc.pv.hi - proc.pv.lo)});
END_FUNCTION_BLOCK`;
}

/** The state-feedback controller as plain TypeScript. */
function stateFbReference(proc: ProcessDef, des: StateFbDesign, Ts: number) {
  const mat = (M: number[][]) => `[\n${M.map((r) => `  [${r.map((x) => Number(x.toPrecision(10))).join(', ')}],`).join('\n')}\n]`;
  const vec = (a: number[]) => `[${a.map((x) => Number(x.toPrecision(10))).join(', ')}]`;
  const nc = des.disc.Phi.length;
  return `// State feedback with an observer, discretized for Ts = ${Ts} s.
// States: ${des.states.join('; ')}.
// Everything in deviations from the design point: output ${Number(des.u0.toPrecision(6))} %, measurement ${Number(des.y0.toPrecision(6))} % of span.
// Measurements used: ${des.inputs.map((k) => (k === 'pv' ? proc.tags.transmitter : proc.secondary?.tag)).join(', ')} (in % of span).
const Phi = ${mat(des.disc.Phi)};
// Columns: last output, measurement${des.inputs.length > 1 ? 's' : ''}, setpoint.
const Gam = ${mat(des.disc.Gamma)};
const Cout = ${vec(des.ctrl.C)};   // −K${des.integral ? ', −Kz' : des.mode === 'dist' ? ', Nd' : ''}
const Nx = ${vec(des.Nx.concat(des.mode !== 'none' ? [0] : []))};
const Nr = ${Number(des.Nr.toPrecision(10))}, U0 = ${Number(des.u0.toPrecision(10))}, Y0 = ${Number(des.y0.toPrecision(10))}${des.inputs.includes('pv2') ? `, Y20 = ${Number(des.y20.toPrecision(10))}` : ''};
let x = new Array(${nc}).fill(0), uLast = U0;

/** One cycle: setpoint and measurements in % of span → output %. */
function step(spPct: number, ${des.inputs.map((k) => (k === 'pv' ? 'pvPct: number' : 'pv2Pct: number')).join(', ')}): number {
  const r = spPct - Y0;
  const w = [uLast - U0, ${des.inputs.map((k) => (k === 'pv' ? 'pvPct - Y0' : 'pv2Pct - Y20')).join(', ')}, r];
  const next = Phi.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + Gam[i].reduce((s, g, j) => s + g * w[j], 0));${des.integral ? `
  let u = U0 + Nr * r + Cout.reduce((s, c, i) => s + c * next[i], 0);
  // Anti-windup: don't let the integral push a saturated output further.
  const push = Cout[${des.n}] * (next[${des.n}] - x[${des.n}]);
  if ((u > 100 && push > 0) || (u < 0 && push < 0)) { u -= push; next[${des.n}] = x[${des.n}]; }` : `
  const u = U0 + Nr * r + Cout.reduce((s, c, i) => s + c * next[i], 0);`}
  x = next;
  uLast = Math.min(100, Math.max(0, u));   // the observer needs what was really applied
  return uLast;
}

// Manual mode: start from the steady state that matches the measurement${des.mode !== 'none' ? `, with the ${des.integral ? 'integral' : 'disturbance estimate'} set so the output equals the manual value` : ''}.
function track(u: number, spPct: number, pvPct: number) {
  x = Nx.map((n) => n * (pvPct - Y0));${des.mode !== 'none' ? `
  const rest = Cout.slice(0, ${des.n}).reduce((s, c, i) => s + c * x[i], 0);
  x[${des.n}] = (u - U0 - Nr * (spPct - Y0) - rest) / Cout[${des.n}];` : ''}
  uLast = u;
}`;
}

/**
 * MPC as one block: observer update, the QP's linear term, then projected
 * Gauss–Seidel sweeps over the planned moves (each clipped to the valve
 * limits). Matrices generated for this design and this cycle time.
 */
function mpcBlock(d: Dialect, proc: ProcessDef, des: MpcDesign, sweeps: number) {
  const v = loc(d);
  const sec = proc.secondary!;
  const n = des.n, no = n + 2, nz = des.lo.length;
  const ind = '         ';
  const arr = (name: string, rows: number[][], comment = '') =>
    `      ${name} : Array[0..${rows.length - 1}, 0..${rows[0].length - 1}] of LReal := [${arrayInit(rows.flat(), rows[0].length, ind)}];${comment ? `   // ${comment}` : ''}`;
  const vec = (name: string, a: number[]) => `      ${name} : Array[0..${a.length - 1}] of LReal := [${arrayInit(a, 8, ind)}];`;
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.mpc)}
   // Two valves (${proc.tags.valve}, ${proc.mimo!.valve}), two measurements (${proc.tags.transmitter}, ${sec.tag}); ${nz / 2} planned moves each.
   VAR_INPUT
      Setpoint : Real;        // ${proc.pv.unit}
      Setpoint2 : Real;       // ${sec.unit}
      Input : Real;           // ${proc.tags.transmitter}, ${proc.pv.unit}
      Input2 : Real;          // ${sec.tag}, ${sec.unit}
      ManualEnable : Bool;
      ManualValue : Real;     // ${proc.tags.valve}, %
      ManualValue2 : Real;    // ${proc.mimo!.valve}, %
   END_VAR
   VAR_OUTPUT
      Output : Real;          // ${proc.tags.valve}, %
      Output2 : Real;         // ${proc.mimo!.valve}, %
   END_VAR
   VAR
      // Observer: Xo <- Phio*Xo + Gamo*[last outputs, measurements] (deviations from the design point, %).
${arr('Phio', des.Phio)}
${arr('Gamo', des.Gamo)}
      // The plan: minimize Z'HZ + 2F'Z with F = Fx*X + Fd*D + Fr*R + Fu*ULast, Lo <= Z <= Hi.
${arr('H', des.H)}
${arr('Fx', des.Fx)}
${arr('Fd', des.Fd)}
${arr('Fr', des.Fr)}
${arr('Fu', des.Fu)}
${vec('Lo', des.lo)}
${vec('Hi', des.hi)}
      // For the bumpless start: steady state for a valve change, and the outputs it gives.
${arr('Xu', des.Xu)}
${arr('Cy', des.Cy)}
      U0 : Array[0..1] of LReal := [${lreal(des.u0[0])}, ${lreal(des.u0[1])}];
      Y0 : Array[0..1] of LReal := [${lreal(des.y0[0])}, ${lreal(des.y0[1])}];
      Sweeps : Int := ${sweeps};
      Xo : Array[0..${no - 1}] of LReal;
      XNew : Array[0..${no - 1}] of LReal;
      Z : Array[0..${nz - 1}] of LReal;
      F : Array[0..${nz - 1}] of LReal;
      W : Array[0..3] of LReal;
      ULast : Array[0..1] of LReal;
      Started : Bool;
   END_VAR
   VAR_TEMP
      i : Int;
      j : Int;
      s : Int;
      acc : LReal;
      zi : LReal;
      r1 : LReal;
      r2 : LReal;
      cx : Array[0..1, 0..1] of LReal;
      det : LReal;
      v0 : LReal;
      v1 : LReal;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('W')}[2] := (${v('Input')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0 - ${v('Y0')}[0];
    ${v('W')}[3] := (${v('Input2')} - ${real(sec.lo)}) / ${real(sec.hi - sec.lo)} * 100.0 - ${v('Y0')}[1];
    ${v('r1')} := (${v('Setpoint')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0 - ${v('Y0')}[0];
    ${v('r2')} := (${v('Setpoint2')} - ${real(sec.lo)}) / ${real(sec.hi - sec.lo)} * 100.0 - ${v('Y0')}[1];
    IF ${v('ManualEnable')} OR NOT ${v('Started')} THEN
        // Track: a steady state with the valves where they are, plus the loads that explain the readings.
        ${v('ULast')}[0] := ${v('ManualValue')} - ${v('U0')}[0];
        ${v('ULast')}[1] := ${v('ManualValue2')} - ${v('U0')}[1];
        FOR ${v('i')} := 0 TO 1 DO
            FOR ${v('j')} := 0 TO 1 DO
                ${v('acc')} := 0.0;
                FOR ${v('s')} := 0 TO ${n - 1} DO
                    ${v('acc')} := ${v('acc')} + ${v('Cy')}[${v('i')}, ${v('s')}] * ${v('Xu')}[${v('s')}, ${v('j')}];
                END_FOR;
                ${v('cx')}[${v('i')}, ${v('j')}] := ${v('acc')};
            END_FOR;
        END_FOR;
        ${v('det')} := ${v('cx')}[0, 0] * ${v('cx')}[1, 1] - ${v('cx')}[0, 1] * ${v('cx')}[1, 0];
        ${v('v0')} := (${v('cx')}[1, 1] * ${v('W')}[2] - ${v('cx')}[0, 1] * ${v('W')}[3]) / ${v('det')};
        ${v('v1')} := (${v('cx')}[0, 0] * ${v('W')}[3] - ${v('cx')}[1, 0] * ${v('W')}[2]) / ${v('det')};
        FOR ${v('i')} := 0 TO ${n - 1} DO
            ${v('Xo')}[${v('i')}] := ${v('Xu')}[${v('i')}, 0] * ${v('v0')} + ${v('Xu')}[${v('i')}, 1] * ${v('v1')};
        END_FOR;
        ${v('Xo')}[${n}] := ${v('v0')} - ${v('ULast')}[0];
        ${v('Xo')}[${n + 1}] := ${v('v1')} - ${v('ULast')}[1];
        FOR ${v('i')} := 0 TO ${nz - 1} DO
            ${v('Z')}[${v('i')}] := ${v('ULast')}[${v('i')} MOD 2];
        END_FOR;
        ${v('Started')} := TRUE;
    ELSE
        ${v('W')}[0] := ${v('ULast')}[0];
        ${v('W')}[1] := ${v('ULast')}[1];
        FOR ${v('i')} := 0 TO ${no - 1} DO
            ${v('acc')} := 0.0;
            FOR ${v('j')} := 0 TO ${no - 1} DO
                ${v('acc')} := ${v('acc')} + ${v('Phio')}[${v('i')}, ${v('j')}] * ${v('Xo')}[${v('j')}];
            END_FOR;
            FOR ${v('j')} := 0 TO 3 DO
                ${v('acc')} := ${v('acc')} + ${v('Gamo')}[${v('i')}, ${v('j')}] * ${v('W')}[${v('j')}];
            END_FOR;
            ${v('XNew')}[${v('i')}] := ${v('acc')};
        END_FOR;
        FOR ${v('i')} := 0 TO ${no - 1} DO
            ${v('Xo')}[${v('i')}] := ${v('XNew')}[${v('i')}];
        END_FOR;
        FOR ${v('i')} := 0 TO ${nz - 1} DO
            ${v('acc')} := ${v('Fd')}[${v('i')}, 0] * ${v('Xo')}[${n}] + ${v('Fd')}[${v('i')}, 1] * ${v('Xo')}[${n + 1}]
                + ${v('Fr')}[${v('i')}, 0] * ${v('r1')} + ${v('Fr')}[${v('i')}, 1] * ${v('r2')}
                + ${v('Fu')}[${v('i')}, 0] * ${v('ULast')}[0] + ${v('Fu')}[${v('i')}, 1] * ${v('ULast')}[1];
            FOR ${v('j')} := 0 TO ${n - 1} DO
                ${v('acc')} := ${v('acc')} + ${v('Fx')}[${v('i')}, ${v('j')}] * ${v('Xo')}[${v('j')}];
            END_FOR;
            ${v('F')}[${v('i')}] := ${v('acc')};
        END_FOR;
        // Warm start: last cycle's plan, one cycle on.
        FOR ${v('i')} := 0 TO ${nz - 3} DO
            ${v('Z')}[${v('i')}] := ${v('Z')}[${v('i')} + 2];
        END_FOR;
        // Projected Gauss-Seidel: minimize over one move at a time, clipped to the valve limits.
        FOR ${v('s')} := 1 TO ${v('Sweeps')} DO
            FOR ${v('i')} := 0 TO ${nz - 1} DO
                ${v('acc')} := ${v('F')}[${v('i')}];
                FOR ${v('j')} := 0 TO ${nz - 1} DO
                    ${v('acc')} := ${v('acc')} + ${v('H')}[${v('i')}, ${v('j')}] * ${v('Z')}[${v('j')}];
                END_FOR;
                ${v('zi')} := ${v('Z')}[${v('i')}] - ${v('acc')} / ${v('H')}[${v('i')}, ${v('i')}];
                ${v('Z')}[${v('i')}] := LIMIT(MN := ${v('Lo')}[${v('i')}], IN := ${v('zi')}, MX := ${v('Hi')}[${v('i')}]);
            END_FOR;
        END_FOR;
        ${v('ULast')}[0] := ${v('Z')}[0];
        ${v('ULast')}[1] := ${v('Z')}[1];
    END_IF;
    ${v('Output')} := LREAL_TO_REAL(LIMIT(MN := 0.0, IN := ${v('U0')}[0] + ${v('ULast')}[0], MX := 100.0));
    ${v('Output2')} := LREAL_TO_REAL(LIMIT(MN := 0.0, IN := ${v('U0')}[1] + ${v('ULast')}[1], MX := 100.0));
END_FUNCTION_BLOCK`;
}

/** MPC as plain TypeScript: the same steps as the block. */
function mpcReference(proc: ProcessDef, des: MpcDesign, Ts: number) {
  const mat = (M: number[][]) => `[\n${M.map((r) => `  [${r.map((x) => Number(x.toPrecision(10))).join(', ')}],`).join('\n')}\n]`;
  const vec = (a: number[]) => `[${a.map((x) => Number(x.toPrecision(10))).join(', ')}]`;
  return `// Model predictive control of ${proc.name.toLowerCase()}, every Ts = ${Ts} s.
// Deviations from the design point: valves ${des.u0.map((x) => Number(x.toPrecision(6))).join(' / ')} %, outputs ${des.y0.map((x) => Number(x.toPrecision(6))).join(' / ')} % of span.
const Phio = ${mat(des.Phio)};
const Gamo = ${mat(des.Gamo)};   // columns: last outputs (2), measurements (2)
const H = ${mat(des.H)};
const Fx = ${mat(des.Fx)};
const Fd = ${mat(des.Fd)}, Fr = ${mat(des.Fr)}, Fu = ${mat(des.Fu)};
const lo = ${vec(des.lo)}, hi = ${vec(des.hi)};
const n = ${des.n};
let xo = new Array(${des.n + 2}).fill(0), z = new Array(${des.lo.length}).fill(0), uLast = [0, 0];
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** One cycle: setpoints and measurements in % of span (deviations) → both valve changes, %. */
function step(r: [number, number], y: [number, number]): [number, number] {
  xo = Phio.map((row, i) => dot(row, xo) + dot(Gamo[i], [...uLast, ...y]));
  const x = xo.slice(0, n), d = xo.slice(n);
  const f = Fx.map((row, i) => dot(row, x) + dot(Fd[i], d) + dot(Fr[i], r) + dot(Fu[i], uLast));
  z = [...z.slice(2), ...z.slice(-2)];   // warm start: last plan, one cycle on
  for (let s = 0; s < 200; s++) {        // projected Gauss–Seidel
    for (let i = 0; i < z.length; i++) {
      const g = f[i] + dot(H[i], z);
      z[i] = Math.min(hi[i], Math.max(lo[i], z[i] - g / H[i][i]));
    }
  }
  uLast = [z[0], z[1]];                  // only the first move is used; plan again next cycle
  return [z[0], z[1]];
}`;
}

/** ADRC as one block: the discretized extended state observer, then the law. */
function adrcBlock(d: Dialect, proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'adrc' }>, des: AdrcDesign) {
  const v = loc(d);
  const m = des.n + 1, last = m - 1;
  const ind = '         ';
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.adrc)}
   // Order ${des.n}: z[0] the output${des.n === 2 ? ', z[1] its rate' : ''}, z[${last}] the total disturbance f.
   VAR_INPUT
      Setpoint : Real;        // ${proc.pv.unit}
      Input : Real;           // ${proc.tags.transmitter}, ${proc.pv.unit}
      ManualEnable : Bool;
      ManualValue : Real;     // %
   END_VAR
   VAR_OUTPUT
      Output : Real;          // %
      Disturbance : Real;     // the estimated total disturbance, as the output it takes to cancel it (%)
   END_VAR
   VAR
      // Observer: z <- Phi*z + Gam*[last output, measurement] (ω_o ${real(config.wo)} rad/s, discretized for ${real(des.Ts)} s).
      Phi : Array[0..${last}, 0..${last}] of LReal := [${arrayInit(des.Phi.flat(), m, ind)}];
      Gam : Array[0..${last}, 0..1] of LReal := [${arrayInit(des.Gamma.flat(), 2, ind)}];
      // Law: Output = Cz*z + Dr*r, i.e. (kp*(r - z0)${des.n === 2 ? ' - kd*z1' : ''} - f) / b0 with ω_c ${real(config.wc)} rad/s, b0 ${real(config.b0)}.
      Cz : Array[0..${last}] of LReal := [${arrayInit(des.C, 8, ind)}];
      Dr : LReal := ${lreal(des.Dr)};
      B0 : LReal := ${lreal(config.b0)};
      Z : Array[0..${last}] of LReal;
      ZNew : Array[0..${last}] of LReal;
      ULast : LReal;
      Started : Bool;
   END_VAR
   VAR_TEMP
      i : Int;
      j : Int;
      y : LReal;
      r : LReal;
      u : LReal;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('y')} := (${v('Input')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0;
    ${v('r')} := (${v('Setpoint')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0;
    IF ${v('ManualEnable')} OR NOT ${v('Started')} THEN
        // At rest: the output where it is, nothing changing, f = -b0 * the output that holds it.
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('Z')}[${v('i')}] := 0.0;
        END_FOR;
        ${v('Z')}[0] := ${v('y')};
        ${v('Z')}[${last}] := -${v('B0')} * ${v('ManualValue')};
        ${v('u')} := ${v('ManualValue')};
        ${v('Started')} := TRUE;
    ELSE
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('ZNew')}[${v('i')}] := ${v('Gam')}[${v('i')}, 0] * ${v('ULast')} + ${v('Gam')}[${v('i')}, 1] * ${v('y')};
            FOR ${v('j')} := 0 TO ${last} DO
                ${v('ZNew')}[${v('i')}] := ${v('ZNew')}[${v('i')}] + ${v('Phi')}[${v('i')}, ${v('j')}] * ${v('Z')}[${v('j')}];
            END_FOR;
        END_FOR;
        ${v('u')} := ${v('Dr')} * ${v('r')};
        FOR ${v('i')} := 0 TO ${last} DO
            ${v('Z')}[${v('i')}] := ${v('ZNew')}[${v('i')}];
            ${v('u')} := ${v('u')} + ${v('Cz')}[${v('i')}] * ${v('Z')}[${v('i')}];
        END_FOR;
    END_IF;
    ${v('Output')} := LREAL_TO_REAL(LIMIT(MN := 0.0, IN := ${v('u')}, MX := 100.0));
    ${v('ULast')} := ${v('Output')};   // the observer needs what was really applied: no windup
    ${v('Disturbance')} := LREAL_TO_REAL(-${v('Z')}[${last}] / ${v('B0')});
END_FUNCTION_BLOCK`;
}

/**
 * The self-tuner: recursive least squares on y(k) = a·y(k−1) + b·u(k−1−d) + c, and SIMC from the
 * estimate, written to the PID's gains each cycle.
 */
function selfTuneBlock(d: Dialect, proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'adaptive' }>, Ts: number, start: { a: number; b: number }) {
  const v = loc(d);
  const dl = Math.max(0, Math.round(config.theta / Ts) - 1);
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.selfTune)}
   VAR_INPUT
      Input : Real;           // ${proc.tags.transmitter}, ${proc.pv.unit}
      PidOutput : Real;       // the PID's output this cycle, %
      Learn : Bool := TRUE;   // FALSE freezes the estimate (e.g. in manual, or when the operator says so)
   END_VAR
   VAR_OUTPUT
      Gain : Real;            // % per % of span: write to the PID
      Ti : Real;              // s
      ModelGain : Real;       // the estimate: K (% per %)
      ModelTau : Real;        // s
   END_VAR
   VAR
      Lambda : LReal := ${lreal(config.lambda)};   // forgetting: remembers about ${Math.round(1 / (1 - config.lambda))} cycles
      Tc : LReal := ${lreal(config.tc)};           // closed-loop time constant, s
      Theta : LReal := ${lreal(config.theta)};     // dead time, s
      Cycle : LReal := ${lreal(Ts)};
      Noise : LReal := ${lreal(0.01)};             // % of span: don't learn from movements smaller than this
      Kc0 : LReal := ${lreal(config.pid.Kc)};      // the gains it may move within 5x of
      Ti0 : LReal := ${lreal(config.pid.Ti)};
      Th : Array[0..2] of LReal := [${lreal(start.a)}, ${lreal(start.b)}, 0.0];   // a, b, c
      P : Array[0..2, 0..2] of LReal := [0.01, 0.0, 0.0, 0.0, 0.01, 0.0, 0.0, 0.0, 0.01];
      UHist : Array[0..${dl + 1}] of LReal;
      YPrev : LReal;
      Started : Bool;
   END_VAR
   VAR_TEMP
      i : Int;
      j : Int;
      y : LReal;
      phi : Array[0..2] of LReal;
      pphi : Array[0..2] of LReal;
      k : Array[0..2] of LReal;
      den : LReal;
      err : LReal;
      K : LReal;
      tau : LReal;
      span : LReal;
      kc : LReal;
      ti : LReal;
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
    ${v('y')} := (${v('Input')} - ${real(proc.pv.lo)}) / ${real(proc.pv.hi - proc.pv.lo)} * 100.0;
    IF NOT ${v('Started')} THEN
        FOR ${v('i')} := 0 TO ${dl + 1} DO
            ${v('UHist')}[${v('i')}] := ${v('PidOutput')};
        END_FOR;
        ${v('Th')}[2] := ${v('y')} - ${v('Th')}[0] * ${v('y')} - ${v('Th')}[1] * ${v('PidOutput')};
        ${v('YPrev')} := ${v('y')};
        ${v('Gain')} := LREAL_TO_REAL(${v('Kc0')});
        ${v('Ti')} := LREAL_TO_REAL(${v('Ti0')});
        ${v('Started')} := TRUE;
    END_IF;
    // phi = [y(k-1), u(k-1-d), 1]: UHist[${dl + 1}] is the oldest output kept.
    ${v('phi')}[0] := ${v('YPrev')};
    ${v('phi')}[1] := ${v('UHist')}[${dl + 1}];
    ${v('phi')}[2] := 1.0;
    ${v('err')} := ${v('y')} - (${v('Th')}[0] * ${v('phi')}[0] + ${v('Th')}[1] * ${v('phi')}[1] + ${v('Th')}[2]);
    // Learn only from real movement, and only from errors bigger than the noise.
    IF ${v('Learn')} AND (ABS(${v('UHist')}[0] - ${v('UHist')}[1]) > 0.02 OR ABS(${v('y')} - ${v('YPrev')}) > 3.0 * ${v('Noise')}) AND ABS(${v('err')}) > ${v('Noise')} THEN
        ${v('den')} := ${v('Lambda')};
        FOR ${v('i')} := 0 TO 2 DO
            ${v('pphi')}[${v('i')}] := 0.0;
            FOR ${v('j')} := 0 TO 2 DO
                ${v('pphi')}[${v('i')}] := ${v('pphi')}[${v('i')}] + ${v('P')}[${v('i')}, ${v('j')}] * ${v('phi')}[${v('j')}];
            END_FOR;
            ${v('den')} := ${v('den')} + ${v('phi')}[${v('i')}] * ${v('pphi')}[${v('i')}];
        END_FOR;
        FOR ${v('i')} := 0 TO 2 DO
            ${v('k')}[${v('i')}] := ${v('pphi')}[${v('i')}] / ${v('den')};
            ${v('Th')}[${v('i')}] := ${v('Th')}[${v('i')}] + ${v('k')}[${v('i')}] * ${v('err')};
        END_FOR;
        FOR ${v('i')} := 0 TO 2 DO
            FOR ${v('j')} := 0 TO 2 DO
                ${v('P')}[${v('i')}, ${v('j')}] := (${v('P')}[${v('i')}, ${v('j')}] - ${v('k')}[${v('i')}] * ${v('pphi')}[${v('j')}]) / ${v('Lambda')};
            END_FOR;
        END_FOR;
        // SIMC from the estimate (an integrator if a is about 1), kept within 5x of the start.
        ${v('span')} := ${v('Tc')} + ${v('Theta')};
        IF ${v('Th')}[0] < 0.9995 AND ${v('Th')}[0] > 0.0 THEN
            ${v('K')} := ${v('Th')}[1] / (1.0 - ${v('Th')}[0]);
            ${v('tau')} := -${v('Cycle')} / LN(${v('Th')}[0]);
            ${v('kc')} := ${v('tau')} / (ABS(${v('K')}) * ${v('span')});
            ${v('ti')} := MIN(IN1 := ${v('tau')}, IN2 := 4.0 * ${v('span')});
        ELSE
            ${v('K')} := 0.0;
            ${v('tau')} := 0.0;
            ${v('kc')} := ${v('Cycle')} / (ABS(${v('Th')}[1]) * ${v('span')});
            ${v('ti')} := 4.0 * ${v('span')};
        END_IF;
        IF ${v('Th')}[1] ${config.pid.invert ? '<' : '>'} 0.0 THEN   // only a model with the expected sign
            ${v('Gain')} := LREAL_TO_REAL(LIMIT(MN := ${v('Kc0')} / 5.0, IN := ${v('kc')}, MX := ${v('Kc0')} * 5.0));
            ${v('Ti')} := LREAL_TO_REAL(LIMIT(MN := ${v('Ti0')} / 5.0, IN := ${v('ti')}, MX := ${v('Ti0')} * 5.0));
        END_IF;
        ${v('ModelGain')} := LREAL_TO_REAL(${v('K')});
        ${v('ModelTau')} := LREAL_TO_REAL(${v('tau')});
    END_IF;
    ${v('YPrev')} := ${v('y')};
    FOR ${v('i')} := ${dl + 1} TO 1 BY -1 DO
        ${v('UHist')}[${v('i')}] := ${v('UHist')}[${v('i')} - 1];
    END_FOR;
    ${v('UHist')}[0] := ${v('PidOutput')};
END_FUNCTION_BLOCK`;
}

/** Your own Structured Text as an FB: the built-in inputs and outputs, your VARs as statics, your code as the body. */
function customBlock(d: Dialect, code: string) {
  const c = compileCustom(code);
  const vars = 'prog' in c ? c.prog.vars : [];
  const body = stripDeclarations(code);
  const names = new Set([...ST_INPUTS, ...ST_OUTPUTS, ...vars.map((x) => x.name)]);
  const ind = (s: string) => s.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n');
  const bools = new Set(['MANUAL']);
  const ty = (t: string) => (t === 'REAL' ? 'Real' : t === 'LREAL' ? 'LReal' : t === 'INT' ? 'Int' : t === 'DINT' ? 'DInt' : 'Bool');
  return `${blockHeader(d, 'FUNCTION_BLOCK', NAMES.custom)}
   VAR_INPUT
${ST_INPUTS.map((n) => `      ${n} : ${bools.has(n) ? 'Bool' : 'Real'};`).join('\n')}
   END_VAR
   VAR_OUTPUT
      OUT : Real;
      OUT2 : Real;
   END_VAR
   VAR
${vars.map((x) => `      ${x.name} : ${ty(x.type)}${x.init ? ` := ${x.type === 'BOOL' ? (x.init ? 'TRUE' : 'FALSE') : x.type.endsWith('INT') ? Math.trunc(x.init) : real(x.init)}` : ''};`).join('\n')}
   END_VAR
${d === 'scl' ? '\nBEGIN' : ''}
${ind(d === 'scl' ? toScl(body, names) : body)}
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
  const ffInst = (t: FeedforwardTerm) => (d === 'scl' ? `"FF_${t.from}_DB"` : `FF_${t.from}`);
  const ffOf = (terms: FeedforwardTerm[]) => {
    if (!terms.length) return '0.0';
    for (const t of terms) {
      const ds = proc.disturbances.find((x) => x.key === t.from);
      lines.push(`${ffInst(t)}(In := ${tag(ds?.measured ?? t.from)}, Reset := ${tag('Manual')}, Gain := ${real(t.gain)}, Lead := ${real(t.lead)}, Lag := ${real(t.lag)});`);
    }
    return terms.map((t) => `${ffInst(t)}.Out`).join(' + ');
  };
  if (config.kind === 'cascade' && proc.secondary) {
    const sec = proc.secondary;
    const inner = d === 'scl' ? `"${sec.loopTag.replace('-', '_')}_DB"` : sec.loopTag.replace('-', '_');
    const pv2 = tag(sec.tag);
    const span2 = sec.hi - sec.lo;
    lines.push(`// Cascade: ${proc.tags.loop} (master) sets the ${sec.label.toLowerCase()} setpoint; ${sec.loopTag} (slave) drives the valve.`);
    lines.push(`// Give the slave its own tuning once at start-up (OB100): ${inner}.Gain := ${real(config.inner.Kc)}; ${inner}.Ti := ${real(config.inner.Ti)}; ${inner}.Td := ${real(config.inner.Td)}; ${inner}.InLow := ${real(sec.lo)}; ${inner}.InHigh := ${real(sec.hi)};`);
    if (config.ff.length) lines.push(`// Feedforward goes into the slave's setpoint (% of the ${sec.label.toLowerCase()} span).`);
    const ff = ffOf(config.ff);
    lines.push(`// In manual the master tracks the slave's measurement, so switching to auto is bumpless.`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := (${pv2} - ${real(sec.lo)}) / ${real(span2)} * 100.0, Feedforward := ${ff}, HoldIntegral := ${inner}.AtLimit);`);
    lines.push(`${tag('SP2')} := ${real(sec.lo)} + ${db}.Output / 100.0 * ${real(span2)};`);
    lines.push(`${inner}(Setpoint := ${tag('SP2')}, Input := ${pv2}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${inner}.Output;`);
    return lines.join('\n');
  }
  if (config.kind === 'multiloop' && proc.mimo && proc.secondary) {
    const sec = proc.secondary, mimo = proc.mimo;
    const db2 = d === 'scl' ? `"${mimo.loop2.replace('-', '_')}_DB"` : mimo.loop2.replace('-', '_');
    const direct = config.pairing === 'direct';
    const { m, B2 } = mimoModel(proc, p);
    const dec = decoupler(steadyGains(m, B2), config.pairing);
    const s0 = proc.mimo.steady(proc.nominalPv, mimo.nominal2, Object.fromEntries(proc.disturbances.map((x) => [x.key, x.nominal])), p);
    const base = [s0?.valve ?? 50, s0?.u2 ?? 50];
    const [va, vb] = direct ? [out, tag(mimo.valve)] : [tag(mimo.valve), out];
    lines.push(`// Two loops: ${proc.tags.loop} (${proc.pv.label.toLowerCase()}) drives ${direct ? proc.tags.valve : mimo.valve}, ${mimo.loop2} (${sec.label.toLowerCase()}) drives ${direct ? mimo.valve : proc.tags.valve}.`);
    lines.push(`// Give ${mimo.loop2} its own tuning once at start-up (OB100): ${db2}.Gain := ${real(config.pid2.Kc)}; ${db2}.Ti := ${real(config.pid2.Ti)}; ${db2}.Td := ${real(config.pid2.Td)}; ${db2}.InLow := ${real(sec.lo)}; ${db2}.InHigh := ${real(sec.hi)}; ${db2}.Invert := ${config.pid2.invert ? 'TRUE' : 'FALSE'};`);
    lines.push(`// While a valve is pinned, the loop driving it holds its integral.`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')}, HoldIntegral := ${tag('SatA')});`);
    lines.push(`${db2}(Setpoint := ${tag('SP2')}, Input := ${tag(sec.tag)}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut2')}, HoldIntegral := ${tag('SatB')});`);
    if (config.decouple) {
      const a0 = base[dec.a], b0 = base[dec.b];
      lines.push(`// Static decoupler (from the steady-state gains at ${real(proc.nominalPv)} ${proc.pv.unit}): each loop also moves the other valve, just enough to cancel its effect on the other variable.`);
      lines.push(`${tag('W1')} := ${db}.Output - ${real(a0)};`);
      lines.push(`${tag('W2')} := ${db2}.Output - ${real(b0)};`);
      lines.push(`${tag('UA')} := ${real(a0)} + ${tag('W1')} + ${real(dec.ca)} * ${tag('W2')};`);
      lines.push(`${tag('UB')} := ${real(b0)} + ${tag('W2')} + ${real(dec.cb)} * ${tag('W1')};`);
    } else {
      lines.push(`${tag('UA')} := ${db}.Output;`);
      lines.push(`${tag('UB')} := ${db2}.Output;`);
    }
    lines.push(`${tag('SatA')} := SEL(G := ${tag('UA')} >= 100.0, IN0 := SEL(G := ${tag('UA')} <= 0.0, IN0 := 0, IN1 := -1), IN1 := 1);`);
    lines.push(`${tag('SatB')} := SEL(G := ${tag('UB')} >= 100.0, IN0 := SEL(G := ${tag('UB')} <= 0.0, IN0 := 0, IN1 := -1), IN1 := 1);`);
    lines.push(`${va} := LIMIT(MN := 0.0, IN := ${tag('UA')}, MX := 100.0);`);
    lines.push(`${vb} := LIMIT(MN := 0.0, IN := ${tag('UB')}, MX := 100.0);`);
    return lines.join('\n');
  }
  if (config.kind === 'adrc') {
    lines.push(`// ADRC: the observer and the law in one block, called every cycle (in manual too: it tracks).`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${db}.Output;`);
    lines.push(`// ${db}.Disturbance is what it is cancelling: trend it. On a batch reactor it follows the reaction heat.`);
    return lines.join('\n');
  }
  if (config.kind === 'adaptive') {
    const st = d === 'scl' ? `"${proc.tags.loop.replace('-', '_')}_Tune_DB"` : `${proc.tags.loop.replace('-', '_')}_Tune`;
    lines.push(`// Self-tuning: run the PID with the latest gains, then let the estimator learn from this cycle and retune.`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${db}.Output;`);
    lines.push(`${st}(Input := ${pv}, PidOutput := ${db}.Output, Learn := NOT ${tag('Manual')});`);
    lines.push(`${db}.Gain := ${st}.Gain;`);
    lines.push(`${db}.Ti := ${st}.Ti;`);
    lines.push(`// Show ${st}.ModelGain and .ModelTau on the HMI, with a button to freeze learning (Learn := FALSE).`);
    return lines.join('\n');
  }
  if (config.kind === 'custom') {
    const sec = proc.secondary;
    const pct = (x: string, lo: number, hi: number) => `(${x} - ${real(lo)}) / ${real(hi - lo)} * 100.0`;
    lines.push(`// Your own controller. TIME is a running time in s, if your code uses it (here a static you keep counting).`);
    lines.push(`${tag('RunTime')} := ${tag('RunTime')} + ${real(p.Ts)};`);
    const args = [
      `SP := ${tag('SP')}`, `PV := ${pv}`, `SP_PCT := ${pct(tag('SP'), proc.pv.lo, proc.pv.hi)}`, `PV_PCT := ${pct(pv, proc.pv.lo, proc.pv.hi)}`,
      ...(sec ? [`PV2 := ${tag(sec.tag)}`, `PV2_PCT := ${pct(tag(sec.tag), sec.lo, sec.hi)}`] : []),
      ...(proc.mimo && sec ? [`SP2 := ${tag('SP2')}`, `SP2_PCT := ${pct(tag('SP2'), sec.lo, sec.hi)}`, `MAN_OUT2 := ${tag('ManualOut2')}`] : []),
      `TS := ${real(p.Ts)}`, `TIME := ${tag('RunTime')}`, `MANUAL := ${tag('Manual')}`, `MAN_OUT := ${tag('ManualOut')}`,
    ];
    lines.push(`${db}(${args.join(', ')});`);
    lines.push(`${out} := ${db}.OUT;`);
    if (proc.mimo) lines.push(`${tag(proc.mimo.valve)} := ${db}.OUT2;`);
    return lines.join('\n');
  }
  if (config.kind === 'mpc' && proc.mimo && proc.secondary) {
    lines.push(`// MPC: one block plans both valves every cycle. In manual it tracks both, so auto is bumpless.`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Setpoint2 := ${tag('SP2')}, Input := ${pv}, Input2 := ${tag(proc.secondary.tag)}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')}, ManualValue2 := ${tag('ManualOut2')});`);
    lines.push(`${out} := ${db}.Output;`);
    lines.push(`${tag(proc.mimo.valve)} := ${db}.Output2;`);
    lines.push(`// Its cycle time is part of the design: the block's matrices are for ${real(p.Ts)} s.`);
    return lines.join('\n');
  }
  if (config.kind === 'statefb') {
    const des = designStateFb(proc, config, p);
    const in2 = des.inputs.includes('pv2') && proc.secondary ? `, Input2 := ${tag(proc.secondary.tag)}` : '';
    lines.push(`// State feedback: one block holds the observer, the gains and the integral. Call it every cycle, in manual too (it tracks).`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}${in2}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${db}.Output;`);
    lines.push(`// ${db}.Estimate is the observer's idea of ${pv}: trend it next to the real reading while commissioning.`);
    return lines.join('\n');
  }
  if (config.kind === 'smith') {
    const sm = d === 'scl' ? `"${proc.tags.loop.replace('-', '_')}_Smith_DB"` : `${proc.tags.loop.replace('-', '_')}_Smith`;
    lines.push(`// Smith predictor: feed it last cycle's PID output first, then give the PID its corrected measurement.`);
    lines.push(`${sm}(Input := ${pv}, PidOutput := ${db}.Output, Reset := ${tag('Manual')});`);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${sm}.Corrected, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${db}.Output;`);
    lines.push(`// Show ${pv} on the HMI, not the corrected value: the operator wants the real measurement.`);
    return lines.join('\n');
  }
  if (config.kind === 'override') {
    const on = config.on === 'pv2' && proc.secondary ? proc.secondary : null;
    const ovrIn = on ? tag(on.tag) : pv;
    const ovr = d === 'scl' ? `"${proc.tags.loop.replace('-', '_')}_Ovr_DB"` : `${proc.tags.loop.replace('-', '_')}_Ovr`;
    const fn = config.select === 'max' ? 'MAX' : 'MIN';
    lines.push(`// Override: ${proc.tags.loop} (normal) and a limit controller on ${on ? `${on.tag} (${on.label.toLowerCase()})` : pv} at ${real(config.limit)} ${on ? on.unit : proc.pv.unit}; the ${config.select === 'max' ? 'higher' : 'lower'} output drives ${out}.`);
    lines.push(`// Give the limit controller its own tuning once at start-up (OB100): ${ovr}.Gain := ${real(config.ovr.Kc)}; ${ovr}.Ti := ${real(config.ovr.Ti)}; ${ovr}.Td := ${real(config.ovr.Td)};${on ? ` ${ovr}.InLow := ${real(on.lo)}; ${ovr}.InHigh := ${real(on.hi)};` : ''}`);
    lines.push(config.tracking
      ? `// External reset: whichever controller lost the selection last cycle has its integral follow the valve signal.`
      : `// No tracking: each controller integrates on its own error even when it isn't selected (the windup case).`);
    const er = (who: string) => (config.tracking ? `ExtResetEnable := ${who}, ExtReset := ${tag('Out')}` : 'ExtResetEnable := FALSE, ExtReset := 0.0');
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')}, ${er(tag('OvrSelected'))});`);
    lines.push(`${ovr}(Setpoint := ${real(config.limit)}, Input := ${ovrIn}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')}, ${er(`NOT ${tag('OvrSelected')}`)});`);
    lines.push(`${tag('Out')} := ${fn}(IN1 := ${db}.Output, IN2 := ${ovr}.Output);`);
    lines.push(`${tag('OvrSelected')} := ${ovr}.Output ${config.select === 'max' ? '>' : '<'} ${db}.Output;  // show it on the faceplate: which controller has the valve`);
    lines.push(`${out} := ${tag('Out')};`);
    return lines.join('\n');
  }
  if (config.kind === 'ratio' && proc.secondary && proc.ratio) {
    const sec = proc.secondary;
    const inner = d === 'scl' ? `"${sec.loopTag.replace('-', '_')}_DB"` : sec.loopTag.replace('-', '_');
    const wildD = proc.disturbances.find((x) => x.key === proc.ratio!.from);
    const wild = tag(wildD?.measured ?? proc.ratio.from), pv2 = tag(sec.tag);
    lines.push(`// Ratio station: ${sec.loopTag} setpoint = R × ${wildD?.measured ?? 'the wild flow'} (${wildD?.label.toLowerCase() ?? 'wild flow'}).`);
    lines.push(`// Give the flow controller its own tuning once at start-up (OB100): ${inner}.Gain := ${real(config.inner.Kc)}; ${inner}.Ti := ${real(config.inner.Ti)}; ${inner}.InLow := ${real(sec.lo)}; ${inner}.InHigh := ${real(sec.hi)};`);
    if (config.trim) {
      lines.push(`// Trim: ${proc.tags.loop} sets R over ${real(config.rLo)}–${real(config.rHi)}; in manual it tracks the ratio being run, so auto is bumpless.`);
      lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := (${pv2} / MAX(IN1 := ${wild}, IN2 := 0.001) - ${real(config.rLo)}) / ${real(config.rHi - config.rLo)} * 100.0, HoldIntegral := ${inner}.AtLimit);`);
      lines.push(`${tag('Ratio')} := ${real(config.rLo)} + ${db}.Output / 100.0 * ${real(config.rHi - config.rLo)};`);
    } else lines.push(`${tag('Ratio')} := ${real(config.ratio)};  // fixed by the recipe`);
    lines.push(`${tag('SP2')} := LIMIT(MN := ${real(sec.lo)}, IN := ${tag('Ratio')} * ${wild}, MX := ${real(sec.hi)});`);
    lines.push(`${inner}(Setpoint := ${tag('SP2')}, Input := ${pv2}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')});`);
    lines.push(`${out} := ${inner}.Output;`);
    return lines.join('\n');
  }
  if (config.kind === 'feedforward') {
    const ff = ffOf(config.ff);
    lines.push(`${db}(Setpoint := ${tag('SP')}, Input := ${pv}, ManualEnable := ${tag('Manual')}, ManualValue := ${tag('ManualOut')}, Feedforward := ${ff});`);
    lines.push(`${out} := ${db}.Output;`);
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

/** Split-range: the one controller output to two valves, as the PLC (or two positioners) would split it. */
function splitRange(d: Dialect, proc: ProcessDef, p: Params) {
  const tag = (name: string) => (d === 'scl' ? `"${name}"` : name.replace(/-/g, '_'));
  const u = tag(proc.tags.valve), lo = p.split - p.gap / 2, hi = p.split + p.gap / 2;
  return [
    `// Split-range ${proc.tags.valve}: ${proc.split!.low} works over 0–${real(lo)} % (fully open at 0), ${proc.split!.high} over ${real(hi)}–100 %.`,
    p.gap > 0 ? `// Between them, a ${real(p.gap)} % gap where both are shut.` : `// No gap: one valve starts opening as the other closes.`,
    `${tag(proc.split!.low)} := LIMIT(MN := 0.0, IN := (${real(lo)} - ${u}) / ${real(Math.max(lo, 1e-3))} * 100.0, MX := 100.0);`,
    `${tag(proc.split!.high)} := LIMIT(MN := 0.0, IN := (${u} - ${real(hi)}) / ${real(Math.max(100 - hi, 1e-3))} * 100.0, MX := 100.0);`,
    `// Or calibrate the two positioners to 4–${real(4 + (16 * lo) / 100)} mA (reversed) and ${real(4 + (16 * hi) / 100)}–20 mA, and send one signal to both.`,
  ].join('\n');
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
    const ff = config.kind === 'feedforward' || config.kind === 'cascade' ? config.ff : [];
    if (ff.length) parts.push(leadLagBlock(dialect, p.Ts));
    if (config.kind === 'smith') parts.push(smithBlock(dialect, config.model, p.Ts, lo, hi));
    if (config.kind === 'statefb') parts.push(stateFbBlock(dialect, proc, designStateFb(proc, config, p)));
    else if (config.kind === 'mpc') parts.push(mpcBlock(dialect, proc, designMpc(proc, config, p), 200));
    else if (config.kind === 'adrc') parts.push(adrcBlock(dialect, proc, config, designAdrc(config, p.Ts)));
    else if (config.kind === 'custom') parts.push(customBlock(dialect, config.code));
    else if (config.kind === 'adaptive') { parts.push(pidBlock(dialect, config.pid, p.Ts, lo, hi)); parts.push(selfTuneBlock(dialect, proc, config, p.Ts, initialArx(proc, p))); }
    else parts.push(pidBlock(dialect, 'outer' in config ? config.outer : config.pid, p.Ts, lo, hi));
  }
  parts.push(callSite(dialect, proc, config, p));
  if (proc.split && config.kind !== 'onoff') parts.push(splitRange(dialect, proc, p));
  return parts.join('\n\n');
}

/** The same algorithm as plain TypeScript, with nothing hidden. */
export function exportReference(config: ControllerConfig, rawTs: number, proc?: ProcessDef, params?: Params) {
  if (config.kind === 'statefb') return proc ? stateFbReference(proc, designStateFb(proc, config, cleanParams(proc, params ?? {})), rawTs) : '// State feedback: needs the process model to export.';
  if (config.kind === 'mpc') return proc ? mpcReference(proc, designMpc(proc, config, cleanParams(proc, params ?? {})), rawTs) : '// MPC: needs the process model to export.';
  if (config.kind === 'custom') return `// Your own controller is its own reference: the Structured Text below, run every ${rawTs} s.\n\n${config.code}`;
  if (config.kind === 'adrc') {
    const des = designAdrc(config, rawTs);
    const mat = (M: number[][]) => `[\n${M.map((r) => `  [${r.map((x) => Number(x.toPrecision(10))).join(', ')}],`).join('\n')}\n]`;
    return `// Linear ADRC, order ${config.order}, every Ts = ${rawTs} s. Signals in % (output) and % of span (measurement).
// Observer bandwidth ω_o ${config.wo} rad/s, loop ω_c ${config.wc} rad/s, b0 ${config.b0}.
const Phi = ${mat(des.Phi)};
const Gam = ${mat(des.Gamma)};   // columns: last output, measurement
const C = [${des.C.map((x) => Number(x.toPrecision(10))).join(', ')}], Dr = ${Number(des.Dr.toPrecision(10))}, b0 = ${config.b0};
let z = new Array(${des.n + 1}).fill(0), uLast = 0;

function step(r: number, y: number): number {
  z = Phi.map((row, i) => row.reduce((s, v, j) => s + v * z[j], 0) + Gam[i][0] * uLast + Gam[i][1] * y);
  const u = C.reduce((s, c, i) => s + c * z[i], Dr * r);   // (kp(r − z0)${config.order === 2 ? ' − kd·z1' : ''} − f) / b0
  uLast = Math.min(100, Math.max(0, u));                   // the observer sees what was applied: no windup
  return uLast;
}

// Manual: z = [y, ${config.order === 2 ? '0, ' : ''}−b0·u], uLast = u.`;
  }
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
  const p = 'outer' in config ? config.outer : config.pid;
  const extra = config.kind === 'multiloop'
    ? `

// Two loops: a second copy of this PID (Kc ${config.pid2.Kc}, Ti ${config.pid2.Ti} s) on the second variable.
// Pairing: ${config.pairing === 'direct' ? 'this one drives the main valve, the second the second valve' : 'crossed: this one drives the second valve, the second the main valve'}.${config.decouple ? `
// Static decoupler: uA = a0 + w1 + cA·w2, uB = b0 + w2 + cB·w1, with w the PID outputs' changes from the design point.` : ''}`
    : config.kind === 'override'
    ? `

// Override: a second copy of this PID (Kc ${config.ovr.Kc}, Ti ${config.ovr.Ti} s) on ${config.on === 'pv2' ? 'the secondary measurement' : 'the same measurement'},
// setpoint ${config.limit}. Each cycle: out = ${config.select === 'max' ? 'Math.max' : 'Math.min'}(main, override).${config.tracking ? `
// External reset: the one not selected does I += (Ts / Ti) * (out - I) instead of integrating its error.` : ''}`
    : config.kind === 'ratio'
      ? `

// Ratio: this PID ${config.trim ? `is the trim; R = ${config.rLo} + output / 100 * ${config.rHi - config.rLo}` : `is not used; R = ${config.ratio}`}.
// The flow controller's setpoint is R * wildFlow; it runs the same algorithm (Kc ${config.inner.Kc}, Ti ${config.inner.Ti} s).`
      : config.kind === 'cascade'
    ? `

// Cascade: this PID is the master; its output (0-100 % of the secondary span) is the slave's setpoint.
// The slave runs the same algorithm with its own gains (Kc ${config.inner.Kc}, Ti ${config.inner.Ti} s).
// While the slave's output is pinned, hold the master's integral in that direction.`
    : '';
  const terms = config.kind === 'feedforward' || config.kind === 'cascade' ? config.ff : [];
  const smithCode = config.kind === 'smith' ? `

// Smith predictor: a model of the process, K/(tau·s + 1), and the same model n cycles later.
// Each cycle: pv = smith(pv, lastOutput) before calling pid(sp, pv).
const model = { K: ${config.model.K}, tau: ${config.model.tau}, theta: ${config.model.theta} };
const n = Math.floor(model.theta / Ts);
const aM = model.tau > 0 ? Math.exp(-Ts / model.tau) : 0;
const ring: number[] = new Array(n).fill(0);
let head = 0, ym = 0, u0 = 0;
function smith(pvPct: number, lastOutput: number): number {
  ym = aM * ym + (1 - aM) * model.K * (lastOutput - u0);
  const delayed = n ? ring[head] : ym;
  if (n) { ring[head] = ym; head = (head + 1) % n; }
  return pvPct + ym - delayed;
}
// In manual: u0 = the output, ym = 0, ring.fill(0).` : '';
  const ffCode = terms.length ? `

// Feedforward: gain·(lead·s + 1)/(lag·s + 1) on each measured disturbance, added to the output
// (to the slave's setpoint in cascade). Zero at the value it starts from.
${terms.map((t) => `const ff_${t.from} = { gain: ${t.gain}, lead: ${t.lead}, lag: ${t.lag}, x0: NaN, xPrev: 0, y: 0 };`).join('\n')}
function leadLag(f: { gain: number; lead: number; lag: number; x0: number; xPrev: number; y: number }, d: number) {
  if (Number.isNaN(f.x0)) f.x0 = d;
  const x = d - f.x0;
  f.y = (f.lag / (f.lag + Ts)) * f.y + ((f.lead + Ts) / (f.lag + Ts)) * x - (f.lead / (f.lag + Ts)) * f.xPrev;
  f.xPrev = x;
  return f.gain * f.y;
}` : '';
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
}${ffCode}${smithCode}${extra}`;
}

export type ParamRow = { name: string; value: string; note: string };

/** The equivalent Siemens PID_Compact (technology object) settings, where they exist. */
export function pidCompactParams(proc: ProcessDef, config: ControllerConfig, rawParams: Params): ParamRow[] | null {
  if (config.kind === 'onoff') return null;
  const p = cleanParams(proc, rawParams);
  if (config.kind === 'cascade') {
    const sec = proc.secondary!;
    const master = compactRows(config.outer, proc.pv.lo, proc.pv.hi, proc.pv.unit, p.Ts).map((r) => ({ ...r, name: `${proc.tags.loop}: ${r.name}` }));
    const slave = compactRows(config.inner, sec.lo, sec.hi, sec.unit, p.Ts).map((r) => ({ ...r, name: `${sec.loopTag}: ${r.name}` }));
    return [
      { name: 'Cascade', value: 'two controllers', note: `PID_Temp has cascade support built in (master/slave). With PID_Compact, wire the master's Output (scaled to ${real(sec.lo)}–${real(sec.hi)} ${sec.unit}) to the slave's Setpoint, and stop the master winding up while the slave is saturated yourself.` },
      ...master, ...slave,
      ...(config.ff.length ? [{ name: 'Feedforward', value: `${config.ff.length} term${config.ff.length > 1 ? 's' : ''}`, note: 'Added to the slave setpoint: compute it in your own code (the exported LL_LeadLag) before the slave call.' }] : []),
    ];
  }
  if (config.kind === 'ratio') {
    const sec = proc.secondary!;
    const trim = config.trim ? compactRows(config.outer, proc.pv.lo, proc.pv.hi, proc.pv.unit, p.Ts).map((r) => ({ ...r, name: `${proc.tags.loop}: ${r.name}` })) : [];
    const flow = compactRows(config.inner, sec.lo, sec.hi, sec.unit, p.Ts).map((r) => ({ ...r, name: `${sec.loopTag}: ${r.name}` }));
    return [
      { name: 'Ratio', value: config.trim ? `${real(config.rLo)}–${real(config.rHi)}` : real(config.ratio), note: `No ratio block in PID_Compact: compute SP = R × wild flow in your own code (one line, in the exported call), and write it to ${sec.loopTag}'s Setpoint.${config.trim ? ` The trim's Output (0–100 %) scales to R; Config.OutputLower/UpperLimit bound the ratio.` : ''}` },
      ...trim, ...flow,
    ];
  }
  if (config.kind === 'override') {
    const on = config.on === 'pv2' && proc.secondary ? proc.secondary : proc.pv;
    const main = compactRows(config.pid, proc.pv.lo, proc.pv.hi, proc.pv.unit, p.Ts).map((r) => ({ ...r, name: `${proc.tags.loop}: ${r.name}` }));
    const ovr = compactRows(config.ovr, on.lo, on.hi, on.unit, p.Ts).map((r) => ({ ...r, name: `Override: ${r.name}` }));
    return [
      { name: 'Override', value: `${config.select === 'max' ? 'MAX' : 'MIN'} of two`, note: `Two PID_Compact instances and a MAX/MIN in your code. PID_Compact has no external-reset input: the usual workaround is to put the one not selected in manual (ManualEnable) with ManualValue = the selected output, so it tracks; PID_Temp is no different. The exported LL_PID has ExtReset for the real thing.` },
      ...main, ...ovr,
    ];
  }
  if (config.kind === 'multiloop' && proc.mimo && proc.secondary) {
    const sec = proc.secondary;
    const { m, B2 } = mimoModel(proc, p);
    const dec = decoupler(steadyGains(m, B2), config.pairing);
    return [
      { name: 'Two loops', value: config.pairing === 'direct' ? 'direct pairing' : 'crossed pairing', note: `Two PID_Compact instances, one per variable. ${config.decouple ? `The decoupler is your own code between their outputs and the valves (c_A ${real(dec.ca)}, c_B ${real(dec.cb)}): see the exported call.` : 'Each drives its valve directly.'}` },
      ...compactRows(config.pid, proc.pv.lo, proc.pv.hi, proc.pv.unit, p.Ts).map((r) => ({ ...r, name: `${proc.tags.loop}: ${r.name}` })),
      ...compactRows(config.pid2, sec.lo, sec.hi, sec.unit, p.Ts).map((r) => ({ ...r, name: `${proc.mimo!.loop2}: ${r.name}` })),
    ];
  }
  if (config.kind === 'adrc') {
    return [
      { name: 'PID_Compact', value: 'not applicable', note: 'ADRC isn\'t a PID: use the exported LL_Adrc (an observer of ${config.order + 1} states and a gain row) in a cyclic interrupt OB. Some drives and motion libraries ship ADRC-style disturbance observers; in TIA it is your own SCL.' },
      { name: 'Cycle', value: real(p.Ts), note: 'The observer is discretized for this cycle: a different cycle needs a new export.' },
      { name: 'b₀', value: real(config.b0), note: `The plant\'s high-frequency gain (%/s${config.order === 2 ? '²' : ''} per %). Within a factor of two is usually enough; too small makes the loop aggressive, too large sluggish.` },
      { name: 'ω_c / ω_o', value: `${real(config.wc)} / ${real(config.wo)} rad/s`, note: 'Loop and observer bandwidths: the two tuning knobs. Keep ω_o 3–10× ω_c and well below 1/Ts.' },
    ];
  }
  if (config.kind === 'custom') {
    return [{ name: 'PID_Compact', value: 'not applicable', note: 'Your own code becomes the FB LL_Custom (exported below): its VAR become the FB\'s statics, the built-in names its inputs and outputs. Call it from a cyclic interrupt OB at the cycle it was tested at.' }];
  }
  if (config.kind === 'adaptive') {
    const rows = compactRows(config.pid, proc.pv.lo, proc.pv.hi, proc.pv.unit, p.Ts);
    return [
      { name: 'Self-tuning', value: 'not built in', note: 'PID_Compact\'s own tuning (pretuning and fine tuning) runs once, on demand, not continuously. For continuous adaptation run the exported LL_SelfTune beside it and write its Gain and Ti into Retain.CtrlParams every cycle; the values below are where it starts.' },
      ...rows,
    ];
  }
  if (config.kind === 'mpc') {
    const des = designMpc(proc, config, p);
    return [
      { name: 'PID_Compact', value: 'not applicable', note: 'MPC isn\'t a PID. TIA Portal has no standard MPC block for S7-1200/1500; the exported LL_Mpc runs the observer, the prediction and a small constrained optimization in SCL. SIMATIC PCS 7\'s Advanced Process Library has a small MPC block (ModPreCon) for a few variables; bigger MPCs run on a PC or an edge device and write setpoints to PID loops.' },
      { name: 'Cycle', value: real(p.Ts), note: 'The prediction matrices are for this cycle: a different cycle needs a new export.' },
      { name: 'Horizon', value: `${config.P} cycles (${real(config.P * p.Ts)} s)`, note: `${config.M} moves planned per valve; after that the valves are held.` },
      { name: 'Work per cycle', value: `${des.lo.length} variables`, note: `About ${(2 * des.lo.length * des.lo.length * 200 + 2 * (des.n + 2) ** 2).toLocaleString('en')} multiply-adds with 200 sweeps: a few ms on an S7-1500, fine at a ${real(p.Ts)} s cycle; check the cycle load on smaller CPUs.` },
      { name: 'Relative gain λ₁₁', value: real(des.lambda), note: 'At the design point. MPC doesn\'t need a pairing: it moves both valves together.' },
    ];
  }
  if (config.kind === 'statefb') {
    const des = designStateFb(proc, config, p);
    return [
      { name: 'PID_Compact', value: 'not applicable', note: 'State feedback isn\'t a PID: no standard Siemens block does it. Use the exported LL_StateFb (an observer and a gain row, about 2n² multiplications a cycle), called from a cyclic interrupt OB.' },
      { name: 'Cycle', value: real(p.Ts), note: `The design assumes the block runs every ${real(p.Ts)} s. A different cycle needs a new export: the matrices are discretized for this one.` },
      { name: 'Data type', value: 'LReal', note: 'The observer\'s matrices have entries a hair away from 1: in single-precision Real they round enough to move its poles. S7-1500 handles LReal natively; on an S7-1200 test carefully.' },
      ...des.states.map((st, i) => ({
        name: `Gain on ${st}`, value: real(des.ctrl.C[i]),
        note: i < des.n ? `Output change, %, per ${des.units[i]} of the estimate (away from the design point): −K.` : des.integral ? 'Output change, %, per %·s of integrated error.' : `Output change, %, per ${des.units[i]} of the estimated disturbance (cancels it where it acts).`,
      })),
      { name: 'Setpoint gain N_r', value: real(des.Nr), note: 'Feedforward from the setpoint (% output per % of span), so a setpoint change doesn\'t wait for the integral.' },
    ];
  }
  const pid = config.kind === 'schedule' ? { ...config.pid, ...config.points[Math.floor(config.points.length / 2)] } : config.pid;
  const [lo, hi] = pidInputRange(proc, config, p);
  const unit = config.kind === 'characterized' && findCharacterization(proc, config.char)?.on === 'pv' ? findCharacterization(proc, config.char)?.unit ?? '' : proc.pv.unit;
  const rows = compactRows(pid, lo, hi, unit, p.Ts);
  if (config.kind === 'schedule') {
    rows.unshift({ name: 'Gain scheduling', value: 'not built in', note: 'PID_Compact has one parameter set. Values below are the middle breakpoint; the exported SCL writes the scheduled gains into an LL_PID instance every cycle instead.' });
  }
  if (config.kind === 'smith') {
    rows.unshift({ name: 'Smith predictor', value: 'not built in', note: `PID_Compact has no dead-time compensation. Call the exported LL_Smith before it and wire its Corrected output to PID_Compact's Input; the gains below are then for the process without its ${real(config.model.theta)} s dead time.` });
  }
  if (config.kind === 'feedforward' && config.ff.length) {
    rows.push({ name: 'Disturbance (input)', value: 'feedforward', note: 'Newer PID_Compact versions add a Disturbance input straight to the output; check yours. Otherwise compute the feedforward (LL_LeadLag) and add it to the output yourself.' });
  }
  if (pid.antiWindup === 'backcalc') {
    rows.push({ name: 'Anti-windup', value: 'clamping', note: 'PID_Compact uses its own anti-windup; back-calculation needs the custom block.' });
  }
  return rows;
}

function compactRows(pid: PidParams, lo: number, hi: number, unit: string, Ts: number): ParamRow[] {
  const span = hi - lo;
  return [
    { name: 'Retain.CtrlParams.Gain', value: real((pid.Kc * 100) / span), note: `PID_Compact works on the input in engineering units, so its gain is in %/${unit}: Kc × 100 / span (${real(span)} ${unit}). Same loop, different number — a common mix-up.` },
    { name: 'Retain.CtrlParams.Ti', value: real(pid.Ti), note: pid.Ti > 0 ? 'Integral time, s.' : '0.0 switches integral action off.' },
    { name: 'Retain.CtrlParams.Td', value: real(pid.Td), note: pid.Td > 0 ? 'Derivative time, s.' : '0.0 switches derivative action off.' },
    { name: 'Retain.CtrlParams.TdFiltRatio', value: real(pid.a), note: 'Derivative filter coefficient a: filter time = a × Td.' },
    { name: 'Retain.CtrlParams.PWeighting', value: real(pid.b), note: 'Setpoint weight b on the P term. Below 1 softens the kick on setpoint changes.' },
    { name: 'Retain.CtrlParams.DWeighting', value: real(pid.c), note: 'Setpoint weight c on the D term. 0 = derivative on measurement only (no setpoint kick).' },
    { name: 'Retain.CtrlParams.Cycle', value: real(Ts), note: `Controller sampling time, s. Call PID_Compact from a cyclic interrupt OB (e.g. OB30) at ${Math.round(Ts * 1000)} ms.` },
    { name: 'Config.OutputLowerLimit / OutputUpperLimit', value: `${real(pid.outLo)} / ${real(pid.outHi)}`, note: 'Output limits, %. PID_Compact stops integrating at these limits (its own anti-windup).' },
    { name: 'Config.InvertControl', value: pid.invert ? 'TRUE' : 'FALSE', note: 'TRUE when more output lowers the PV (e.g. a valve on the outlet).' },
    { name: 'Config.InputLowerLimit / InputUpperLimit', value: `${real(lo)} / ${real(hi)}`, note: `Measurement range, ${unit}. Use Input_PER with Config.InputScaling for a raw 0–27648 analog value.` },
  ];
}
