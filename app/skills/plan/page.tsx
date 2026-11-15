'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyPrompt, ErrorNote, Loading, PasteReply, SignedOutCard } from '@/components/skills/Ui';
import { SignedOut, fmtLevel, skillsGet, skillsPost, type BoardResponse, type SubjectResponse } from '@/components/skills/api';
import { localToday } from '@/lib/habits/dates';
import { parseInterconnectedPlanReply, type InterconnectedPlanDraft } from '@/lib/skills/parse';
import { buildInterconnectedPlanPrompt } from '@/lib/skills/prompts';
import { RESOURCE_LABEL, STAGES, type SkillsData, type Subject } from '@/lib/skills/types';

type Mode = 'schedule' | 'brainstorm';

type ApplyResult = {
  addedSubjects: number;
  updatedSubjects: number;
  addedTopics: number;
  addedResources: number;
  addedSteps: number;
  scheduledTasks: number;
};

type LoadedGraph = {
  board: BoardResponse['board'];
  realSubjects: Subject[];
  promptData: SkillsData;
  levelById: Map<string, number>;
};

export default function InterconnectedPlanPage() {
  const [graph, setGraph] = useState<LoadedGraph | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signedOut' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');

  const [mode, setMode] = useState<Mode>('schedule');
  const [hoursPerDay, setHoursPerDay] = useState('1.5');
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [focusIds, setFocusIds] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState('');
  const [reply, setReply] = useState('');

  // Mode 1 & shared apply flags
  const [includeSubjectPlans, setIncludeSubjectPlans] = useState(true);
  const [replaceSteps, setReplaceSteps] = useState(false);
  const [includeSchedule, setIncludeSchedule] = useState(true);
  const [replaceSchedule, setReplaceSchedule] = useState(true);

  // Mode 2 per-subject selection (tracks deselected names for the current reply)
  const [offNewSubjects, setOffNewSubjects] = useState<{ reply: string; keys: Set<string> }>({
    reply: '',
    keys: new Set(),
  });

  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [done, setDone] = useState<ApplyResult | null>(null);

  const today = localToday();

  const loadAll = useCallback(async () => {
    try {
      const boardRes = await skillsGet<BoardResponse>();
      const board = boardRes.board;
      const details = await Promise.all(
        board.subjects.map((s) => skillsGet<SubjectResponse>({ subject: s.id })),
      );
      const levelById = new Map<string, number>(board.subjects.map((s) => [s.id, s.level]));
      const realSubjects: Subject[] = details.map((d) => ({ ...d.subject, items: [] }));
      const promptSubjects: Subject[] = details.map((d) => {
        const statsMap = new Map(d.stats.topics.map((t) => [t.topicId, t]));
        return {
          ...d.subject,
          items: [],
          topics: d.subject.topics.map((t) => {
            const ts = statsMap.get(t.id);
            if (!ts || ts.confidence === 'none') return t;
            return { ...t, selfRating: Number(ts.level.toFixed(2)), selfRatedOn: today };
          }),
        };
      });
      setGraph({
        board,
        realSubjects,
        promptData: { subjects: promptSubjects },
        levelById,
      });
      setState('ready');
    } catch (e) {
      if (e instanceof SignedOut) setState('signedOut');
      else {
        setLoadError(e instanceof Error ? e.message : 'Couldn’t load your skills.');
        setState('error');
      }
    }
  }, [today]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const parsedHours = Number(hoursPerDay);
  const effectiveHours = Number.isFinite(parsedHours) && parsedHours >= 0.25 && parsedHours <= 16 ? parsedHours : 1;

  const prompt = useMemo(() => {
    if (!graph) return '';
    return buildInterconnectedPlanPrompt(
      graph.promptData,
      {
        hoursPerDay: effectiveHours,
        days,
        mode,
        focusSubjectIds: focusIds.size ? [...focusIds] : undefined,
        goals: goals.trim() || undefined,
      },
      today,
    );
  }, [graph, effectiveHours, days, mode, focusIds, goals, today]);

  const parsed = useMemo(() => {
    if (!graph || !reply.trim()) return null;
    return parseInterconnectedPlanReply(reply, graph.realSubjects, today);
  }, [graph, reply, today]);

  const draft: InterconnectedPlanDraft | null = parsed?.ok ? parsed.data : null;

  const deselectedNew = useMemo(
    () => (offNewSubjects.reply === reply ? offNewSubjects.keys : new Set<string>()),
    [offNewSubjects, reply],
  );

  function toggleFocus(id: string) {
    const next = new Set(focusIds);
    if (!next.delete(id)) next.add(id);
    setFocusIds(next);
  }

  function toggleNewSubject(name: string) {
    const next = new Set(deselectedNew);
    if (!next.delete(name)) next.add(name);
    setOffNewSubjects({ reply, keys: next });
  }

  const selectedNewSubjects = useMemo(() => {
    if (!draft) return [];
    return draft.newSubjects.filter((s) => !deselectedNew.has(s.name));
  }, [draft, deselectedNew]);

  const scheduleGroups = useMemo(() => {
    if (!draft) return [];
    const byDay = new Map<string, typeof draft.schedule>();
    for (const task of draft.schedule) {
      const list = byDay.get(task.day);
      if (list) list.push(task);
      else byDay.set(task.day, [task]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [draft]);

  async function applyPlan() {
    if (!draft || busy) return;
    setBusy(true);
    setApplyError('');
    try {
      const droppedNewNames = new Set(
        draft.newSubjects
          .filter((s) => deselectedNew.has(s.name))
          .map((s) => s.name.trim().toLowerCase()),
      );
      const filteredDraft: InterconnectedPlanDraft = {
        ...draft,
        newSubjects: selectedNewSubjects,
        schedule: draft.schedule.filter((t) => {
          if (t.subjectId) return true;
          return !droppedNewNames.has(t.subjectName.trim().toLowerCase());
        }),
      };

      const res = await skillsPost<ApplyResult>('apply-interconnected-plan', {
        draft: filteredDraft,
        startDay: today,
        hoursPerDay: effectiveHours,
        includeNewSubjects: selectedNewSubjects.length > 0,
        includeSubjectPlans,
        replaceSteps,
        includeSchedule,
        replaceSchedule,
      });
      setDone(res);
      await loadAll();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Couldn’t apply the interconnected plan.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'signedOut') return <main className="sk sk-narrow"><SignedOutCard /></main>;
  if (state === 'loading') return <main className="sk sk-narrow"><Loading rows={3} /></main>;
  if (state === 'error' || !graph) {
    return (
      <main className="sk sk-narrow">
        <Link className="sk-back" href="/skills">← Skills</Link>
        <ErrorNote>{loadError || 'Couldn’t load your skills.'}</ErrorNote>
      </main>
    );
  }

  const { board, levelById } = graph;

  const canApply = !!draft && (
    selectedNewSubjects.length > 0
    || (includeSubjectPlans && draft.subjectPlans.length > 0)
    || (includeSchedule && draft.schedule.length > 0)
    || draft.parentLinks.length > 0
  );

  if (done) {
    return (
      <main className="sk sk-narrow">
        <header className="sk-head">
          <div>
            <Link className="sk-back" href="/skills">← Skills</Link>
            <h1>Interconnected Plan Applied</h1>
          </div>
        </header>
        <section className="sk-card sk-done" role="status">
          <h2>Your skill graph &amp; schedule are updated</h2>
          <ul className="sk-planner-summary-list">
            {done.addedSubjects > 0 && <li>Added <strong>{done.addedSubjects}</strong> new skill{done.addedSubjects === 1 ? '' : 's'}</li>}
            {done.updatedSubjects > 0 && <li>Updated <strong>{done.updatedSubjects}</strong> existing skill{done.updatedSubjects === 1 ? '' : 's'}</li>}
            {done.addedTopics > 0 && <li>Added <strong>{done.addedTopics}</strong> topic{done.addedTopics === 1 ? '' : 's'}</li>}
            {done.addedResources > 0 && <li>Added <strong>{done.addedResources}</strong> resource{done.addedResources === 1 ? '' : 's'}</li>}
            {done.addedSteps > 0 && <li>Saved <strong>{done.addedSteps}</strong> explicit study step{done.addedSteps === 1 ? '' : 's'}</li>}
            {done.scheduledTasks > 0 && <li>Scheduled <strong>{done.scheduledTasks}</strong> daily task{done.scheduledTasks === 1 ? '' : 's'}</li>}
          </ul>
          <div className="sk-actions">
            <Link href="/skills" className="btn btn-primary">Open Board &amp; Schedule</Link>
            <Link href="/skills?view=graph" className="btn btn-secondary">🕸️ View Knowledge Graph</Link>
            <button
              type="button"
              className="sk-small-btn"
              onClick={() => {
                setDone(null);
                setReply('');
              }}
            >
              Plan or brainstorm more
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="sk sk-narrow sk-planner">
      <header className="sk-head">
        <div>
          <Link className="sk-back" href="/skills">← Skills</Link>
          <h1>Interconnected AI Planner &amp; Brainstormer</h1>
          <p>
            Build an ordered multi-skill study schedule or brainstorm new skills and subskills from your current Dreyfus levels.
          </p>
        </div>
      </header>

      <div className="sk-view-switch" role="tablist" aria-label="Planner mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'schedule'}
          className={`sk-view-btn${mode === 'schedule' ? ' is-active' : ''}`}
          onClick={() => setMode('schedule')}
        >
          🗓️ Interconnected Learning Schedule
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'brainstorm'}
          className={`sk-view-btn${mode === 'brainstorm' ? ' is-active' : ''}`}
          onClick={() => setMode('brainstorm')}
        >
          💡 Brainstorm New Skills &amp; Subskills
        </button>
      </div>

      <section className="sk-card">
        <h2><span className="sk-step">0</span> Configure your {mode === 'schedule' ? 'schedule' : 'brainstorm'}</h2>

        <div className="sk-grid-2">
          <label className="sk-field">
            <span>Daily study budget (hours / day)</span>
            <input
              type="number"
              min={0.25}
              max={16}
              step={0.25}
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(e.target.value)}
            />
            <small>~{Math.round(effectiveHours * 60)} minutes per day</small>
          </label>

          {mode === 'schedule' ? (
            <div className="sk-field">
              <span>Planning horizon</span>
              <div className="sk-toggles">
                {([7, 14, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="sk-small-btn"
                    aria-pressed={days === d}
                    onClick={() => setDays(d)}
                  >
                    {d} days
                  </button>
                ))}
              </div>
              <small>Starts today ({today}) with automatic carry-forward if you miss a day.</small>
            </div>
          ) : (
            <div className="sk-field">
              <span>Starter schedule horizon</span>
              <div className="sk-toggles">
                {([7, 14, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="sk-small-btn"
                    aria-pressed={days === d}
                    onClick={() => setDays(d)}
                  >
                    {d} days
                  </button>
                ))}
              </div>
              <small>Brainstorm includes starter topics, free PDFs/lectures, steps, and optional schedule.</small>
            </div>
          )}
        </div>

        {board.subjects.length > 0 && (
          <div className="sk-field">
            <div className="sk-card-head">
              <span>Focus skills ({focusIds.size ? `${focusIds.size} selected` : 'all active skills included'})</span>
              {focusIds.size > 0 && (
                <button type="button" className="sk-text-btn" onClick={() => setFocusIds(new Set())}>
                  Clear focus filter
                </button>
              )}
            </div>
            <div className="sk-planner-focus-grid">
              {board.subjects.map((s) => (
                <label key={s.id} className="sk-planner-focus-item">
                  <input
                    type="checkbox"
                    checked={focusIds.has(s.id)}
                    onChange={() => toggleFocus(s.id)}
                  />
                  <span aria-hidden>{s.icon}</span>
                  <span className="sk-planner-focus-name">{s.name}</span>
                  <span className="sk-chip">{fmtLevel(levelById.get(s.id) ?? s.level)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="sk-field">
          <span>Goals &amp; direction (optional)</span>
          <textarea
            rows={3}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder={
              mode === 'schedule'
                ? 'e.g. Build an autonomous drone controller; prioritize Controls fundamentals before Nonlinear MPC; include reading chapters and hands-on lab tasks.'
                : 'e.g. Suggest skills that bridge embedded Rust, control theory, and robotics hardware so I can design flight controllers end-to-end.'
            }
          />
        </label>
      </section>

      <CopyPrompt
        title={mode === 'schedule' ? 'Copy interconnected schedule prompt' : 'Copy skill brainstorm prompt'}
        prompt={prompt}
      >
        <p className="sk-hint">
          Includes all {board.subjects.length} skill{board.subjects.length === 1 ? '' : 's'}, their Dreyfus levels, parent/subskill links, topics, resources, and current steps.
        </p>
      </CopyPrompt>

      <PasteReply value={reply} onChange={setReply}>
        {parsed && !parsed.ok && <p className="sk-warning">{parsed.error}</p>}
      </PasteReply>

      {draft && (
        <section className="sk-card sk-planner-preview" aria-live="polite">
          <h2>Preview parsed {mode === 'schedule' ? 'interconnected plan' : 'brainstorm & plan'}</h2>
          {draft.summary && <p className="sk-pp-summary">{draft.summary}</p>}
          {parsed && parsed.warnings.length > 0 && (
            <ul className="sk-pp-warnings">
              {parsed.warnings.map((w, i) => <li key={i} className="sk-warning">{w}</li>)}
            </ul>
          )}

          {draft.newSubjects.length > 0 && (
            <div className="sk-planner-section">
              <div className="sk-card-head">
                <h3>Suggested new skills &amp; subskills ({selectedNewSubjects.length}/{draft.newSubjects.length})</h3>
                <div className="sk-actions">
                  <button
                    type="button"
                    className="sk-text-btn"
                    onClick={() => setOffNewSubjects({ reply, keys: new Set() })}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="sk-text-btn"
                    onClick={() => setOffNewSubjects({ reply, keys: new Set(draft.newSubjects.map((s) => s.name)) })}
                  >
                    Deselect all
                  </button>
                </div>
              </div>
              <ul className="sk-brainstorm-list">
                {draft.newSubjects.map((ns) => {
                  const checked = !deselectedNew.has(ns.name);
                  return (
                    <li key={ns.name} className={`sk-brainstorm-card${checked ? ' is-on' : ' is-off'}`}>
                      <label className="sk-brainstorm-head">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNewSubject(ns.name)}
                        />
                        <span className="sk-brainstorm-icon" aria-hidden>{ns.icon ?? '🧠'}</span>
                        <div className="sk-brainstorm-title">
                          <strong>{ns.name}</strong>
                          <span className="sk-muted">{ns.area} · target level {ns.target}</span>
                        </div>
                      </label>

                      {ns.why && <p className="sk-brainstorm-why">{ns.why}</p>}

                      {ns.parentSubjectRefs.length > 0 && (
                        <div className="sk-chips">
                          <span className="sk-muted">Builds on:</span>
                          {ns.parentSubjectRefs.map((p) => (
                            <span key={p} className="sk-chip">🔗 {p}</span>
                          ))}
                        </div>
                      )}

                      {ns.topics.length > 0 && (
                        <details className="sk-brainstorm-details">
                          <summary>{ns.topics.length} starter topic{ns.topics.length === 1 ? '' : 's'}</summary>
                          <ul className="sk-pp-list">
                            {ns.topics.map((t) => (
                              <li key={t.key} className="sk-pp-row">
                                <div className="sk-pp-body">
                                  <strong>{t.name}</strong>
                                  <span className="sk-pp-meta">
                                    {STAGES.find((st) => st.stage === t.stage)?.name ?? `Stage ${t.stage}`}
                                    {!t.core ? ' · Optional' : ''}
                                  </span>
                                  {t.description && <p className="sk-hint">{t.description}</p>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {ns.resources.length > 0 && (
                        <details className="sk-brainstorm-details">
                          <summary>{ns.resources.length} resource{ns.resources.length === 1 ? '' : 's'}</summary>
                          <ul className="sk-pp-list">
                            {ns.resources.map((r, idx) => (
                              <li key={idx} className="sk-pp-row">
                                <div className="sk-pp-body">
                                  <strong>{RESOURCE_LABEL[r.kind].icon} {r.title}</strong>
                                  <span className="sk-pp-meta">
                                    {RESOURCE_LABEL[r.kind].label}
                                    {r.author ? ` · ${r.author}` : ''}
                                    {r.hours ? ` · ~${r.hours}h` : ''}
                                  </span>
                                  {r.detail && <p className="sk-hint">{r.detail}</p>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {ns.steps.length > 0 && (
                        <details className="sk-brainstorm-details" open>
                          <summary>{ns.steps.length} explicit step{ns.steps.length === 1 ? '' : 's'}</summary>
                          <ol className="sk-pp-list">
                            {ns.steps.map((st, idx) => (
                              <li key={idx} className="sk-pp-row">
                                <div className="sk-pp-body">
                                  <div className="sk-pp-step-head">
                                    <span className="sk-chip">{st.kind}</span>
                                    <strong>{st.title}</strong>
                                    {st.amount && <span className="sk-chip sk-sched-amount">{st.amount}</span>}
                                    {st.minutes && <span className="sk-chip sk-sched-mins">{st.minutes}m</span>}
                                  </div>
                                  {st.detail && <p className="sk-hint">{st.detail}</p>}
                                </div>
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {draft.parentLinks.length > 0 && (
            <div className="sk-planner-section">
              <h3>Parent / subskill links ({draft.parentLinks.length})</h3>
              <ul className="sk-pp-list">
                {draft.parentLinks.map((link, idx) => (
                  <li key={idx} className="sk-pp-row">
                    <div className="sk-pp-body">
                      <strong>{link.subjectName}</strong>
                      <span className="sk-pp-meta">Builds on: {link.parentRefs.join(', ')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.subjectPlans.length > 0 && (
            <div className="sk-planner-section">
              <div className="sk-card-head">
                <h3>Skill step plans ({draft.subjectPlans.length})</h3>
              </div>
              <div className="sk-pp-choices">
                <label>
                  <input
                    type="checkbox"
                    checked={includeSubjectPlans}
                    onChange={(e) => setIncludeSubjectPlans(e.target.checked)}
                  />
                  Apply explicit steps, topics, and resources to these skills
                </label>
                {includeSubjectPlans && (
                  <label>
                    <input
                      type="checkbox"
                      checked={replaceSteps}
                      onChange={(e) => setReplaceSteps(e.target.checked)}
                    />
                    Replace existing steps on updated skills (uncheck to append new steps)
                  </label>
                )}
              </div>
              <div className="sk-planner-subplans">
                {draft.subjectPlans.map((sp, idx) => (
                  <div key={`${sp.subjectName}-${idx}`} className="sk-planner-subplan">
                    <div className="sk-card-head">
                      <strong>{sp.subjectName}</strong>
                      <span className="sk-muted">
                        {sp.steps.length} step{sp.steps.length === 1 ? '' : 's'}
                        {sp.topics.length ? ` · ${sp.topics.length} topics` : ''}
                        {sp.resources.length ? ` · ${sp.resources.length} resources` : ''}
                      </span>
                    </div>
                    {sp.steps.length > 0 && (
                      <ol className="sk-pp-list">
                        {sp.steps.map((st, sIdx) => (
                          <li key={sIdx} className="sk-pp-row">
                            <div className="sk-pp-body">
                              <div className="sk-pp-step-head">
                                <span className="sk-chip">{st.kind}</span>
                                <strong>{st.title}</strong>
                                {st.amount && <span className="sk-chip sk-sched-amount">{st.amount}</span>}
                                {st.minutes && <span className="sk-chip sk-sched-mins">{st.minutes}m</span>}
                              </div>
                              {st.detail && <p className="sk-hint">{st.detail}</p>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {scheduleGroups.length > 0 && (
            <div className="sk-planner-section">
              <h3>Day-by-day schedule ({draft.schedule.length} task{draft.schedule.length === 1 ? '' : 's'} across {scheduleGroups.length} day{scheduleGroups.length === 1 ? '' : 's'})</h3>
              <div className="sk-pp-choices">
                <label>
                  <input
                    type="checkbox"
                    checked={includeSchedule}
                    onChange={(e) => setIncludeSchedule(e.target.checked)}
                  />
                  Import scheduled tasks into your study queue
                </label>
                {includeSchedule && (
                  <label>
                    <input
                      type="checkbox"
                      checked={replaceSchedule}
                      onChange={(e) => setReplaceSchedule(e.target.checked)}
                    />
                    Replace your existing schedule (uncheck to append)
                  </label>
                )}
              </div>
              <div className="sk-planner-timeline">
                {scheduleGroups.map(([day, tasks]) => {
                  const totalMin = tasks.reduce((sum, t) => sum + (t.minutes ?? 0), 0);
                  return (
                    <div key={day} className="sk-sched-day-group">
                      <div className="sk-sched-day-head">
                        <strong>Day {tasks[0]?.dayIndex ?? '?'} · {day}</strong>
                        {totalMin > 0 && <span className="sk-muted">~{totalMin} min</span>}
                      </div>
                      <ul className="sk-pp-list">
                        {tasks.map((t, idx) => (
                          <li key={idx} className="sk-pp-row">
                            <div className="sk-pp-body">
                              <div className="sk-pp-step-head">
                                <span className="sk-chip">{t.subjectName}</span>
                                <strong>{t.title}</strong>
                                {t.amount && <span className="sk-chip sk-sched-amount">{t.amount}</span>}
                                {t.minutes && <span className="sk-chip sk-sched-mins">{t.minutes}m</span>}
                              </div>
                              {t.detail && <p className="sk-hint">{t.detail}</p>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {applyError && <ErrorNote>{applyError}</ErrorNote>}

          <div className="sk-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !canApply}
              onClick={applyPlan}
            >
              {busy
                ? 'Applying…'
                : mode === 'brainstorm' && selectedNewSubjects.length > 0
                  ? `Import ${selectedNewSubjects.length} skill${selectedNewSubjects.length === 1 ? '' : 's'} & Apply Plan`
                  : 'Apply Interconnected Plan'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
