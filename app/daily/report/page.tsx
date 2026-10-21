'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchAnalysis } from '@/components/daily/useDaily';
import { partRate, type Analysis, type Label, type Stat, type TopicStat } from '@/lib/daily/analysis';
import { localToday } from '@/lib/habits/dates';
import { TRACKS, TRACK_LABEL, type Track } from '@/lib/daily/types';
import '../daily.css';
import './report.css';

const LABEL: Record<Label, { text: string; icon: string }> = {
  strength: { text: 'Strength', icon: '💪' },
  solid: { text: 'Solid', icon: '👍' },
  developing: { text: 'Developing', icon: '📈' },
  weakness: { text: 'Weak spot', icon: '🎯' },
  new: { text: 'Too few to tell', icon: '…' },
};
const TYPE_LABEL: Record<string, string> = { numeric: 'Calculations', choice: 'Multiple choice', multi: 'Select all that apply', range: 'Ranges', coefficients: 'Transfer functions', order: 'Put in order' };
const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const practiceHref = (track: Track, topic: string) => `/daily?focus=${encodeURIComponent(`${track}|${topic}`)}#practice`;

/** Ability on the 1–5 difficulty scale as a bar. */
function AbilityBar({ value }: { value: number }) {
  return (
    <span className="rp-ability" title={`Ability ${value.toFixed(1)} of 5`}>
      <span className="rp-ability-track"><i style={{ width: `${Math.min(100, (value / 5) * 100)}%` }} /></span>
      <strong>{value.toFixed(1)}</strong>
    </span>
  );
}

function verdict(a: Analysis) {
  const names = (list: TopicStat[]) => list.slice(0, 3).map((t) => t.topic).join(', ');
  const bits: string[] = [];
  if (a.strengths.length) bits.push(`You're strongest in ${names(a.strengths)}.`);
  if (a.weaknesses.length) bits.push(`The weak spot${a.weaknesses.length > 1 ? 's are' : ' is'} ${names(a.weaknesses)}.`);
  if (a.comfort) bits.push(`You're comfortable up to difficulty ${a.comfort}${a.comfort < 5 ? `; difficulty ${a.comfort + 1} is where to stretch` : ''}.`);
  const best = [...a.tracks].sort((x, y) => y.ability - x.ability);
  if (best.length > 1) bits.push(`${TRACK_LABEL[best[0].track]} is your best track, ${TRACK_LABEL[best[best.length - 1].track]} the one with most room to grow.`);
  return bits.join(' ') || 'Answer a few more questions and this fills in.';
}

function Tiles({ s, comfort }: { s: Stat; comfort: number | null }) {
  return (
    <div className="dq-tiles">
      <div className="dq-tile"><span>Ability</span><strong>{s.ability.toFixed(1)}<small> / 5</small></strong><small>{comfort ? `comfortable to difficulty ${comfort}` : 'difficulty you solve about half'}</small></div>
      <div className="dq-tile"><span>Parts right</span><strong>{pct(partRate(s))}</strong><small>{s.partsRight} of {s.partsTotal}</small></div>
      <div className="dq-tile"><span>Solved first go</span><strong>{pct(s.answered ? s.clean / s.answered : null)}</strong><small>no retries or hints</small></div>
      <div className="dq-tile"><span>Checks per answer</span><strong>{s.avgTries ? s.avgTries.toFixed(2) : '—'}</strong><small>{s.studied} given up · {s.hints} hints</small></div>
    </div>
  );
}

/**
 * The strengths-and-weaknesses sheet: everything worked out from your answers
 * (daily, catch-up and practice), laid out to read on screen or print.
 */
