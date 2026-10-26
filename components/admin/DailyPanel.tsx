'use client';

import { useCallback, useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { AnswerText } from '@/components/daily/AnswerInput';
import { FormulaOfTheDay } from '@/components/daily/FormulaSheet';
import FormulaSheet from '@/components/daily/FormulaSheet';
import { useSitePopup } from '@/components/SitePopup';
import { localToday } from '@/lib/habits/dates';
import { TRACK_LABEL, type DailyDay, type Question, type Track } from '@/lib/daily/types';
import 'katex/dist/katex.min.css';
import '@/app/daily/daily.css';

type DaySummary = { date: string; boss: boolean; questions: { id: string; title: string; track: Track; topic: string; difficulty: number; core: boolean }[] };
type FeedbackRow = {
  questionId: string; date: string; title: string; track: Track; topic: string; difficulty: number; core: boolean;
  answered: number; solved: number; partial: number; wrong: number; studied: number; hintsUsed: number;
  up: number; down: number; easy: number; right: number; hard: number; reports: { kind: string; note: string; at: string }[];
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw Object.assign(new Error(data.message || 'Request failed'), { errors: data.errors as string[] | undefined });
  return data;
}

/** A question as the admin sees it: everything, answer key and check notes included. */
function QuestionPreview({ q, kind }: { q: Question; kind: string }) {
  return (
    <article className={`dq-card is-${q.track}`}>
      <div className="dq-badges">
        <span className="dq-badge is-kind">{kind}</span>
        <span className={`dq-badge is-track is-${q.track}`}>{TRACK_LABEL[q.track]}</span>
        <span className="dq-badge">{q.topic}</span>
        <span className="dq-badge">Difficulty {q.difficulty}</span>
        <code className="adm-muted">{q.id}</code>
      </div>
      <h3 style={{ marginTop: '0.5rem' }}>{q.title}</h3>
      <MathText>{q.prompt}</MathText>
      {q.figure && <figure className="dq-figure"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.figure)}`} alt={q.figureAlt ?? ''} /></figure>}
      <div className="dq-parts">
        {q.parts.map((p, i) => (
          <section key={p.id} className="dq-part">
            {q.parts.length > 1 && <strong>({String.fromCharCode(97 + i)}) </strong>}
            {p.prompt && <MathText className="is-inline">{p.prompt}</MathText>}
            <div className="dq-key"><span>Answer ({p.answer.type}):</span> <AnswerText answer={p.answer} /></div>
            {p.mistakes?.map((m, j) => (
              <div key={j} className="dq-mistake">If {m.value ?? `option ${String.fromCharCode(65 + (m.option ?? 0))}`}: <MathText className="is-inline">{m.note}</MathText></div>
            ))}
          </section>
        ))}
      </div>
      {q.hints?.map((h, i) => <div key={i} className="dq-hint-box" style={{ marginTop: '0.5rem' }}><strong>Hint {i + 1}:</strong> <MathText className="is-inline">{h}</MathText></div>)}
      <section className="dq-solution"><h3>Worked solution</h3><MathText figures={q.solutionFigures}>{q.solution}</MathText></section>
      <section className="dq-sources"><h3>Sources</h3><ul>{q.sources.map((s, i) => <li key={i}>{s.title}{s.detail ? ` — ${s.detail}` : ''}{s.url ? ` (${s.url})` : ''}</li>)}</ul></section>
      {q.check && <section className="dq-sources"><h3>How it was checked</h3><MathText>{q.check}</MathText></section>}
    </article>
  );
}

function DayInspector({ date, onChanged, onClose }: { date: string; onChanged: () => void; onClose: () => void }) {
  const { confirm, popup } = useSitePopup();
  const [day, setDay] = useState<DailyDay | null>(null);
  const [json, setJson] = useState('');
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api(`/api/daily/admin?date=${date}`).then((d) => { setDay(d.day); setJson(JSON.stringify(d.day, null, 2)); }).catch((e) => setMessage(e.message));
  }, [date]);

  const save = async () => {
    setErrors([]);
    setMessage('');
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch (e) { setErrors([`Not valid JSON: ${(e as Error).message}`]); return; }
    try {
      await api(`/api/daily/admin?today=${localToday()}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, days: [parsed] }) });
      setDay(parsed as DailyDay);
      setEditing(false);
      setMessage('Saved. Anyone who already answered is regraded against the new key.');
      onChanged();
    } catch (e) {
      setErrors((e as { errors?: string[] }).errors ?? [(e as Error).message]);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${date}?`, message: 'The questions for this day are removed. Answers people already gave stay in their history with the grade they got.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/api/daily/admin?date=${date}`, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="adm-card">
      {popup}
      <div className="adm-card-head">
        <div>
          <h2 style={{ margin: 0 }}>{date}{day?.boss ? ' · 👹 boss' : ''}</h2>
          <div className="adm-muted">Exactly what people will see, plus the answer key and check notes.</div>
        </div>
        <div className="adm-actions">
          <button type="button" className="btn btn-secondary adm-small-btn" onClick={() => setEditing((e) => !e)}>{editing ? 'Preview' : 'Edit JSON'}</button>
          <button type="button" className="btn btn-secondary adm-small-btn" onClick={remove}>Delete day</button>
          <button type="button" className="btn btn-secondary adm-small-btn" onClick={onClose}>Close</button>
        </div>
      </div>
      {message && <div className="adm-notice">{message}</div>}
      {errors.length > 0 && <ul className="adm-notice" style={{ paddingLeft: '1.5rem' }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {editing ? (
        <>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={28} spellCheck={false}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', lineHeight: 1.45 }} aria-label="Day JSON" />
          <div className="adm-actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-primary" onClick={save}>Check and save</button>
          </div>
        </>
      ) : day ? (
        <>
          {day.formulaOfTheDay && <FormulaOfTheDay formula={day.formulaOfTheDay} />}
          <FormulaSheet formulas={day.formulas} />
          <QuestionPreview q={day.core} kind={day.boss ? '👹 Core (boss)' : '⭐ Core'} />
          {day.bonus.map((q, i) => <QuestionPreview key={q.id} q={q} kind={`🎁 Bonus ${i + 1}`} />)}
        </>
      ) : <p className="adm-muted">Loading…</p>}
    </div>
  );
}

export default function DailyPanel() {
  const [summary, setSummary] = useState<{ today: string; buffer: number; days: DaySummary[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ message: string; errors?: string[] } | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[] | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [notesSaved, setNotesSaved] = useState('');
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(() => {
    api(`/api/daily/admin?today=${localToday()}`).then(setSummary).catch(() => setSummary({ today: localToday(), buffer: 0, days: [] }));
    api('/api/daily/feedback').then((d) => setFeedback(d.questions)).catch(() => setFeedback([]));
  }, []);
  useEffect(() => {
    load();
    api('/api/daily/admin/notes').then((d) => setNotes(d.notes)).catch(() => setNotes(''));
  }, [load]);

  const uploadFile = async (file: File) => {
    setUpload({ message: `Checking ${file.name}…` });
    try {
      const text = await file.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch (e) { setUpload({ message: `${file.name} isn’t valid JSON: ${(e as Error).message}` }); return; }
      const d = await api(`/api/daily/admin?today=${localToday()}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setUpload({ message: `Uploaded ${d.dates.length} day${d.dates.length === 1 ? '' : 's'} (${d.added} new, ${d.replaced} replaced). ${d.buffer} days ready from today.` });
      load();
    } catch (e) {
      setUpload({ message: `${file.name} wasn’t uploaded.`, errors: (e as { errors?: string[] }).errors ?? [(e as Error).message] });
    }
  };

  const saveNotes = async () => {
    try {
      await api('/api/daily/admin/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
      setNotesSaved('Saved.');
    } catch (e) {
      setNotesSaved((e as Error).message);
    }
  };

  const today = summary?.today ?? localToday();
  const days = (summary?.days ?? []).filter((d) => showPast || d.date >= today);
  const reports = (feedback ?? []).flatMap((r) => r.reports.map((rep) => ({ ...rep, row: r }))).sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 style={{ margin: 0 }}>Daily questions</h2>
            <div className="adm-muted">Uploaded ahead of time by the weekly generator, or by hand here.</div>
          </div>
        </div>
        <div className="adm-stats">
          <div className="adm-stat">
            <div className="adm-stat-label">Ready ahead</div>
            <div className="adm-stat-value" style={summary && summary.buffer < 3 ? { color: 'var(--warning)' } : undefined}>{summary ? `${summary.buffer} days` : '…'}</div>
            <div className="adm-stat-sub">{summary && summary.buffer < 3 ? 'Running low: run the generator' : 'from today, without a gap'}</div>
          </div>
          <div className="adm-stat"><div className="adm-stat-label">Days stored</div><div className="adm-stat-value">{summary?.days.length ?? '…'}</div></div>
          <div className="adm-stat"><div className="adm-stat-label">Reports</div><div className="adm-stat-value">{reports.length}</div><div className="adm-stat-sub">problems people flagged</div></div>
        </div>

        <label className="adm-field" style={{ marginTop: '1rem' }}>
          <span>Upload a pack (JSON: {'{ "version": 1, "days": [...] }'}). Days already stored are replaced.</span>
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
        </label>
        {upload && (
          <div className="adm-notice" style={{ marginTop: '0.75rem' }}>
            {upload.message}
            {upload.errors && <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>{upload.errors.slice(0, 40).map((e, i) => <li key={i}><code>{e}</code></li>)}</ul>}
          </div>
        )}
      </div>

      {open && <DayInspector key={open} date={open} onChanged={load} onClose={() => setOpen(null)} />}

      <div className="adm-card">
        <div className="adm-card-head">
          <h2 style={{ margin: 0 }}>Days</h2>
          <label className="adm-check"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past days</label>
        </div>
        {days.length === 0 ? <p className="adm-muted">Nothing scheduled{showPast ? '' : ' from today on'}.</p> : (
          <div className="adm-list">
            {days.map((d) => (
              <div key={d.date} className="adm-row" style={d.date === today ? { borderColor: 'var(--accent-light)' } : undefined}>
                <div className="adm-row-main">
                  <div style={{ fontWeight: 700 }}>{d.date}{d.date === today ? ' · today' : ''}{d.boss ? ' · 👹' : ''}</div>
                  <div className="adm-row-sub">
                    {d.questions.map((q) => `${q.core ? '⭐' : '🎁'} ${q.title} (${TRACK_LABEL[q.track]}, ${q.difficulty})`).join('  ·  ')}
                  </div>
                </div>
                <button type="button" className="btn btn-secondary adm-small-btn" onClick={() => { setOpen(d.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Open</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-head"><h2 style={{ margin: 0 }}>Feedback</h2></div>
        {reports.length > 0 && (
          <>
            <h3 style={{ fontSize: '1rem' }}>Reported problems</h3>
            <div className="adm-list" style={{ marginBottom: '1rem' }}>
              {reports.map((r, i) => (
                <div key={i} className="adm-row">
                  <div className="adm-row-main">
                    <div style={{ fontWeight: 700 }}>⚑ {r.kind} · {r.row.title}</div>
                    <div className="adm-row-sub">{r.row.date} · {r.note || 'no note'}</div>
                  </div>
                  <button type="button" className="btn btn-secondary adm-small-btn" onClick={() => setOpen(r.row.date)}>Open day</button>
                </div>
              ))}
            </div>
          </>
        )}
        {!feedback?.length ? <p className="adm-muted">No answers or ratings yet.</p> : (
          <div className="dq-table-wrap">
            <table className="dq-table">
              <thead><tr><th scope="col">Question</th><th scope="col">Date</th><th scope="col">Solved</th><th scope="col">Studied</th><th scope="col">Hints</th><th scope="col">👍/👎</th><th scope="col">Easy/right/hard</th></tr></thead>
              <tbody>
                {feedback.map((r) => (
                  <tr key={r.questionId} className={`is-${r.track}`}>
                    <th scope="row"><i className="dq-dot" aria-hidden /> {r.core ? '' : '🎁 '}{r.title}</th>
                    <td>{r.date}</td>
                    <td>{r.answered ? `${Math.round((r.solved / r.answered) * 100)}% of ${r.answered}` : '—'}</td>
                    <td>{r.studied}</td><td>{r.hintsUsed}</td><td>{r.up}/{r.down}</td><td>{r.easy}/{r.right}/{r.hard}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 style={{ margin: 0 }}>Generator notes</h2>
            <div className="adm-muted">Read by the weekly generator before every run. Steer it here: “more PID tuning”, “fewer IEC basics”.</div>
          </div>
        </div>
        <textarea rows={10} value={notes ?? ''} disabled={notes === null} onChange={(e) => { setNotes(e.target.value); setNotesSaved(''); }} aria-label="Generator notes" />
        <div className="adm-actions" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={saveNotes} disabled={notes === null}>Save notes</button>
          {notesSaved && <span className="adm-muted">{notesSaved}</span>}
        </div>
      </div>
    </>
  );
}
