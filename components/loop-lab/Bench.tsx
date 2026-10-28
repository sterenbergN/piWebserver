'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { CASES } from '@/lib/loop-lab/content';
import { CONTROLLER_KINDS, describeController } from '@/lib/loop-lab/controllers';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import { decodeExperiment, defaultExperiment, encodeExperiment, type Experiment, type NotebookEntry } from '@/lib/loop-lab/setup';
import IdentifyPanel from './Identify';
import LivePanel from './Live';
import { NotebookPanel, newEntryId, useNotebook } from './Notebook';
import { PALETTE, ResultSummary, ScorecardTable, TestDetail, TrendPanel } from './Results';
import { ControllerEditor, ParamEditor, ProcessPicker } from './Setup';
import { useRunsMany } from './useRuns';
import { AutomationView, ControlView, MechanicalView } from './Views';

/**
 * The views, in three groups: what it does, why (three perspectives), and
 * yours. Import only belongs to the identified plant: it is how that plant
 * gets its model.
 */
const TAB_GROUPS = [
  [{ id: 'tests', label: 'Results', icon: '📊' }, { id: 'live', label: 'Run live', icon: '▶️' }],
  [{ id: 'mechanical', label: 'Mechanical', icon: '⚙️' }, { id: 'control', label: 'Control', icon: '📉' }, { id: 'automation', label: 'Automation', icon: '🏭' }],
  [{ id: 'identify', label: 'Import trend', icon: '📥' }, { id: 'notebook', label: 'Notebook', icon: '📓' }],
] as const;
const TABS = TAB_GROUPS.flat();
type TabId = (typeof TABS)[number]['id'];

/** Rungs planned for later phases, shown so the ladder reads as a whole. */
export const LATER_RUNGS = ['Ratio · override · split-range', 'Smith predictor · IMC', 'Decoupling', 'State feedback · observers', 'LQR', 'MPC', 'Adaptive', 'ADRC'];

const INTRO_KEY = 'loop-lab:intro-hidden';

type Pinned = { id: string; label: string; exp: Experiment };

