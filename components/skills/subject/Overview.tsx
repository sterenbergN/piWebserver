'use client';

import Link from 'next/link';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MathText } from '@/components/daily/MathText';
import { STAGES } from '@/lib/skills/types';
import type { NextStepKind } from '@/lib/skills/model';
import { fmtLevel } from '../api';
import { LevelBar, StateChip } from '../Ui';
import { ago, shortDay, type TabProps } from './shared';

// The first tab: what to do next, how close to an SME, the topic map and the
// level over time. Nothing is edited here; every row leads somewhere.

const STEP_ICON: Record<NextStepKind, string> = {
  review: '🔁', plan: '🗺️', rate: '🎚️', practice: '🎯', refresh: '🍂', 'test-yourself': '✅', write: '✍️', resource: '📚', 'find-material': '🔎',
};

const tooltipStyle = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--foreground)' };

type Props = TabProps & {
  /** Handle a link that points at this same page (?tab=…#r-…): true if it did. */
  goto: (href: string) => boolean;
  setTab: (tab: string) => void;
};

export default function Overview({ data, goto, setTab }: Props) {
  const { subject, stats, nextSteps, history } = data;
  const id = subject.id;
  const topics = stats.topics;
  const names = (state: string) => topics.filter((t) => t.state === state).map((t) => t.name);
  const strong = names('strong');
  const weak = names('weak');
  const fading = names('fading');
  const r = stats.resources;
  const chart = history.length >= 2 && history.some((h) => h.level > 0 || h.fitted > 0);

  if (!topics.length) {
    return (
      <section className="sk-card sk-empty-card">
        <h2>There’s nothing in {subject.name} yet</h2>
        <p className="sk-hint">Topics are the parts of a subject. Once you have some, you can rate yourself, add books and projects, and get tested on each part. An AI can draft the whole plan in a few minutes.</p>
        <div className="sk-actions">
          <Link className="btn btn-primary" href={`/skills/${id}/plan`}>Plan it with AI</Link>
          <button type="button" className="sk-text-btn" onClick={() => setTab('topics')}>or add topics yourself</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {nextSteps.length > 0 && (
        <section className="sk-card" aria-labelledby="sk-ov-next">
          <h2 id="sk-ov-next">Next steps</h2>
          <ul className="sk-rows">
            {nextSteps.map((n, i) => (
              <li key={`${n.kind}-${n.topicId ?? ''}-${i}`}>
                <Link className="sk-step-row" href={n.href} onClick={(e) => { if (goto(n.href)) e.preventDefault(); }}>
                  <span className="sk-step-icon" aria-hidden>{STEP_ICON[n.kind]}</span>
                  <span className="sk-step-text"><strong>{n.title}</strong><span>{n.detail}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sk-card" aria-labelledby="sk-ov-sme">
        <h2 id="sk-ov-sme">SME check {stats.sme && <span className="sk-tier is-sme">🏅 SME</span>}</h2>
        <p className="sk-hint">The expert badge is earned, not claimed, and it goes again if you stop testing yourself. It needs every line ticked.</p>
        <ul className="sk-checks">
          {stats.smeChecks.map((c) => (
            <li key={c.label} className={c.met ? 'is-met' : ''}><span aria-hidden>{c.met ? '✓' : '○'}</span> {c.label}<span className="sk-sr"> ({c.met ? 'met' : 'not yet'})</span></li>
          ))}
        </ul>
      </section>

      <section className="sk-card" aria-labelledby="sk-ov-map">
        <div className="sk-card-head">
          <h2 id="sk-ov-map">Topic map</h2>
          <button type="button" className="sk-text-btn" onClick={() => setTab('topics')}>Edit topics</button>
        </div>
        {(strong.length > 0 || weak.length > 0 || fading.length > 0) && (
          <ul className="sk-summary">
            {strong.length > 0 && <li><span className="sk-chip is-strong">💪 Strong</span> {strong.join(', ')}</li>}
            {weak.length > 0 && <li><span className="sk-chip is-weak">⚠️ Weak</span> {weak.join(', ')}</li>}
            {fading.length > 0 && <li><span className="sk-chip is-fading">🍂 Fading</span> {fading.join(', ')}</li>}
          </ul>
        )}
        {STAGES.map((st) => {
          const rows = topics.filter((t) => t.stage === st.stage);
          if (!rows.length) return null;
          return (
            <div key={st.stage} className="sk-stage">
              <h3>{st.name}</h3>
              <ul className="sk-rows">
                {rows.map((t) => {
                  const test = `/skills/review?subject=${id}&topic=${t.topicId}`;
                  return (
                    <li key={t.topicId} className="sk-topic-row">
                      <div className="sk-topic-name">
                        {t.liveItems > 0 ? <Link href={test} title="Test me on this topic">{t.name}</Link> : <span>{t.name}</span>}
                        {!t.core && <span className="sk-optional">optional</span>}
                      </div>
                      <div className="sk-topic-bar"><LevelBar size="sm" level={t.level} fitted={t.fitted} target={subject.target} label={t.name} /></div>
                      <div className="sk-topic-meta">
                        <strong className="sk-num">{fmtLevel(t.level)}</strong>
                        <StateChip state={t.state} />
                        <span className="sk-muted">{t.answers} answer{t.answers === 1 ? '' : 's'}</span>
                        <span className="sk-muted">{t.lastTested ? `tested ${ago(t.lastTested)}` : 'never tested'}</span>
                        {t.liveItems > 0 && <Link className="sk-small-btn" href={test}>Test me</Link>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="sk-card" aria-labelledby="sk-ov-time">
        <h2 id="sk-ov-time">Level over time</h2>
        {chart ? (
          <div className="sk-chart" role="img" aria-label={`Level over time, now ${fmtLevel(stats.level)} against a target of ${subject.target}`}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={history} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--surface-border)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--surface-border)" minTickGap={32} />
                <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--surface-border)" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => shortDay(String(d))} formatter={(v) => (typeof v === 'number' ? v.toFixed(1) : v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={subject.target} stroke="var(--foreground)" strokeDasharray="2 4" label={{ value: `target ${subject.target}`, position: 'insideTopLeft', fontSize: 11, fill: 'var(--muted)' }} />
                <Line type="monotone" dataKey="fitted" name="before fading" stroke="var(--habit-1)" strokeOpacity={0.5} strokeDasharray="5 4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="level" name="level" stroke="var(--habit-1)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="sk-hint">Your level will draw itself here once you’ve rated topics or answered a few questions on different days.</p>
        )}
      </section>

      <section className="sk-card" aria-labelledby="sk-ov-res">
        <div className="sk-card-head">
          <h2 id="sk-ov-res">Resources</h2>
          <button type="button" className="sk-text-btn" onClick={() => setTab('resources')}>See them all</button>
        </div>
        <p className="sk-hint">
          {r.done + r.doing + r.planned === 0
            ? 'No books, courses or projects yet.'
            : `${r.done} done, ${r.doing} in progress, ${r.planned} planned${r.hoursDone ? `. About ${r.hoursDone} hours finished.` : '.'}`}
        </p>
      </section>

      <section className="sk-card" aria-labelledby="sk-ov-goal">
        <h2 id="sk-ov-goal">Goal and roadmap</h2>
        {subject.goal ? <p className="sk-goal">{subject.goal}</p> : <p className="sk-hint">No goal written down yet. Add one with Edit.</p>}
        {subject.roadmap ? <MathText className="sk-roadmap">{subject.roadmap}</MathText> : (
          <p className="sk-hint">There’s no roadmap yet. <Link href={`/skills/${id}/plan`}>Plan it with AI</Link> to get one.</p>
        )}
      </section>
    </>
  );
}
