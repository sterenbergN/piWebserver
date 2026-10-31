'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MathText, Tex } from '@/components/daily/MathText';
import { benchLink, CONTROLLER_GROUPS, metaOf, PROCESS_GROUPS } from '@/lib/loop-lab/catalog';
import { CASES, CONTROLLER_CONTENT, PROCESS_CONTENT } from '@/lib/loop-lab/content';
import { controllerMeta, defaultController, isAvailable, type ControllerKind } from '@/lib/loop-lab/controllers';
import type { ProcessId } from '@/lib/loop-lab/model';
import { getProcess } from '@/lib/loop-lab/processes';
import { defaultExperiment, type Experiment } from '@/lib/loop-lab/setup';
import { TUNING_RULES } from '@/lib/loop-lab/tuning';
import { useCurrentSection } from './CaseStudy';
import { BlockDiagram } from './Drawings';
import { AutomationView, CodeTabs, ControlView, MechanicalView } from './Views';

export function ProcessReference({ id }: { id: ProcessId }) {
  const proc = getProcess(id);
  const exp = useMemo(() => defaultExperiment(id), [id]);
  const [tab, setTab] = useState<'mechanical' | 'control' | 'automation' | 'tests'>('mechanical');
  const cases = CASES.filter((c) => c.process === id);
  return (
    <div className="ll">
      <header className="ll-title">
        <div className="ll-crumbs"><Link href="/loop-lab/processes">Processes</Link></div>
        <h1><span aria-hidden>{proc.icon}</span> {proc.name}</h1>
        <p>{proc.summary}</p>
        <div className="ll-actions">
          <Link className="ll-btn is-primary" href={benchLink(exp)}>Open on the bench</Link>
          {cases.map((c) => <Link key={c.id} className="ll-btn" href={`/loop-lab/cases/${c.id}`}>Case study: {c.title.split(':').pop()!.trim()}</Link>)}
        </div>
      </header>

      <div className="ll-verdict-box">
        <div className="ll-step-num">Verdict: {proc.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</div>
        <MathText className="ll-prose">{PROCESS_CONTENT[id].verdict}</MathText>
      </div>

      <div className="ll-tabs" role="tablist" aria-label="Perspective" style={{ marginTop: '1.5rem' }}>
        <button role="tab" aria-selected={tab === 'mechanical'} onClick={() => setTab('mechanical')}>Mechanical</button>
        <button role="tab" aria-selected={tab === 'control'} onClick={() => setTab('control')}>Control</button>
        <button role="tab" aria-selected={tab === 'automation'} onClick={() => setTab('automation')}>Automation</button>
        <button role="tab" aria-selected={tab === 'tests'} onClick={() => setTab('tests')}>Test scripts</button>
      </div>
      <div className="ll-view ll-flat">
        {tab === 'mechanical' && <MechanicalView proc={proc} exp={exp} />}
        {tab === 'control' && <ControlView proc={proc} exp={exp} />}
        {tab === 'automation' && <AutomationView proc={proc} exp={exp} />}
        {tab === 'tests' && (
          <div>
            <p className="ll-small" style={{ marginBottom: '0.75rem' }}>Every controller on this process runs exactly these scripts, so their scorecards can be compared.</p>
            {proc.scenarios.map((s) => (
              <div key={s.id} className="ll-script">
                <strong>{s.name}</strong> <span className="ll-small">· {s.duration >= 600 ? `${Math.round(s.duration / 60)} min` : `${s.duration} s`}</span>
                <p>{s.purpose}</p>
              </div>
            ))}
          </div>
        )}
        <p className="ll-note" style={{ marginTop: '1.5rem' }}>These views use the default PI tuning. Change the controller on the bench to see its own analysis and code.</p>
      </div>
    </div>
  );
}

/** The process each rung is best seen on. */
const SHOWN_ON: Partial<Record<ControllerKind, ProcessId>> = {
  schedule: 'tank', characterized: 'tank', feedforward: 'hx', cascade: 'hx', smith: 'feeder', override: 'hx', ratio: 'blend',
  statefb: 'crane', multiloop: 'mixing', mpc: 'mixing', adrc: 'batch', adaptive: 'batch',
};

const DOC_SECTIONS = [
  { id: 'theory', label: 'Theory' },
  { id: 'fit', label: 'When it works' },
  { id: 'tuning', label: 'How to tune it' },
  { id: 'implementation', label: 'How to implement it' },
  { id: 'platforms', label: 'Siemens and elsewhere' },
  { id: 'example', label: 'On a process' },
];

export function ControllerReference({ kind }: { kind: ControllerKind }) {
  const meta = controllerMeta(kind);
  const c = CONTROLLER_CONTENT[kind];
  const [procId, setProcId] = useState<ProcessId>(SHOWN_ON[kind] ?? 'flow');
  const proc = getProcess(procId);
  const exp: Experiment = useMemo(() => ({ ...defaultExperiment(procId), controller: defaultController(kind, getProcess(procId)) }), [kind, procId]);
  const current = useCurrentSection(DOC_SECTIONS.map((s) => s.id));
  const choices = PROCESS_GROUPS.map((g) => ({ ...g, list: g.list.filter((p) => isAvailable(p, kind)) })).filter((g) => g.list.length);
  return (
    <div className="ll">
      <div className="ll-read">
        <nav className="ll-rail" aria-label="The controller ladder">
          <div className="ll-rail-title">On this page</div>
          <ul>
            {DOC_SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} aria-current={current === s.id ? 'location' : undefined}>{s.label}</a></li>)}
          </ul>
          {CONTROLLER_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="ll-rail-title">{g.label}</div>
              <ul>
                {g.kinds.map((k) => (
                  <li key={k}><Link href={`/loop-lab/controllers/${k}`} aria-current={k === kind ? 'page' : undefined}><span className="ll-rail-num">{metaOf(k).rung}</span>{metaOf(k).short}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div>
          <header className="ll-title">
            <div className="ll-crumbs"><Link href="/loop-lab/controllers">The controller ladder</Link> · rung {meta.rung}</div>
            <h1>{meta.name}</h1>
            <p>{c.summary}</p>
            <div className="ll-actions"><Link className="ll-btn is-primary" href={benchLink(exp)}>Try it on the bench</Link></div>
          </header>

          <section id="theory" className="ll-doc-section">
            <h2>Theory</h2>
            <MathText className="ll-prose">{c.theory}</MathText>
          </section>
          <section id="fit" className="ll-doc-section">
            <h2>When it works, and when it breaks</h2>
            <div className="ll-split">
              <div><div className="ll-sub">Works</div><ul className="ll-list">{c.works.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul></div>
              <div><div className="ll-sub">Breaks</div><ul className="ll-list">{c.breaks.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul></div>
            </div>
          </section>
          <section id="tuning" className="ll-doc-section">
            <h2>How to tune it</h2>
            <MathText className="ll-prose">{c.tuning}</MathText>
            {kind !== 'onoff' && (
              <details className="ll-more">
                <summary>The tuning rules in the lab</summary>
                {TUNING_RULES.map((r) => (
                  <div key={r.id} className="ll-doc-rule">
                    <strong>{r.name}</strong> <span className="ll-small">({r.types.join(', ')})</span>
                    <div className="ll-tex-block"><Tex latex={r.formula} display /></div>
                    <p className="ll-small">{r.assumptions}</p>
                  </div>
                ))}
              </details>
            )}
          </section>
          <section id="implementation" className="ll-doc-section">
            <h2>How to implement it</h2>
            <MathText className="ll-prose">{c.implementation}</MathText>
          </section>
          <section id="platforms" className="ll-doc-section">
            <h2>Siemens and elsewhere</h2>
            <div className="ll-split">
              <div><div className="ll-sub">Siemens</div><MathText className="ll-prose">{c.siemens}</MathText></div>
              <div><div className="ll-sub">Elsewhere</div><MathText className="ll-prose">{c.broad}</MathText></div>
            </div>
          </section>
          <section id="example" className="ll-doc-section">
            <div className="ll-part-head">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 650 }}>On a process</h2>
              <label className="ll-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <span className="sr-only">Process</span>
                <select value={procId} onChange={(e) => setProcId(e.target.value as ProcessId)}>
                  {choices.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.list.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
            <BlockDiagram proc={proc} config={exp.controller} />
            <div className="ll-sub">Generated code</div>
            <CodeTabs proc={proc} exp={exp} />
            <div className="ll-actions"><Link className="ll-btn is-primary" href={benchLink(exp)}>Try it on the bench</Link></div>
          </section>
        </div>
      </div>
    </div>
  );
}
