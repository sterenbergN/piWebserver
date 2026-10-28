'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CASES } from '@/lib/loop-lab/content';
import { CONTROLLER_KINDS, describeController } from '@/lib/loop-lab/controllers';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import { decodeExperiment, defaultExperiment, encodeExperiment, type Experiment, type NotebookEntry } from '@/lib/loop-lab/setup';
import { fmt } from './Chart';
import LivePanel from './Live';
import { NotebookPanel, newEntryId, useNotebook } from './Notebook';
import { PALETTE, ScorecardTable, TestDetail, TrendPanel } from './Results';
import { ControllerEditor, ParamEditor, ProcessPicker } from './Setup';
import { useRunsMany } from './useRuns';
import { AutomationView, ControlView, MechanicalView } from './Views';

const TABS = [
  { id: 'tests', label: 'Tests', icon: '🧪' },
  { id: 'live', label: 'Live', icon: '▶️' },
  { id: 'mechanical', label: 'Mechanical', icon: '⚙️' },
  { id: 'control', label: 'Control', icon: '📉' },
  { id: 'automation', label: 'Automation', icon: '🏭' },
  { id: 'notebook', label: 'Notebook', icon: '📓' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Rungs planned for later phases, shown so the ladder reads as a whole. */
export const LATER_RUNGS = ['Feedforward', 'Cascade', 'Ratio · override · split-range', 'Smith predictor · IMC', 'Decoupling', 'State feedback · observers', 'LQR', 'MPC', 'Adaptive', 'ADRC'];

type Pinned = { id: string; label: string; exp: Experiment };

export default function Bench() {
  const [exp, setExp] = useState<Experiment>(() => defaultExperiment('flow'));
  const [tab, setTab] = useState<TabId>('tests');
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [scenarioIds, setScenarioIds] = useState<string[] | null>(null);
  const [view, setView] = useState(0);
  const [saved, setSaved] = useState('');
  const [copied, setCopied] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const notebook = useNotebook();
  const proc = getProcess(exp.process);

  // Setup from a shared link, and the tab from the hash.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('setup');
    const fromLink = raw ? decodeExperiment(raw) : null;
    if (fromLink) setExp(fromLink);
    const h = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === h)) setTab(h as TabId);
  }, []);
  // Keep the link up to date so it can be copied from the address bar.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const url = `${window.location.pathname}?setup=${encodeExperiment(exp)}${window.location.hash}`;
      history.replaceState(history.state, '', url);
    }, 400);
    return () => window.clearTimeout(id);
  }, [exp]);

  const chooseTab = (id: TabId) => {
    setTab(id);
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
  };
  const setProcess = (id: Experiment['process']) => {
    if (id === exp.process) return;
    setExp(defaultExperiment(id));
    setPinned([]);
    setScenarioIds(null);
    setView(0);
  };

  const ids = scenarioIds ?? proc.scenarios.map((s) => s.id);
  const all = useMemo(() => [exp, ...pinned.map((p) => p.exp)], [exp, pinned]);
  const { results, busy } = useRunsMany(all, ids);
  const current = results?.[0];
  const labels = ['This setup', ...pinned.map((p) => p.label)];
  const viewRun = current?.runs[Math.min(view, current.runs.length - 1)];
  const viewIdx = Math.min(view, (current?.runs.length ?? 1) - 1);

  const pin = (label: string, e: Experiment) => {
    setPinned((ps) => [...ps, { id: newEntryId(), label, exp: e }].slice(-5));
  };
  const saveToNotebook = (name: string) => {
    if (!current) return;
    setNaming(null);
    const s = current.score;
    const entry: NotebookEntry = {
      id: newEntryId(), name: name.trim() || describeController(proc, exp.controller), note: '', createdAt: new Date().toISOString(), experiment: exp,
      summary: { iae: s.iae, worstOvershoot: s.worstOvershoot, worstSettling: s.worstSettling, worstPeak: s.worstPeak, worstRecovery: s.worstRecovery, travel: s.travel, cvActivity: s.cvActivity, worstPm: s.worstPm, worstMs: s.worstMs },
    };
    notebook.add(entry);
    setSaved(entry.name);
    window.setTimeout(() => setSaved(''), 2500);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/loop-lab?setup=${encodeExperiment(exp)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  const compareEntry = (entry: NotebookEntry) => {
    if (entry.experiment.process !== exp.process) {
      setExp(entry.experiment);
      setPinned([]);
      setScenarioIds(null);
    } else pin(entry.name, entry.experiment);
    chooseTab('tests');
  };

  return (
    <div className="ll animate-fade-in">
      <div className="ll-head">
        <div>
          <h1>🎛️ Loop Lab</h1>
          <p>Put a controller on a realistic process, run the same tests every time, and find out where PID is enough and where it isn’t, from the mechanical, control and automation side.</p>
        </div>
      </div>

      <details className="ll-card" style={{ marginBottom: '1rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Learn: case studies, processes and the controller ladder</summary>
        <div className="ll-sub" style={{ marginTop: '0.8rem' }}>Case studies</div>
        <div className="ll-learn">
          {CASES.map((c) => (
            <Link key={c.id} className="ll-tile" href={`/loop-lab/cases/${c.id}`}>
              <strong>{getProcess(c.process).icon} {c.title}</strong>
              <span>{c.question}</span>
            </Link>
          ))}
        </div>
        <div className="ll-sub">Processes</div>
        <div className="ll-learn">
          {PROCESSES.map((p) => (
            <Link key={p.id} className="ll-tile" href={`/loop-lab/processes/${p.id}`}>
              <strong>{p.icon} {p.name} <span className={`ll-badge${p.family === 'pid-wins' ? ' is-good' : ' is-warn'}`}>{p.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</span></strong>
              <span>{p.summary}</span>
            </Link>
          ))}
        </div>
        <div className="ll-sub">The controller ladder</div>
        <div className="ll-ladder">
          {CONTROLLER_KINDS.map((k) => <Link key={k.kind} href={`/loop-lab/controllers/${k.kind}`}>{k.icon} {k.rung}. {k.short}</Link>)}
          {LATER_RUNGS.map((r, i) => <span key={r} title="A later phase">{CONTROLLER_KINDS.length + i + 1}. {r}</span>)}
        </div>
      </details>

      <div className="ll-bench">
        <aside className="ll-side" aria-label="Setup">
          <div className="ll-card">
            <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Process</h2>
            <ProcessPicker value={exp.process} onChange={setProcess} />
            <p className="ll-note">{proc.summary}</p>
          </div>
          <div className="ll-card">
            <div className="ll-card-head" style={{ marginBottom: '0.5rem' }}>
              <h2 style={{ fontSize: '0.95rem' }}>Controller</h2>
              <Link className="ll-small" href={`/loop-lab/controllers/${exp.controller.kind}`}>Theory →</Link>
            </div>
            <ControllerEditor proc={proc} params={exp.params} config={exp.controller} onChange={(controller) => setExp({ ...exp, controller })} />
          </div>
          <details className="ll-card">
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>Process &amp; instruments</summary>
            <ParamEditor proc={proc} params={exp.params} onChange={(params) => setExp({ ...exp, params })} />
          </details>
          <div className="ll-card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <button className="ll-btn is-small" onClick={copyLink}>{copied ? 'Link copied' : '🔗 Copy link'}</button>
            <button className="ll-btn is-small" onClick={() => setNaming(describeController(proc, exp.controller))} disabled={!current}>📓 Save to notebook</button>
            <button className="ll-btn is-small" onClick={() => pin(describeController(proc, exp.controller), exp)} disabled={pinned.length >= 5}>📌 Pin to compare</button>
            <button className="ll-btn is-small" onClick={() => setExp(defaultExperiment(exp.process))}>Reset</button>
            {naming !== null && (
              <form style={{ display: 'flex', gap: '0.35rem', width: '100%' }} onSubmit={(e) => { e.preventDefault(); saveToNotebook(naming); }}>
                <input type="text" value={naming} onChange={(e) => setNaming(e.target.value)} aria-label="Experiment name" style={{ flex: 1 }} autoFocus />
                <button className="ll-btn is-small is-primary" type="submit">Save</button>
                <button className="ll-btn is-small" type="button" onClick={() => setNaming(null)}>Cancel</button>
              </form>
            )}
            {saved && <span className="ll-small">Saved “{saved}” · <button className="ll-link" onClick={() => chooseTab('notebook')}>open notebook</button></span>}
          </div>
        </aside>

        <section className="ll-main">
          <div className="ll-seg ll-tabs" role="tablist" aria-label="Views">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => chooseTab(t.id)}>
                <span aria-hidden>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {tab === 'tests' && (
            <div>
              <div className="ll-card">
                <div className="ll-card-head">
                  <h3>Test scripts</h3>
                  <span className="ll-busy">{busy ? 'Running…' : current ? 'Up to date' : ''}</span>
                </div>
                <div className="ll-checks">
                  {proc.scenarios.map((s) => (
                    <label key={s.id} className="ll-check" title={s.purpose}>
                      <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => {
                        const next = e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id);
                        setScenarioIds(proc.scenarios.map((x) => x.id).filter((x) => next.includes(x)));
                        setView(0);
                      }} /> {s.name}
                    </label>
                  ))}
                </div>
                {pinned.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem', alignItems: 'center' }}>
                    <span className="ll-small">Comparing with</span>
                    {pinned.map((p, i) => (
                      <span key={p.id} className="ll-badge"><span className="ll-swatch" style={{ background: PALETTE[(i + 1) % PALETTE.length] }} />{p.label}
                        <button className="ll-link" aria-label={`Remove ${p.label}`} onClick={() => setPinned(pinned.filter((x) => x.id !== p.id))}>✕</button>
                        <button className="ll-link" onClick={() => setExp(p.exp)} title="Load this setup">load</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {current && ids.length > 0 && (
                <div className="ll-card">
                  <div className="ll-seg" role="tablist" aria-label="Test to plot" style={{ marginBottom: '0.6rem' }}>
                    {current.runs.map((r, i) => (
                      <button key={r.scenario.id} role="tab" aria-selected={viewIdx === i} onClick={() => setView(i)}>{r.scenario.name}</button>
                    ))}
                  </div>
                  {viewRun && (
                    <>
                      <p className="ll-small" style={{ marginTop: 0 }}>{viewRun.scenario.purpose}</p>
                      <TrendPanel proc={proc} entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], run: r.runs[viewIdx] })).filter((e) => e.run)} />
                      <TestDetail proc={proc} test={current.score.tests[viewIdx]} />
                    </>
                  )}
                </div>
              )}

              <div className="ll-card">
                <div className="ll-card-head">
                  <h3>Scorecard</h3>
                  <span className="ll-small">{ids.length} test{ids.length === 1 ? '' : 's'} · performance on the true process value</span>
                </div>
                {ids.length === 0 ? <div className="ll-empty">Pick at least one test.</div> : (
                  <ScorecardTable entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], score: r.score }))} />
                )}
                {current && pinned.length === 0 && (
                  <p className="ll-note">Pin this setup, change something, and the scorecard shows both side by side with the best in each row highlighted. IAE here is {fmt(current.score.iae, 3)} %·min.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'live' && <div className="ll-card"><LivePanel proc={proc} exp={exp} /></div>}
          {tab === 'mechanical' && <MechanicalView proc={proc} exp={exp} />}
          {tab === 'control' && <ControlView proc={proc} exp={exp} runs={current?.runs} />}
          {tab === 'automation' && <AutomationView proc={proc} exp={exp} />}
          {tab === 'notebook' && (
            <div className="ll-card">
              <NotebookPanel notebook={notebook} onLoad={(e) => { setExp(e); setPinned([]); setScenarioIds(null); chooseTab('tests'); }} onCompare={compareEntry} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