export default function ReportPage() {
  const [data, setData] = useState<{ analysis: Analysis; signedIn: boolean } | null>(null);
  const [error, setError] = useState('');
  const today = localToday();

  useEffect(() => { fetchAnalysis(today).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load your report.')); }, [today]);

  if (error) return <div className="dq rp"><p className="dq-banner is-error">{error}</p></div>;
  if (!data) return <div className="dq rp"><p className="dq-hint">Working out your strengths and weaknesses…</p></div>;
  const a = data.analysis;
  const total = a.overall.answered + a.overall.studied;
  const maxWeek = Math.max(1, ...a.weeks.map((w) => w.answered));

  return (
    <div className="dq rp animate-fade-in">
      <header className="rp-head">
        <div>
          <Link href="/daily#stats" className="dq-text-btn rp-noprint">← Daily questions</Link>
          <h1>Strengths &amp; weaknesses</h1>
          <p className="dq-hint">{total} question{total === 1 ? '' : 's'} so far · as of {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' })}{data.signedIn ? '' : ' · from answers on this device'}</p>
        </div>
        <button type="button" className="btn btn-secondary rp-noprint" onClick={() => window.print()}>🖨 Print</button>
      </header>

      {total === 0 ? (
        <section className="dq-panel"><p className="dq-hint">Answer a few questions (daily or Practice) and your report starts here.</p></section>
      ) : (
        <>
          <section className="dq-panel rp-summary">
            <h3>Summary</h3>
            <p>{verdict(a)}</p>
            <Tiles s={a.overall} comfort={a.comfort} />
          </section>

          {a.focus.length > 0 && (
            <section className="dq-panel">
              <h3>🎯 What to practise next</h3>
              <ol className="rp-focus">
                {a.focus.map((f) => (
                  <li key={`${f.track}/${f.topic}`}>
                    <div>
                      <strong>{f.topic}</strong> <span className="dq-hint">· {TRACK_LABEL[f.track]} · at difficulty {f.difficulty}</span>
                      <small>{f.reason}</small>
                    </div>
                    <Link className="btn btn-primary rp-noprint" href={practiceHref(f.track, f.topic)}>Practise</Link>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="dq-panel">
            <h3>By track</h3>
            <div className="rp-tracks">
              {a.tracks.map((t) => (
                <div key={t.track} className={`rp-track is-${t.track}`}>
                  <strong>{TRACK_LABEL[t.track]}</strong>
                  <AbilityBar value={t.ability} />
                  <small>{t.answered + t.studied} done · {pct(partRate(t))} parts right · {t.solved} solved{t.maxSolved ? ` · hardest solved: ${t.maxSolved}` : ''}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="dq-panel">
            <h3>By topic</h3>
            <p className="dq-hint rp-note">Ability is the difficulty (1–5) at which you'd fully solve about half the questions in that topic. Retries, hints and giving up count against it; harder questions count for more.</p>
            <div className="rp-table-wrap">
              <table className="rp-table">
                <thead>
                  <tr><th>Topic</th><th>Done</th><th>Parts right</th><th>First go</th><th>Ability</th><th>Trend</th><th>Verdict</th></tr>
                </thead>
                <tbody>
                  {TRACKS.flatMap((track) => a.topics.filter((t) => t.track === track)).map((t) => (
                    <tr key={`${t.track}/${t.topic}`} className={`is-${t.label}`}>
                      <td><strong>{t.topic}</strong><small className={`rp-track-tag is-${t.track}`}>{TRACK_LABEL[t.track]}</small></td>
                      <td>{t.answered + t.studied}{t.studied ? <small> ({t.studied} given up)</small> : null}</td>
                      <td>{pct(partRate(t))}</td>
                      <td>{pct(t.answered ? t.clean / t.answered : null)}</td>
                      <td><AbilityBar value={t.ability} /></td>
                      <td>{t.trend === 'up' ? '↗ improving' : t.trend === 'down' ? '↘ slipping' : t.trend === 'flat' ? '→ steady' : '—'}</td>
                      <td>
                        <span className={`rp-label is-${t.label}`}>{LABEL[t.label].icon} {LABEL[t.label].text}</span>
                        <Link className="dq-text-btn rp-noprint rp-practise" href={practiceHref(t.track, t.topic)}>Practise</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="rp-grid">
            <section className="dq-panel">
              <h3>By difficulty</h3>
              <ul className="rp-bars">
                {a.difficulty.map((d) => (
                  <li key={d.difficulty}>
                    <span>{'●'.repeat(d.difficulty)}<span className="rp-dim">{'●'.repeat(5 - d.difficulty)}</span></span>
                    <span className="rp-bar"><i style={{ width: `${d.answered ? (d.solved / d.answered) * 100 : 0}%` }} /></span>
                    <small>{d.answered ? `${d.solved}/${d.answered} solved` : 'none yet'}</small>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dq-panel">
              <h3>By kind of question</h3>
              {a.answerTypes.length === 0 ? <p className="dq-hint">Nothing yet.</p> : (
                <ul className="rp-bars">
                  {a.answerTypes.map((t) => (
                    <li key={t.type}>
                      <span>{TYPE_LABEL[t.type] ?? t.type}</span>
                      <span className="rp-bar"><i style={{ width: `${(t.right / t.parts) * 100}%` }} /></span>
                      <small>{t.right}/{t.parts} parts</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {a.slips.length > 0 && (
            <section className="dq-panel">
              <h3>Slips you've made</h3>
              <p className="dq-hint rp-note">Wrong answers that matched a known mistake. The ones you repeat are worth a minute of attention.</p>
              <ul className="rp-slips">
                {a.slips.map((s) => (
                  <li key={s.note}>
                    <span className="rp-count">{s.count}×</span>
                    <span>{s.note.replace(/\$([^$]+)\$/g, '$1')}<small> — {s.topic}, {TRACK_LABEL[s.track]}</small></span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="dq-panel">
            <h3>Last 12 weeks</h3>
            <div className="rp-weeks" role="img" aria-label="Questions answered and share of parts right each week">
              {a.weeks.map((w) => (
                <div key={w.week} title={`Week of ${fmtDay(w.week)}: ${w.answered} done, ${pct(w.partRate)} parts right`}>
                  <span className="rp-week-bar" style={{ height: `${(w.answered / maxWeek) * 100}%`, opacity: w.partRate === null ? 0.25 : 0.35 + 0.65 * w.partRate }} />
                  <small>{fmtDay(w.week)}</small>
                </div>
              ))}
            </div>
            <p className="dq-hint rp-note">Bar height: questions done. Darker: more parts right.</p>
          </section>

          {a.untried.length > 0 && (
            <section className="dq-panel">
              <h3>Not tried yet</h3>
              {TRACKS.map((track) => {
                const list = a.untried.filter((u) => u.track === track);
                return list.length ? (
                  <p key={track} className="rp-untried"><strong>{TRACK_LABEL[track]}:</strong> {list.map((u) => (
                    <Link key={u.topic} className="dq-chip" href={practiceHref(track, u.topic)}>{u.topic}</Link>
                  ))}</p>
                ) : null;
              })}
              <p className="dq-hint rp-note">Daily questions rotate through these; Practice may not have them yet.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
