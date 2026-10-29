'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MathText, Tex } from '@/components/daily/MathText';
import { CASES, CONTROLLER_CONTENT, PROCESS_CONTENT } from '@/lib/loop-lab/content';
import { controllerMeta, defaultController, isAvailable, type ControllerKind } from '@/lib/loop-lab/controllers';
import type { ProcessId } from '@/lib/loop-lab/model';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import { defaultExperiment, encodeExperiment, type Experiment } from '@/lib/loop-lab/setup';
import { TUNING_RULES } from '@/lib/loop-lab/tuning';
import { LATER_RUNGS } from './Bench';
import { BlockDiagram } from './Drawings';
import { AutomationView, CodeTabs, ControlView, MechanicalView } from './Views';
import { CONTROLLER_KINDS } from '@/lib/loop-lab/controllers';

const benchLink = (e: Experiment, tab = 'tests') => `/loop-lab?setup=${encodeExperiment(e)}#${tab}`;

export function ProcessReference({ id }: { id: ProcessId }) {
  const proc = getProcess(id);
  const exp = useMemo(() => defaultExperiment(id), [id]);
  const [tab, setTab] = useState<'mechanical' | 'control' | 'automation' | 'tests'>('mechanical');
  const cases = CASES.filter((c) => c.process === id);
  return (
    <div className="ll animate-fade-in" style={{ maxWidth: 1000 }}>
      <div className="ll-crumbs"><Link href="/loop-lab">Loop Lab</Link> / Processes</div>
      <div className="ll-head">
        <div>
          <h1>{proc.icon} {proc.name}</h1>
          <p>{proc.summary}</p>
          <p style={{ marginTop: '0.5rem' }}>
            <span className={`ll-badge${proc.family === 'pid-wins' ? ' is-good' : ' is-warn'}`}>{proc.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Link className="ll-btn is-primary" href={benchLink(exp)}>Open in the bench</Link>
          {cases.map((c) => <Link key={c.id} className="ll-btn" href={`/loop-lab/cases/${c.id}`}>Case study</Link>)}
        </div>
      </div>
      <div className="ll-card" style={{ marginBottom: '1rem' }}>
        <div className="ll-sub">Verdict</div>
        <MathText className="ll-prose">{PROCESS_CONTENT[id].verdict}</MathText>
      </div>
      <div className="ll-seg ll-tabs" role="tablist" aria-label="Perspective">
        <button role="tab" aria-selected={tab === 'mechanical'} onClick={() => setTab('mechanical')}>⚙️ Mechanical</button>
        <button role="tab" aria-selected={tab === 'control'} onClick={() => setTab('control')}>📉 Control</button>
        <button role="tab" aria-selected={tab === 'automation'} onClick={() => setTab('automation')}>🏭 Automation</button>
        <button role="tab" aria-selected={tab === 'tests'} onClick={() => setTab('tests')}>🧪 Test scripts</button>
      </div>
      {tab === 'mechanical' && <MechanicalView proc={proc} exp={exp} />}
      {tab === 'control' && <ControlView proc={proc} exp={exp} />}
      {tab === 'automation' && <AutomationView proc={proc} exp={exp} />}
      {tab === 'tests' && (
        <div className="ll-card">
          <p className="ll-small" style={{ marginTop: 0 }}>Every controller on this process runs exactly these scripts, so their scorecards can be compared.</p>
          {proc.scenarios.map((s) => (
            <div key={s.id} style={{ padding: '0.6rem 0', borderTop: '1px solid var(--surface-border)' }}>
              <strong>{s.name}</strong> <span className="ll-small">· {s.duration >= 600 ? `${Math.round(s.duration / 60)} min` : `${s.duration} s`}</span>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.9rem' }}>{s.purpose}</p>
            </div>
          ))}
        </div>
      )}
      <p className="ll-small" style={{ marginTop: '1rem' }}>The views use the default PI tuning. Change the controller in the bench to see its own analysis and code.</p>
    </div>
  );
}

export function ControllerReference({ kind }: { kind: ControllerKind }) {
  const meta = controllerMeta(kind);
  const c = CONTROLLER_CONTENT[kind];
  const [procId, setProcId] = useState<ProcessId>(kind === 'schedule' || kind === 'characterized' ? 'tank' : kind === 'feedforward' || kind === 'cascade' ? 'hx' : kind === 'smith' ? 'feeder' : kind === 'override' ? 'hx' : kind === 'ratio' ? 'blend' : kind === 'statefb' ? 'crane' : 'flow');
  const proc = getProcess(procId);
  const exp: Experiment = useMemo(() => ({ ...defaultExperiment(procId), controller: defaultController(kind, getProcess(procId)) }), [kind, procId]);
  const available = isAvailable(proc, kind);
  return (
    <div className="ll animate-fade-in" style={{ maxWidth: 1000 }}>
      <div className="ll-crumbs"><Link href="/loop-lab">Loop Lab</Link> / Controller ladder / rung {meta.rung}</div>
      <div className="ll-head">
        <div>
          <h1>{meta.icon} {meta.name}</h1>
          <p>{c.summary}</p>
        </div>
      </div>
      <div className="ll-ladder" style={{ marginBottom: '1rem' }}>
        {CONTROLLER_KINDS.map((k) => (
          <Link key={k.kind} href={`/loop-lab/controllers/${k.kind}`} style={k.kind === kind ? { borderColor: 'var(--accent-light)' } : undefined}>{k.icon} {k.rung}. {k.short}</Link>
        ))}
        {LATER_RUNGS.slice(0, 2).map((r, i) => <span key={r}>{CONTROLLER_KINDS.length + i + 1}. {r}</span>)}
        <span>…</span>
      </div>

      <div className="ll-card"><div className="ll-sub">Theory</div><MathText className="ll-prose">{c.theory}</MathText></div>
      <div className="ll-split" style={{ marginTop: '0.9rem' }}>
        <div className="ll-card" style={{ marginTop: 0 }}>
          <div className="ll-sub">When it works</div>
          <ul className="ll-list">{c.works.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul>
        </div>
        <div className="ll-card" style={{ marginTop: 0 }}>
          <div className="ll-sub">When it breaks</div>
          <ul className="ll-list">{c.breaks.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul>
        </div>
      </div>
      <div className="ll-card"><div className="ll-sub">How to tune it</div><MathText className="ll-prose">{c.tuning}</MathText></div>
      {kind !== 'onoff' && (
        <div className="ll-card">
          <div className="ll-sub">Tuning rules in the lab</div>
          {TUNING_RULES.map((r) => (
            <div key={r.id} style={{ padding: '0.5rem 0', borderTop: '1px solid var(--surface-border)' }}>
              <strong>{r.name}</strong> <span className="ll-small">({r.types.join(', ')})</span>
              <div className="ll-tex-block"><Tex latex={r.formula} display /></div>
              <p className="ll-small" style={{ margin: 0 }}>{r.assumptions}</p>
            </div>
          ))}
        </div>
      )}
      <div className="ll-card"><div className="ll-sub">How to implement it</div><MathText className="ll-prose">{c.implementation}</MathText></div>
      <div className="ll-split" style={{ marginTop: '0.9rem' }}>
        <div className="ll-card" style={{ marginTop: 0 }}><div className="ll-sub">Siemens</div><MathText className="ll-prose">{c.siemens}</MathText></div>
        <div className="ll-card" style={{ marginTop: 0 }}><div className="ll-sub">Elsewhere</div><MathText className="ll-prose">{c.broad}</MathText></div>
      </div>

      <div className="ll-card">
        <div className="ll-card-head">
          <h3>On a process</h3>
          <div className="ll-seg" role="group" aria-label="Process">
            {PROCESSES.map((p) => <button key={p.id} aria-pressed={p.id === procId} onClick={() => setProcId(p.id)}>{p.icon} {p.name}</button>)}
          </div>
        </div>
        {available ? (
          <>
            <BlockDiagram proc={proc} config={exp.controller} />
            <div className="ll-sub">Generated code</div>
            <CodeTabs proc={proc} exp={exp} />
            <p style={{ marginTop: '0.8rem' }}><Link className="ll-btn is-primary" href={benchLink(exp)}>Try it in the bench</Link></p>
          </>
        ) : <p className="ll-note">This controller needs something the {proc.name.toLowerCase()} doesn&apos;t have: {kind === 'cascade' ? 'an inner measurement' : kind === 'feedforward' ? 'a measured disturbance' : 'a known nonlinearity to invert'}.</p>}
      </div>
    </div>
  );
}