const short = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function Bench() {
  const [exp, setExp] = useState<Experiment>(() => defaultExperiment('flow'));
  const [tab, setTab] = useState<TabId>('tests');
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [view, setView] = useState(0);
  const [fullScore, setFullScore] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const [copied, setCopied] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const notebook = useNotebook();
  const proc = getProcess(exp.process);
  const ownData = proc.id === 'custom';
  // Import is only there for the identified plant; anywhere else, show the results.
  const shown: TabId = tab === 'identify' && !ownData ? 'tests' : tab;

  // Setup from a shared link, the tab from the hash, and whether the intro was dismissed.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('setup');
    const fromLink = raw ? decodeExperiment(raw) : null;
    if (fromLink) setExp(fromLink);
    const h = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === h)) setTab(h as TabId);
    try { setShowIntro(!fromLink && localStorage.getItem(INTRO_KEY) !== '1'); } catch { setShowIntro(!fromLink); }
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
  const hideIntro = () => {
    setShowIntro(false);
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* storage blocked */ }
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
    if (entry.experiment.process !== exp.process) startFrom(entry.experiment);
    else setPinned((ps) => [...ps, { id: newEntryId(), label: short(entry.name, 34), exp: entry.experiment }].slice(-4));
    chooseTab('tests');
  };

  return (
    <div className="ll animate-fade-in">
      <div className="ll-head">
        <div>
          <h1>🎛️ Loop Lab</h1>
          <p>Put a controller on a realistic process, test it the same way every time, and see where PID is enough and where it isn’t.</p>
        </div>
        <button className="ll-btn is-small" onClick={() => setLearnOpen((o) => !o)} aria-expanded={learnOpen}>
          📚 {learnOpen ? 'Hide' : 'Processes, controllers & case studies'}
        </button>
      </div>

      {showIntro && (
        <div className="ll-intro">
          <ol>
            <li><strong>Pick a process.</strong> Each one is a real piece of plant with its own quirks, or import a trend from your own loop.</li>
            <li><strong>Pick a controller and press ✨ Auto-tune.</strong> Then change one thing at a time.</li>
            <li><strong>Read the results.</strong> Keep a setup to compare it side by side with the next.</li>
          </ol>
          <div className="ll-intro-cases">
            <span className="ll-small">Or follow a guided case study:</span>
            {CASES.map((c) => <Link key={c.id} className="ll-chip" href={`/loop-lab/cases/${c.id}`}>{getProcess(c.process).icon} {c.title.replace(/^The /, '').split(':')[0]}</Link>)}
          </div>
          <button className="ll-link ll-intro-hide" onClick={hideIntro}>Got it, hide this</button>
        </div>
      )}

      {learnOpen && (
        <div className="ll-card" style={{ marginBottom: '1rem' }}>
          <div className="ll-sub">Case studies</div>
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
                <strong>{p.icon} {p.name}</strong>
                <span>{p.summary}</span>
              </Link>
            ))}
          </div>
          <div className="ll-sub">The controller ladder</div>
          <div className="ll-ladder">
            {CONTROLLER_KINDS.map((k) => <Link key={k.kind} href={`/loop-lab/controllers/${k.kind}`}>{k.icon} {k.rung}. {k.short}</Link>)}
            {LATER_RUNGS.map((r, i) => <span key={r} title="A later phase">{CONTROLLER_KINDS.length + i + 1}. {r}</span>)}
          </div>
        </div>
      )}

      <div className="ll-bench">
        <aside className="ll-side" aria-label="Setup">
          <div className="ll-card">
            <div className="ll-card-head" style={{ marginBottom: '0.5rem' }}>
              <h2 className="ll-step-title"><span>1</span>Process</h2>
              <Link className="ll-small" href={`/loop-lab/processes/${proc.id}`}>About it →</Link>
            </div>
            <ProcessPicker value={exp.process} onChange={(id) => {
              if (id === exp.process) return;
              if (id === 'custom') openOwnData();
              else startFrom(defaultExperiment(id));
            }} />
            <p className="ll-note">{proc.summary}</p>
            {ownData
              ? <button className="ll-btn is-small" onClick={() => chooseTab('identify')}>📥 Import a trend to replace the example model</button>
              : <button className="ll-link" onClick={openOwnData}>Have a trend from your own loop? Import it →</button>}
          </div>
          <div className="ll-card">
            <div className="ll-card-head" style={{ marginBottom: '0.5rem' }}>
              <h2 className="ll-step-title"><span>2</span>Controller</h2>
              <Link className="ll-small" href={`/loop-lab/controllers/${exp.controller.kind}`}>Theory →</Link>
            </div>
            <ControllerEditor proc={proc} params={exp.params} config={exp.controller} onChange={(controller) => setExp({ ...exp, controller })} />
            {/* On a phone the results are below all of this. */}
            <button className="ll-btn is-small ll-mobile-only" style={{ marginTop: '0.7rem' }}
              onClick={() => { chooseTab('tests'); document.getElementById('ll-results')?.scrollIntoView({ block: 'start' }); }}>📊 See the results</button>
          </div>
          <details className="ll-card">
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem' }}>Process &amp; instrument settings</summary>
            <ParamEditor proc={proc} params={exp.params} onChange={(params) => setExp({ ...exp, params })} />
          </details>
          <div className="ll-card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            <button className="ll-btn is-small" onClick={() => setNaming(describeController(proc, exp.controller))} disabled={!current}>📓 Save to notebook</button>
            <button className="ll-btn is-small" onClick={copyLink}>{copied ? 'Link copied' : '🔗 Copy link'}</button>
            <button className="ll-btn is-small" onClick={() => setExp(defaultExperiment(exp.process))}>↺ Reset</button>
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

        <section className="ll-main" id="ll-results">
          <div className="ll-seg ll-tabs" role="tablist" aria-label="Views">
            {TAB_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span className="ll-tab-sep" aria-hidden />}
                {group.filter((t) => t.id !== 'identify' || ownData).map((t) => (
                  <button key={t.id} role="tab" aria-selected={shown === t.id} onClick={() => chooseTab(t.id)}>
                    <span aria-hidden>{t.icon}</span>{t.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </div>

          {shown === 'tests' && (
            <div>
              <div className="ll-card">
                <div className="ll-card-head">
                  <h2 className="ll-step-title"><span>3</span>Results</h2>
                  <span className="ll-busy">{busy ? 'Running the tests…' : `${proc.scenarios.length} tests run`}</span>
                </div>
                {current && <ResultSummary proc={proc} score={current.score} />}
                <div className="ll-compare">
                  <button className="ll-btn is-small" onClick={keepForComparison} disabled={!current || pinned.length >= 4}>📌 Keep for comparison</button>
                  {pinned.length === 0
                    ? <span className="ll-small">Keep this setup, change something, and both show side by side.</span>
                    : pinned.map((p, i) => (
                      <span key={p.id} className="ll-chip" title={p.label}>
                        <span className="ll-swatch" style={{ background: PALETTE[(i + 1) % PALETTE.length] }} />{p.label}
                        <button className="ll-link" onClick={() => setExp(p.exp)} title="Go back to this setup">use</button>
                        <button className="ll-link" aria-label={`Stop comparing with ${p.label}`} onClick={() => setPinned(pinned.filter((x) => x.id !== p.id))}>✕</button>
                      </span>
                    ))}
                </div>
              </div>

              {current && viewRun && (
                <div className="ll-card">
                  <label className="ll-field ll-test-pick">
                    <span>Test</span>
                    <select value={viewIdx} onChange={(e) => setView(Number(e.target.value))}>
                      {current.runs.map((r, i) => <option key={r.scenario.id} value={i}>{r.scenario.name}</option>)}
                    </select>
                  </label>
                  <p className="ll-small" style={{ margin: '0.3rem 0 0.4rem' }}>{viewRun.scenario.purpose}</p>
                  <TrendPanel proc={proc} entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], run: r.runs[viewIdx] })).filter((e) => e.run)} />
                  <details>
                    <summary className="ll-small" style={{ cursor: 'pointer' }}>Every setpoint step and upset in this test</summary>
                    <TestDetail proc={proc} test={current.score.tests[viewIdx]} />
                  </details>
                </div>
              )}

              <div className="ll-card">
                <div className="ll-card-head">
                  <h3>Scorecard</h3>
                  <button className="ll-link" onClick={() => setFullScore((f) => !f)}>{fullScore ? 'Show the key measures' : 'Show every measure'}</button>
                </div>
                <ScorecardTable compact={!fullScore} proc={proc} entries={(results ?? []).map((r, i) => ({ label: labels[i], color: PALETTE[i % PALETTE.length], score: r.score }))} />
                <p className="ll-note">All {proc.scenarios.length} tests together, measured on the true process value. With more than one setup, the best in each row is green.</p>
              </div>
            </div>
          )}

          {shown === 'live' && <div className="ll-card"><LivePanel proc={proc} exp={exp} /></div>}
          {shown === 'mechanical' && <MechanicalView proc={proc} exp={exp} />}
          {shown === 'control' && <ControlView proc={proc} exp={exp} runs={current?.runs} />}
          {shown === 'automation' && <AutomationView proc={proc} exp={exp} />}
          {shown === 'identify' && <IdentifyPanel onUse={(e) => { startFrom(e); chooseTab('tests'); }} />}
          {shown === 'notebook' && (
            <div className="ll-card">
              <NotebookPanel notebook={notebook} onLoad={(e) => { startFrom(e); chooseTab('tests'); }} onCompare={compareEntry} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
