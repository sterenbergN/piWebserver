'use client';

import Link from 'next/link';
import { Loading } from '@/components/study/Ui';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { useSitePopup } from '@/components/SitePopup';
import { InlineMath } from '@/components/study/InlineMath';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { Icon } from '@/components/study/Icon';
import { PartnerLink, useLiveSession } from '@/components/study/PartnerLink';
import { fmtDay } from '@/components/study/TestRow';
import { formatSeconds } from '@/lib/study/practice';
import type { CaseRun, OwnerSessionView } from '@/lib/study/partner';
import type { PatientCase, PatientCaseForHer } from '@/lib/study/practice';

// Her side of the mock patient: partner link mode (server hides script until over)
// OR Solo practice mode (interactive progressive history/exam reveal + self-score checklist).

type LiveCase = Extract<OwnerSessionView, { caseId?: string }>;
type SoloPhase = 'idle' | 'encounter' | 'score' | 'done';

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, popup } = useSitePopup();
  const { session, setSession, loaded, signedOut } = useLiveSession();
  const [item, setItem] = useState<PatientCaseForHer | null>(null);
  const [fullCase, setFullCase] = useState<PatientCase | null>(null);
  const [solo, setSolo] = useState(false);
  const [soloPhase, setSoloPhase] = useState<SoloPhase>('idle');
  const [askedScript, setAskedScript] = useState<number[]>([]);
  const [checkedExam, setCheckedExam] = useState<number[]>([]);
  const [ticked, setTicked] = useState<number[]>([]);
  const [soloSeconds, setSoloSeconds] = useState(0);
  const [soloRun, setSoloRun] = useState<CaseRun | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const live = session?.kind === 'patient' && 'caseId' in session && session.caseId === id ? (session as LiveCase) : null;
  const finished = !!live?.finished;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('solo') === '1') setSolo(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    practiceGet<{ case: PatientCaseForHer }>(`case=${encodeURIComponent(id)}`).then((body) => {
      if (cancelled) return;
      setItem(body.case);
      setState('ready');
    }).catch((e) => { if (!cancelled) setState(e instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
    // Again when a run finishes, for the history.
  }, [id, finished]);

  useEffect(() => {
    if (soloPhase !== 'encounter') return;
    const timer = window.setInterval(() => setSoloSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [soloPhase]);

  const startSolo = async () => {
    setBusy(true);
    setError('');
    try {
      const data = fullCase ?? (await practiceGet<{ case: PatientCase }>(`case=${encodeURIComponent(id)}&full=1`)).case;
      setFullCase(data);
      setAskedScript([]);
      setCheckedExam([]);
      setTicked([]);
      setSoloSeconds(0);
      setSoloRun(null);
      setSoloPhase('encounter');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the case for solo practice.');
    } finally {
      setBusy(false);
    }
  };

  const saveSoloScore = async () => {
    if (!fullCase || busy) return;
    setBusy(true);
    setError('');
    try {
      const body = await practicePost<{ run: CaseRun; case: PatientCase }>('record-case-run', { id, ticked, seconds: soloSeconds });
      setSoloRun(body.run);
      setFullCase(body.case);
      setItem({
        id: body.case.id,
        title: body.case.title,
        course: body.case.course,
        door: body.case.door,
        createdAt: body.case.createdAt,
        runs: body.case.runs,
        diagnosis: body.case.diagnosis,
        teaching: body.case.teaching,
      });
      setSoloPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save your score. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const body = await practicePost<{ session: OwnerSessionView }>('start-patient', { id });
      setSession(body.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start. Try again.');
    }
    setBusy(false);
  };
  const end = async () => {
    try {
      await practicePost('end-session');
      setSession(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t end it. Try again.');
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this case?', message: 'The case and how you’ve done on it will be gone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await practicePost('delete-case', { id });
      router.push('/study/practice');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete it.');
    }
  };

  if (state === 'signed-out' || signedOut) return <div className="sd"><SignInPrompt title="Sign in to practice">Your cases are only shown to your account.</SignInPrompt></div>;
  const run = live && 'run' in live ? live.run : undefined;
  const door = item?.door;
  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/practice">← Practice</Link>
          <h1>Mock patient</h1>
        </div>
      </header>
      {state === 'loading' && <Loading rows={2} />}
      {state === 'error' && <div className="hb-banner is-error"><span>That case isn’t here any more.</span></div>}
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}

      {item && door && (
        <>
          <section className="sd-card pr-door">
            <p className="sd-setup-title">On the door</p>
            <h2>{door.age && `${door.age}-year-old`} {door.sex}</h2>
            <p className="pr-door-line"><strong>Chief complaint:</strong> {door.complaint}</p>
            {door.vitals && <p className="pr-door-line"><strong>Vitals:</strong> {door.vitals}</p>}
          </section>

          {live && !live.finished && (
            <>
              <PartnerLink token={live.token} who="Whoever’s playing the patient" onEnd={end} />
              <section className="sd-card pr-live" aria-live="polite">
                <p className="pr-live-big">{live.startedAt ? 'You’re on. Go ahead.' : 'Waiting for them to start the clock'}</p>
                <p className="hb-hint">Introduce yourself, take a history, ask to examine things, and say what you think it is. They’ll tell you the findings if you ask. This page keeps up by itself.</p>
              </section>
            </>
          )}

          {run && live && 'diagnosis' in live && (
            <section className="sd-card sd-done">
              <h2>{run.right} of {run.total} on the checklist</h2>
              {run.seconds > 0 && <p className="hb-hint">In {formatSeconds(run.seconds)}.</p>}
              <p className="pr-door-line"><strong>Diagnosis:</strong> <InlineMath>{live.diagnosis ?? ''}</InlineMath></p>
              {run.missed.length > 0 && (
                <>
                  <p className="sd-setup-title">What you missed</p>
                  <ul className="pr-missed">{run.missed.map((m) => <li key={m}><InlineMath>{m}</InlineMath></li>)}</ul>
                </>
              )}
              {live.teaching && <MathText>{live.teaching}</MathText>}
              <button type="button" className="btn btn-primary sd-self-start" onClick={end}>Done</button>
            </section>
          )}

          {loaded && !live && (
            <section className="sd-card">
              {soloPhase === 'idle' && (
                <div className="sd-segments" role="radiogroup" aria-label="Mock patient practice mode">
                  <button type="button" role="radio" aria-checked={!solo} onClick={() => setSolo(false)}>With a partner</button>
                  <button type="button" role="radio" aria-checked={solo} onClick={() => setSolo(true)}>Solo practice mode</button>
                </div>
              )}
              {!solo ? (
                <>
                  <p className="hb-hint">Get someone to play the patient. They’ll get the script and the checklist on their phone, with no account needed.</p>
                  {session && !session.finished && <p className="sd-warning">You have another link open, and this will end it.</p>}
                  <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Get a link'}</button>
                </>
              ) : soloPhase === 'idle' ? (
                <>
                  <p className="hb-hint">Practice on your own: reveal history answers and physical exam findings as you ask, then score yourself against the OSCE checklist.</p>
                  <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={startSolo}>{busy ? 'Loading…' : 'Start solo practice'}</button>
                </>
              ) : null}
            </section>
          )}

          {solo && !live && fullCase && soloPhase === 'encounter' && (
            <>
              <div className="pr-timer"><span>Solo encounter</span><strong>{formatSeconds(soloSeconds)}</strong></div>
              <section className="sd-card">
                <h2>Patient opens with</h2>
                <p className="pr-say">“<InlineMath>{fullCase.opening}</InlineMath>”</p>
              </section>
              <section className="sd-card">
                <h2>Take a history</h2>
                <p className="hb-hint">Tap a prompt to reveal what the patient says.</p>
                <ul className="sd-step-list">
                  {fullCase.script.map((line, i) => {
                    const open = askedScript.includes(i);
                    return (
                      <li key={i} className="pr-solo-item">
                        <button
                          type="button"
                          className="hb-small-btn sd-self-start"
                          aria-expanded={open}
                          onClick={() => setAskedScript((list) => (open ? list : [...list, i]))}
                        >
                          {open ? '✓ ' : ''}Ask: <InlineMath>{line.ask}</InlineMath>
                        </button>
                        {open && <p className="pr-say">“<InlineMath>{line.say}</InlineMath>”</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>
              {fullCase.exam.length > 0 && (
                <section className="sd-card">
                  <h2>Physical exam</h2>
                  <p className="hb-hint">Tap a maneuver to check the finding.</p>
                  <ul className="sd-step-list">
                    {fullCase.exam.map((line, i) => {
                      const open = checkedExam.includes(i);
                      return (
                        <li key={i} className="pr-solo-item">
                          <button
                            type="button"
                            className="hb-small-btn sd-self-start"
                            aria-expanded={open}
                            onClick={() => setCheckedExam((list) => (open ? list : [...list, i]))}
                          >
                            {open ? '✓ ' : ''}Examine: <InlineMath>{line.maneuver}</InlineMath>
                          </button>
                          {open && <p className="pr-door-line"><InlineMath>{line.finding}</InlineMath></p>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <div className="sd-actions">
                <button type="button" className="btn btn-primary" onClick={() => setSoloPhase('score')}>Finish &amp; self-score</button>
                <button type="button" className="hb-text-btn" onClick={() => setSoloPhase('idle')}>Cancel</button>
              </div>
            </>
          )}

          {solo && !live && fullCase && soloPhase === 'score' && (
            <section className="sd-card sd-done">
              <h2>Self-score your encounter ({formatSeconds(soloSeconds)})</h2>
              <p className="pr-door-line"><strong>Diagnosis:</strong> <InlineMath>{fullCase.diagnosis}</InlineMath></p>
              {fullCase.teaching && <MathText>{fullCase.teaching}</MathText>}
              <p className="sd-setup-title">Tick what you asked or performed</p>
              <div className="pr-checklist">
                {fullCase.checklist.map((step, i) => (
                  <label key={step} className="sd-check">
                    <input
                      type="checkbox"
                      checked={ticked.includes(i)}
                      onChange={() => setTicked((list) => (list.includes(i) ? list.filter((n) => n !== i) : [...list, i]))}
                    />
                    <span><InlineMath>{step}</InlineMath></span>
                  </label>
                ))}
              </div>
              <div className="sd-actions">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={saveSoloScore}>{busy ? 'Saving…' : 'Save score'}</button>
                <button type="button" className="hb-text-btn" disabled={busy} onClick={() => setSoloPhase('encounter')}>Back to encounter</button>
              </div>
            </section>
          )}

          {solo && !live && fullCase && soloPhase === 'done' && soloRun && (
            <section className="sd-card sd-done">
              <h2>{soloRun.right} of {soloRun.total} on the checklist</h2>
              {soloRun.seconds > 0 && <p className="hb-hint">In {formatSeconds(soloRun.seconds)}.</p>}
              <p className="pr-door-line"><strong>Diagnosis:</strong> <InlineMath>{fullCase.diagnosis}</InlineMath></p>
              {soloRun.missed.length > 0 && (
                <>
                  <p className="sd-setup-title">What you missed</p>
                  <ul className="pr-missed">{soloRun.missed.map((m) => <li key={m}><InlineMath>{m}</InlineMath></li>)}</ul>
                </>
              )}
              {fullCase.teaching && <MathText>{fullCase.teaching}</MathText>}
              <div className="sd-actions">
                <button type="button" className="btn btn-primary" onClick={startSolo}>Practice again</button>
                <button type="button" className="btn btn-secondary" onClick={() => setSoloPhase('idle')}>Done</button>
              </div>
            </section>
          )}

          {!live && item.runs.length > 0 && (
            <section className="sd-card">
              <h2>How it’s gone</h2>
              <ul className="pr-list pr-runs">
                {[...item.runs].reverse().map((r, i) => (
                  <li key={i}>
                    <strong>{r.right} of {r.total}</strong>
                    <small>{fmtDay(r.on)}{r.seconds ? ` · ${formatSeconds(r.seconds)}` : ''}{r.missed.length ? ` · missed: ${r.missed.join('; ')}` : ''}</small>
                  </li>
                ))}
              </ul>
              {item.diagnosis && <p className="pr-door-line"><strong>Diagnosis:</strong> <InlineMath>{item.diagnosis}</InlineMath></p>}
              {item.teaching && <MathText>{item.teaching}</MathText>}
            </section>
          )}
          {!live && (
            <div className="sd-actions">
              <Link className="btn btn-secondary" href={`/study/practice/patient/${id}/edit`}><Icon name="pencil" /> Edit this case</Link>
              <button type="button" className="hb-text-btn sd-danger-link" onClick={remove}>Delete this case</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
