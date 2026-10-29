import { defaultController } from './controllers';
import { defaultParams } from './model';
import { getProcess } from './processes';
import { Loop } from './sim';

// A sample step test to try the Identify tab with: the heat exchanger in
// manual, the valve stepped up, down and back, exported the way a TIA Portal
// trace comes out of a German-locale PC (semicolons, decimal commas).

export function sampleTrend() {
  const proc = getProcess('hx');
  const params = { ...defaultParams(proc), txNoise: 0.2 };
  const loop = new Loop(proc, { params, controller: defaultController('pid', proc), seed: 11 }, { sp: 60 });
  loop.setMode(false);
  const base = loop.manualOut;
  const steps = [[30, 10], [150, -10], [270, 5]] as const;
  const lines = ['TIA Portal trace (sample): heat exchanger bump test', 'Time [s];FV-301 output [%];TT-301 [°C]'];
  const n = Math.round(400 / loop.Ts);
  for (let i = 0; i < n; i++) {
    loop.manualOut = base + steps.filter(([t]) => loop.t >= t).reduce((s, [, du]) => s + du, 0);
    const s = loop.step();
    const num = (v: number, d: number) => v.toFixed(d).replace('.', ',');
    lines.push(`${num(s.t, 1)};${num(s.cv, 2)};${num(s.pv, 3)}`);
  }
  return lines.join('\n');
}
