'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { ListEditor } from '@/components/study/ListEditor';
import { EmptyState, Loading } from '@/components/study/Ui';
import type { PatientCase, PatientCaseForHer } from '@/lib/study/practice';

// Editing a mock patient means seeing the script and the diagnosis, which spoils a
// case she hasn't played. So the answers aren't even fetched until she says go ahead.

type Line = { text: string };

export default function EditPatientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'gate' | 'ready' | 'signed-out' | 'error'>('loading');
  const [item, setItem] = useState<PatientCase | null>(null);
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [complaint, setComplaint] = useState('');
  const [vitals, setVitals] = useState('');
  const [course, setCourse] = useState('');
  const [opening, setOpening] = useState('');
  const [script, setScript] = useState<{ ask: string; say: string }[]>([]);
  const [exam, setExam] = useState<{ maneuver: string; finding: string }[]>([]);
  const [checklist, setChecklist] = useState<Line[]>([]);
  const [diagnosis, setDiagnosis] = useState('');
  const [teaching, setTeaching] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = useCallback(async () => {
    const body = await practiceGet<{ case: PatientCase }>(`case=${encodeURIComponent(id)}&full=1`);
    const full = body.case;
    setItem(full);
    setAge(full.door.age);
    setSex(full.door.sex);
    setComplaint(full.door.complaint);
    setVitals(full.door.vitals);
    setCourse(full.course);
    setOpening(full.opening);
    setScript(full.script);
    setExam(full.exam);
    setChecklist(full.checklist.map((text) => ({ text })));
    setDiagnosis(full.diagnosis);
    setTeaching(full.teaching);
    setState('ready');
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    practiceGet<{ case: PatientCaseForHer }>(`case=${encodeURIComponent(id)}`).then((body) => {
      if (cancelled) return;
      if (body.case.runs.length) return open();
      setState('gate');
    }).catch((e) => { if (!cancelled) setState(e instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, [id, open]);

  const back = <Link className="sd-back" href={`/study/practice/patient/${id}`}><Icon name="left" /> Mock patient</Link>;
  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to edit this case">Your cases are only shown to your account.</SignInPrompt></div>;
  if (state === 'loading') return <div className="sd sd-narrow"><Loading rows={2} /></div>;
  if (state === 'error') return <div className="sd sd-narrow"><div className="hb-banner is-error"><span>That case isn’t here any more.</span></div>{back}</div>;
  if (state === 'gate') {
    return (
      <div className="sd sd-narrow animate-fade-in">
        <header className="sd-head"><div>{back}<h1>Edit this case</h1></div></header>
        <EmptyState icon="alert" title="This will spoil the case">
          You haven’t played it yet, and editing shows the script and the diagnosis.
        </EmptyState>
        <div className="sd-actions ed-center">
          <button type="button" className="btn btn-secondary" onClick={() => open().catch(() => setState('error'))}>Show me anyway</button>
          <Link className="btn btn-primary" href={`/study/practice/patient/${id}`}>Play it first</Link>
        </div>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await practicePost('edit-case', {
        id, course, opening, script, exam, diagnosis, teaching,
        door: { age, sex, complaint, vitals },
        checklist: checklist.map((c) => c.text),
      });
      router.push(`/study/practice/patient/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          {back}
          <h1>Edit this case</h1>
          {item && <p>{item.title}</p>}
        </div>
      </header>

      <section className="sd-card">
        <h2>On the door</h2>
        <div className="sd-fields">
          <label>Age
            <input value={age} maxLength={20} onChange={(e) => setAge(e.target.value)} />
          </label>
          <label>Sex
            <input value={sex} maxLength={30} onChange={(e) => setSex(e.target.value)} />
          </label>
          <label className="sd-wide">Chief complaint
            <input value={complaint} maxLength={200} onChange={(e) => setComplaint(e.target.value)} />
          </label>
          <label className="sd-wide">Vitals
            <input value={vitals} maxLength={300} onChange={(e) => setVitals(e.target.value)} />
          </label>
          <label className="sd-wide">Class or module
            <input value={course} maxLength={80} onChange={(e) => setCourse(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="sd-card">
        <h2>The patient’s script</h2>
        <div className="sd-fields">
          <label className="sd-wide">What they say first
            <textarea rows={2} value={opening} maxLength={400} onChange={(e) => setOpening(e.target.value)} />
          </label>
        </div>
        <ListEditor title="Only if asked" hint="At least 3." items={script} addLabel="Add an answer" blank={{ ask: '', say: '' }} onChange={setScript}
          fields={[{ key: 'ask', label: 'If asked about', placeholder: 'When it started' }, { key: 'say', label: 'They say', placeholder: 'About an hour ago.', rows: 2 }]} />
        <ListEditor title="Exam findings" items={exam} addLabel="Add a finding" max={30} blank={{ maneuver: '', finding: '' }} onChange={setExam}
          fields={[{ key: 'maneuver', label: 'If they examine', placeholder: 'Listening to the heart' }, { key: 'finding', label: 'Finding', placeholder: 'Regular rhythm, no murmur.', rows: 2 }]} />
      </section>

      <section className="sd-card">
        <h2>Scoring and teaching</h2>
        <ListEditor title="Checklist" hint="At least 3." items={checklist} addLabel="Add an item" blank={{ text: '' }} onChange={setChecklist}
          fields={[{ key: 'text', label: 'Item', placeholder: 'Asks about onset' }]} />
        <div className="sd-fields">
          <label className="sd-wide">Diagnosis
            <input value={diagnosis} maxLength={200} onChange={(e) => setDiagnosis(e.target.value)} />
          </label>
          <label className="sd-wide">Teaching points
            <textarea rows={4} value={teaching} maxLength={2000} onChange={(e) => setTeaching(e.target.value)} />
          </label>
        </div>
      </section>

      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <Link className="btn btn-secondary" href={`/study/practice/patient/${id}`}>Cancel</Link>
      </div>
    </div>
  );
}
