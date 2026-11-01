'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { InlineMath } from '@/components/study/InlineMath';
import { localToday } from '@/lib/habits/dates';
import type { PartnerCaseView, PartnerQuizView } from '@/lib/study/partner';
import { formatSeconds } from '@/lib/study/practice';
import { choiceLetter } from '@/lib/study/study';

// What whoever's helping sees, on their own phone, with no account. They may know
// nothing about medicine, so everything here says exactly what to do.

type View = PartnerQuizView | PartnerCaseView;

async function send(token: string, action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`/api/study/partner/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, today: localToday(), ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t go through. Try again.');
  return body as { view?: View };
}

function Quiz({ view, act, busy }: { view: PartnerQuizView; act: (action: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  if (view.finished) {
    return (
      <section className="sd-card sd-done">
        <h2>All done: {view.right} right, {view.wrong} wrong</h2>
        <p className="hb-hint">Thanks for quizzing. The results are saved, so you can close this.</p>
      </section>
    );
  }
  const { question } = view;
  return (
    <>
      <p className="sd-count">Question {view.index + 1} of {view.total} · {view.right} right, {view.wrong} wrong</p>
      {question ? (
        <section className="sd-card">
          {question.topic && question.topic !== 'General' && <p className="sd-setup-title">{question.topic}</p>}
          <div className="sd-stem"><MathText>{question.stem}</MathText></div>
          <ol className="pr-answers">
            {question.choices.map((choice, i) => {
              const right = question.correct.includes(i);
              return (
                <li key={i} className={right ? 'is-right' : ''}>
                  <span aria-hidden>{right ? '✓' : choiceLetter(i)}</span>
                  <span>{right && <span className="sr-only">Correct: </span>}<InlineMath>{choice}</InlineMath></span>
                </li>
              );
            })}
          </ol>
          <p className="hb-hint">Read the question out, with the choices if they’d like them. The answer has the check mark.</p>
          {question.explanation && (
            <details className="pr-why">
              <summary>Why that’s the answer</summary>
              <MathText>{question.explanation}</MathText>
            </details>
          )}
        </section>
      ) : (
        <section className="sd-card"><p className="hb-hint">This question has since been deleted, so skip it.</p></section>
      )}
      <div className="pr-marks">
        {question ? (
          <>
            <button type="button" className="btn pr-wrong" disabled={busy} onClick={() => act('mark', { index: view.index, right: false })}>✕ Wrong</button>
            <button type="button" className="btn pr-right" disabled={busy} onClick={() => act('mark', { index: view.index, right: true })}>✓ Right</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('mark', { index: view.index, right: null })}>Skip it</button>
        )}
      </div>
    </>
  );
}

function Patient({ view, token, act, busy }: { view: PartnerCaseView; token: string; act: (action: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  const liveTicked = view.finished ? null : view.ticked;
  const startedAt = view.finished ? null : view.startedAt;
  const [ticked, setTicked] = useState<number[]>(liveTicked ?? []);
  const [seconds, setSeconds] = useState(0);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setSeconds(Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (view.finished) {
    return (
      <section className="sd-card sd-done">
        <h2>{view.run.right} of {view.run.total} on the checklist</h2>
        <p className="pr-door-line"><strong>Diagnosis:</strong> <InlineMath>{view.diagnosis}</InlineMath></p>
        {view.run.missed.length > 0 && (
          <>
            <p className="sd-setup-title">What was missed</p>
            <ul className="pr-missed">{view.run.missed.map((m) => <li key={m}><InlineMath>{m}</InlineMath></li>)}</ul>
          </>
        )}
        {view.teaching && <MathText>{view.teaching}</MathText>}
        <p className="hb-hint">It’s saved on their side too, so you can close this.</p>
      </section>
    );
  }

  const toggle = (i: number) => {
    const next = ticked.includes(i) ? ticked.filter((n) => n !== i) : [...ticked, i];
    setTicked(next);
    send(token, 'tick', { ticked: next }).then(() => setSaveError(false)).catch(() => setSaveError(true));
  };

  if (!view.startedAt) {
    return (
      <>
        <section className="sd-card">
          <h2>You’re playing the patient</h2>
          <p className="hb-hint">{view.title}. They’ve been told that much. Stay in character, and only say something if they ask about it. You’ll tick off a checklist as they go.</p>
          <p className="hb-hint">Have a look through, and start the clock when they walk in.</p>
          <button type="button" className="btn btn-primary sd-self-start" disabled={busy} onClick={() => act('start-clock')}>Start the clock</button>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="pr-timer"><span>{view.title}</span><strong>{formatSeconds(seconds)}</strong></div>
      <section className="sd-card">
        <h2>Say this first</h2>
        <p className="pr-say">“<InlineMath>{view.opening}</InlineMath>”</p>
      </section>
      <section className="sd-card">
        <h2>Only if they ask</h2>
        <dl className="pr-script">
          {view.script.map((line) => (
            <div key={line.ask}>
              <dt><InlineMath>{line.ask}</InlineMath></dt>
              <dd>“<InlineMath>{line.say}</InlineMath>”</dd>
            </div>
          ))}
        </dl>
        <p className="hb-hint">Asked about something that isn’t here? Say it’s normal, or that you don’t know.</p>
      </section>
      {view.exam.length > 0 && (
        <section className="sd-card">
          <h2>If they examine you</h2>
          <p className="hb-hint">Read out what they’d find.</p>
          <dl className="pr-script">
            {view.exam.map((line) => (
              <div key={line.maneuver}>
                <dt><InlineMath>{line.maneuver}</InlineMath></dt>
                <dd><InlineMath>{line.finding}</InlineMath></dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="sd-card">
        <h2>Tick these as they do them</h2>
        <div className="pr-checklist">
          {view.checklist.map((item, i) => (
            <label key={item} className="sd-check">
              <input type="checkbox" checked={ticked.includes(i)} onChange={() => toggle(i)} />
              <span><InlineMath>{item}</InlineMath></span>
            </label>
          ))}
        </div>
        {saveError && <p className="sd-warning">Couldn’t save that tick, so it’ll go with the score at the end.</p>}
      </section>
      <details className="sd-card pr-peek">
        <summary>The answer (don’t say it)</summary>
        <InlineMath>{view.diagnosis}</InlineMath>
      </details>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('finish', { ticked })}>Finish and score it</button>
    </>
  );
}

export default function PartnerPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/study/partner/${token}`, { cache: 'no-store' }).then(async (res) => {
      if (cancelled) return;
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !body.success) setEnded(true);
      else setView(body.view);
    }).catch(() => { if (!cancelled) setError('Couldn’t load this. Check your connection and refresh.'); });
    return () => { cancelled = true; };
  }, [token]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    setError('');
    try {
      const body = await send(token, action, payload);
      if (body.view) setView(body.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through. Try again.');
    }
    setBusy(false);
  }, [token]);

  return (
    <div className="sd sd-narrow animate-fade-in pr-partner">
      <header className="sd-head">
        <div>
          <h1>{view?.kind === 'patient' ? 'Mock patient' : 'Quiz me'}</h1>
        </div>
      </header>
      {ended && (
        <section className="sd-card sd-done">
          <h2>This link has ended</h2>
          <p className="hb-hint">Links stop working when the sitting is ended, or after a day. Ask for a new one.</p>
        </section>
      )}
      {!view && !ended && !error && <p className="hb-hint">Loading…</p>}
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
      {view?.kind === 'quiz' && <Quiz view={view} act={act} busy={busy} />}
      {view?.kind === 'patient' && <Patient view={view} token={token} act={act} busy={busy} />}
    </div>
  );
}
