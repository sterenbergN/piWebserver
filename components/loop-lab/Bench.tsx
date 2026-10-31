'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { describeController } from '@/lib/loop-lab/controllers';
import { getProcess, isProcessId } from '@/lib/loop-lab/processes';
import { decodeExperiment, defaultExperiment, encodeExperiment, type Experiment, type NotebookEntry } from '@/lib/loop-lab/setup';
import IdentifyPanel from './Identify';
import LivePanel from './Live';
import { NotebookPanel, newEntryId, useNotebook } from './Notebook';
import { PALETTE, ResultSummary, ScorecardTable, TestDetail, TestTabs, TrendPanel } from './Results';
import { ControllerEditor, ControllerPicker, ProcessPicker } from './Setup';
import { fmt } from './Chart';
import { plantSummary } from '@/lib/loop-lab/plant';
import { defaultParams } from '@/lib/loop-lab/model';
import { useRunsMany } from './useRuns';
import { AutomationView, ControlView, MechanicalView } from './Views';

/** The views: what it does, then the three perspectives on why. Import only belongs to the identified plant. */
const TABS = [
  { id: 'tests', label: 'Results' },
  { id: 'live', label: 'Run live' },
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'control', label: 'Control' },
  { id: 'automation', label: 'Automation' },
  { id: 'identify', label: 'Import trend' },
  { id: 'notebook', label: 'Notebook' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Pinned = { id: string; label: string; exp: Experiment };

const short = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function Bench() {
  const [exp, setExp] = useState<Experiment>(() => defaultExperiment('flow'));
  const [tab, setTab] = useState<TabId>('tests');
  // On a phone the setup and the views take turns; on a wide screen they sit side by side.
  const [phonePane, setPhonePane] = useState<'setup' | 'view'>('view');
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [view, setView] = useState(0);
  const [fullScore, setFullScore] = useState(false);
  const [saved, setSaved] = useState('');
  const [copied, setCopied] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const notebook = useNotebook();
  const proc = getProcess(exp.process);
  const ownData = proc.id === 'custom';
  const plant = useMemo(() => plantSummary(proc, exp.params), [proc, exp.params]);
  const plantChanges = useMemo(() => {
    const d = defaultParams(proc);
    return proc.params.filter((s) => Math.abs((exp.params[s.key] ?? d[s.key]) - d[s.key]) > 1e-9 * Math.max(1, Math.abs(d[s.key]))).length;
  }, [proc, exp.params]);
  // Import is only there for the identified plant; anywhere else, show the results.
  const shown: TabId = tab === 'identify' && !ownData ? 'tests' : tab;

  // Setup from a shared link or a process page, and the view from the hash.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get('setup');
    const process = q.get('process');
    const fromLink = raw ? decodeExperiment(raw) : process && isProcessId(process) ? defaultExperiment(process) : null;
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
    setPhonePane('view');
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
    // A new view starts at its top, not wherever the last one was scrolled to.
    const view = document.querySelector('.ll-view');
    const stuck = document.querySelector('.ll-main > .ll-tabs');
    if (view && stuck) {
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ll-top')) || 0;
      const top = window.scrollY + view.getBoundingClientRect().top - stuck.getBoundingClientRect().height - bar;
      if (window.scrollY > top) window.scrollTo({ top });
    }
  };
  /** Start over on a setup (a different process, a loaded notebook entry, an identified plant). */
  const startFrom = (e: Experiment) => {
    setExp(e);
    setPinned([]);
    setView(0);
  };
  /** Switch to the identified plant and open its import. */
  const openOwnData = () => {
    startFrom(defaultExperiment('custom'));
    chooseTab('identify');
  };

  const all = useMemo(() => [exp, ...pinned.map((p) => p.exp)], [exp, pinned]);
  const { results, busy } = useRunsMany(all);
  const current = results?.[0];
  const labels = ['Now', ...pinned.map((p) => p.label)];
  const viewIdx = Math.min(view, (current?.runs.length ?? 1) - 1);
  const viewRun = current?.runs[viewIdx];

  const keepForComparison = () => {
    setPinned((ps) => [...ps, { id: newEntryId(), label: short(describeController(proc, exp.controller), 34), exp }].slice(-4));
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
    window.setTimeout(() => setSaved(''), 4000);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/loop-lab/bench?setup=${encodeExperiment(exp)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  const compareEntry = (entry: NotebookEntry) => {
    if (entry.experiment.process !== exp.process) startFrom(entry.experiment);
    else setPinned((ps) => [...ps, { id: newEntryId(), label: short(entry.name, 34), exp: entry.experiment }].slice(-4));
    chooseTab('tests');
  };

  return (
    <div className={`ll ll-bench${exp.controller.kind === 'custom' ? ' has-code' : ''}`} data-phone={phonePane}>
      <aside className="ll-panel" aria-label="Setup">
        <div className="ll-panel-body">
          <section className="ll-panel-part">
            <div className="ll-panel-label"><h2>Process</h2><Link href={`/loop-lab/processes/${proc.id}`}>About</Link></div>
            <ProcessPicker value={exp.process} onChange={(id) => {
              if (id === 'custom') openOwnData();
              else startFrom(defaultExperiment(id));
            }} />
            {ownData && <button className="ll-btn is-small ll-panel-act" onClick={() => chooseTab('identify')}>Import a trend to replace the example model</button>}
          </section>

          <section className="ll-panel-part">
            <div className="ll-panel-label"><h2>Controller</h2><Link href={`/loop-lab/controllers/${exp.controller.kind}`}>Theory</Link></div>
            <ControllerPicker proc={proc} config={exp.controller} onChange={(controller) => setExp({ ...exp, controller })} />
            <ControllerEditor proc={proc} params={exp.params} config={exp.controller} onChange={(controller) => setExp({ ...exp, controller })} />
          </section>

          <section className="ll-panel-part">
            <div className="ll-panel-label">
              <h2>Plant</h2>
              <button className="ll-link" onClick={() => chooseTab('mechanical')}>Change</button>
            </div>
            {plant && (
              <dl className="ll-plant">
                <div><dt>Dead time</dt><dd>{fmt(plant.theta, 3)} s</dd></div>
                {plant.integrating
                  ? <div><dt>Ramps at</dt><dd>{fmt(plant.kPrime, 3)} /s per %</dd></div>
                  : <>
                      <div><dt>Time constant</dt><dd>{fmt(plant.tau, 3)} s</dd></div>
                      <div><dt>Gain</dt><dd>{fmt(plant.K, 3)}</dd></div>
                    </>}
              </dl>
            )}
            {plantChanges > 0 && <p className="ll-panel-flag">{plantChanges} setting{plantChanges > 1 ? 's' : ''} changed from the default</p>}
          </section>
        </div>

        <footer className="ll-panel-foot">
          {naming !== null ? (
            <form className="ll-name-form" onSubmit={(e) => { e.preventDefault(); saveToNotebook(naming); }}>
              <input type="text" value={naming} onChange={(e) => setNaming(e.target.value)} aria-label="Name for this setup" autoFocus />
              <button className="ll-btn is-small is-primary" type="submit">Save</button>
              <button className="ll-btn is-small" type="button" onClick={() => setNaming(null)}>Cancel</button>
            </form>
          ) : saved ? (
            <p className="ll-small" role="status">Saved “{short(saved, 26)}”. <button className="ll-link" onClick={() => chooseTab('notebook')}>Open the notebook</button></p>
          ) : (
            <>
              <button className="ll-btn is-small" onClick={() => setNaming(describeController(proc, exp.controller))} disabled={!current}>Save</button>
              <button className="ll-btn is-small" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
              <button className="ll-btn is-small is-quiet" onClick={() => setExp(defaultExperiment(exp.process))}>Reset</button>
            </>
          )}
        </footer>
      </aside>

      <section className="ll-main">
        <div className="ll-tabs" role="tablist" aria-label="Views">
          <button className="ll-phone-only" role="tab" aria-selected={phonePane === 'setup'} onClick={() => setPhonePane('setup')}>Setup</button>
          {TABS.filter((t) => t.id !== 'identify' || ownData).map((t) => (
            <button key={t.id} role="tab" className={t.id === 'notebook' ? 'is-end' : undefined} aria-selected={phonePane === 'view' && shown === t.id} onClick={() => chooseTab(t.id)}>
              {t.label}
              {t.id === 'notebook' && notebook.entries.length > 0 && <span className="ll-tab-count">{notebook.entries.length}</span>}
            </button>
          ))}
        </div>

        <button className="ll-phone-summary" onClick={() => setPhonePane('setup')}>
          <span><span aria-hidden>{proc.icon}</span> {proc.name}</span>
          <span className="ll-small">{short(describeController(proc, exp.controller), 40)} · Change</span>
        </button>

        <div className="ll-view ll-flat">
          {shown === 'tests' && (
            <div className="ll-results">
              {current ? <ResultSummary proc={proc} score={current.score} busy={busy} /> : <div className="ll-empty">Running the tests…</div>}

              {current && viewRun && (
                <section className="ll-part">
                  <TestTabs tests={current.score.tests} runs={current.runs} value={viewIdx} onChange={setView} />
                  <p className="ll-purpose">{viewRun.scenario.purpose}</p>
                  <div className="ll-compare">
                    <span className="ll-chip is-now"><span className="ll-swatch" style={{ background: PALETTE[0] }} />Now</span>
                    {pinned.map((p, i) => (
                      <span key={p.id} className="ll-chip" title={p.label}>
                        <span className="ll-swatch" style={{ background: PALETTE[(i + 1) % PALETTE.length] }} />
                        <span className="ll-chip-text">{p.label}</span>
                        <button className="ll-link" onClick={() => setExp(p.exp)} title="Go back to this setup">Use</button>
                        <button className="ll-chip-x" aria-label={`Stop comparing with ${p.label}`} onClick={() => setPinned(pinned.filter((x) => x.id !== p.id))}>×</button>
                      </span>
                    ))}
                    <button className="ll-btn is-small" onClick={keepForComparison} disabled={pinned.length >= 4}>Keep to compare</button>
                    {pinned.length === 0 && <span className="ll-small ll-compare-hint">then change something and see both</span>}
                  </div>
                  <TrendPanel proc={proc} height={235} entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], run: r.runs[viewIdx] })).filter((e) => e.run)} />
                  <details className="ll-more">
                    <summary>Every setpoint step and upset in this test</summary>
                    <TestDetail proc={proc} test={current.score.tests[viewIdx]} />
                  </details>
                </section>
              )}

              {current && <section className="ll-part">
                <div className="ll-part-head">
                  <h3>Scorecard</h3>
                  <div className="ll-seg is-small" role="group" aria-label="Which measures">
                    <button aria-pressed={!fullScore} onClick={() => setFullScore(false)}>Key measures</button>
                    <button aria-pressed={fullScore} onClick={() => setFullScore(true)}>All</button>
                  </div>
                </div>
                <ScorecardTable compact={!fullScore} proc={proc} entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], score: r.score }))} />
                <p className="ll-note">All {proc.scenarios.length} tests together, measured on the true process value. Click a measure to see what it means.{pinned.length > 0 && ' The best in each row is green.'}</p>
              </section>}
            </div>
          )}

          {shown === 'live' && <LivePanel proc={proc} exp={exp} />}
          {shown === 'mechanical' && <MechanicalView proc={proc} exp={exp} onParams={(params) => setExp({ ...exp, params })} />}
          {shown === 'control' && <ControlView proc={proc} exp={exp} runs={current?.runs} />}
          {shown === 'automation' && <AutomationView proc={proc} exp={exp} />}
          {shown === 'identify' && <IdentifyPanel onUse={(e) => { startFrom(e); chooseTab('tests'); }} />}
          {shown === 'notebook' && <NotebookPanel notebook={notebook} onLoad={(e) => { startFrom(e); chooseTab('tests'); }} onCompare={compareEntry} />}
        </div>
      </section>
    </div>
  );
}
