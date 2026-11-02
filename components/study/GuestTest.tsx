'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { localToday } from '@/lib/habits/dates';
import { finishGuestAttempt, forgetGuestTest, GUEST_KEY, openGuestTest, readGuestData, saveGuestAttempt, startGuestAttempt, type GuestData, type GuestEntry } from '@/lib/study/guest';
import type { SharePreview } from '@/lib/study/sharing';
import { scoreAttempt, type Attempt, type AttemptMode, type StudyTest } from '@/lib/study/study';
import { Icon } from './Icon';
import { clock, pct, Results, Runner, type AttemptPayload, type AttemptSaver } from './TestTaking';
import { scoreTone } from './Ui';

// A shared test for someone without an account: taken and graded the same way, with
// everything kept in this browser. It says so plainly, and how to keep it properly.

/** The browser's storage, or just this page's memory when the browser won't allow it. */
function useGuestStore() {
  const memory = useRef<string | null>(null);
  const [stored, setStored] = useState(true);
  const load = useCallback((): GuestData => {
    try {
      return readGuestData(window.localStorage.getItem(GUEST_KEY) ?? memory.current);
    } catch {
      return readGuestData(memory.current);
    }
  }, []);
  const keep = useCallback((data: GuestData) => {
    memory.current = JSON.stringify(data);
    try {
      window.localStorage.setItem(GUEST_KEY, memory.current);
    } catch {
      setStored(false);
    }
  }, []);
  return { load, keep, stored };
}

export function GuestTest({ shareId, preview, latest }: { shareId: string; preview: SharePreview; latest: StudyTest }) {
  const { confirm, popup } = useSitePopup();
  const { load, keep, stored } = useGuestStore();
  const [entry, setEntry] = useState<GuestEntry | null>(null);
  const [taking, setTaking] = useState<Attempt | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  useEffect(() => {
    const data = load();
    const opened = openGuestTest(data, shareId, latest, new Date().toISOString());
    keep(data);
    setEntry(structuredClone(opened));
  }, [load, keep, shareId, latest]);

  /** Change this test's entry in storage, reading it fresh so another tab's tries aren't lost. */
  const update = useCallback(<R,>(change: (e: GuestEntry) => R, show = true): R => {
    const data = load();
    const e = data.tests[shareId];
    if (!e) throw new Error('This test isn’t in this browser any more.');
    const out = change(e);
    keep(data);
    if (show) setEntry(structuredClone(e));
    return out;
  }, [load, keep, shareId]);

  const saver: AttemptSaver = useMemo(() => ({
    save: async (p: AttemptPayload) => { update((e) => saveGuestAttempt(e, p), false); },
    finish: async (p: AttemptPayload) => { update((e) => finishGuestAttempt(e, p, localToday(), new Date().toISOString())); },
    onPageHide: (p: AttemptPayload) => { try { update((e) => saveGuestAttempt(e, p), false); } catch { /* nothing left to save into */ } },
  }), [update]);

  if (!entry) return null;
  const { test } = entry;
  const start = (mode: AttemptMode, options: { fresh?: boolean; questionIds?: string[] } = {}) => {
    const attempt = update((e) => startGuestAttempt(e, { mode, ...options }, () => crypto.randomUUID().slice(0, 12), Math.floor(Math.random() * 2 ** 31), new Date().toISOString()));
    setViewing(null);
    setTaking(structuredClone(attempt));
    window.scrollTo({ top: 0 });
  };

  if (taking) {
    return (
      <Runner test={test} attempt={taking} saver={saver}
        onLeave={async () => { setTaking(null); setEntry(structuredClone(load().tests[shareId] ?? entry)); }}
        onFinished={async (id) => { setTaking(null); setEntry(structuredClone(load().tests[shareId] ?? entry)); setViewing(id); window.scrollTo({ top: 0 }); }} />
    );
  }

  const attempts = entry.progress.attempts.filter((a) => a.testId === test.id);
  const finished = attempts.filter((a) => a.finishedAt).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const open = attempts.find((a) => !a.finishedAt);
  const shown = viewing ? finished.find((a) => a.id === viewing) : null;
  const before = shown ? finished[finished.indexOf(shown) + 1] : undefined;

  const discard = async () => {
    if (!open) return;
    const ok = await confirm({ title: 'Throw away this try?', message: 'Your answers so far won’t be kept or graded.', confirmLabel: 'Throw away', danger: true });
    if (ok) update((e) => { e.progress.attempts = e.progress.attempts.filter((a) => a.id !== open.id); });
  };
  const forget = async () => {
    const ok = await confirm({ title: 'Clear your answers from this browser?', message: 'Every try at this test here, and its scores, will be gone. The test itself stays at this link.', confirmLabel: 'Clear them', danger: true });
    if (!ok) return;
    const data = load();
    forgetGuestTest(data, shareId);
    const fresh = openGuestTest(data, shareId, latest, new Date().toISOString());
    keep(data);
    setViewing(null);
    setEntry(structuredClone(fresh));
  };

  return (
    <>
      {popup}
      <div className="sd-guest" role="note">
        <Icon name="device" />
        <div>
          <strong>You’re taking this without an account.</strong>
          <p>Your answers and scores are kept in this browser on this device only. Another device won’t have them, clearing your browser’s data deletes them, and anyone using this browser can see them.</p>
          <p>To keep track of everything, with your scores over time and the questions you miss coming back until you know them, you need an account here. Ask {preview.by} for one.</p>
          {!stored && <p className="sd-warning">This browser isn’t letting the page save, so your answers last only until you close it.</p>}
          <button type="button" className="hb-small-btn sd-self-start" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>I have an account: sign in</button>
        </div>
      </div>

      {shown ? (
        <Results test={test} attempt={shown} previous={before} guest onBack={() => setViewing(null)} onRetake={(ids) => start('exam', { fresh: true, questionIds: ids })} />
      ) : (
        <>
          <section className="sd-card">
            {open ? (
              <>
                <h2>You’re part way through</h2>
                <p className="hb-hint">{Object.keys(open.answers).length} of {open.questionIds.length} answered, {clock(open.elapsed)} so far.</p>
                <div className="sd-actions">
                  <button type="button" className="btn btn-primary" onClick={() => start(open.mode)}>Keep going</button>
                  <button type="button" className="btn btn-secondary" onClick={discard}>Throw it away</button>
                </div>
              </>
            ) : (
              <>
                <h2>{finished.length ? 'Take it again' : 'Take this test'}</h2>
                <div className="sd-modes">
                  <button type="button" className="sd-mode" onClick={() => start('exam')}>
                    <span className="sd-tile-icon"><Icon name="tests" /></span>
                    <span><strong>Exam</strong><small>Answer everything, then see your score.</small></span>
                  </button>
                  <button type="button" className="sd-mode" onClick={() => start('tutor')}>
                    <span className="sd-tile-icon"><Icon name="chat" /></span>
                    <span><strong>Tutor</strong><small>See the answer and why after each question.</small></span>
                  </button>
                </div>
              </>
            )}
          </section>

          {finished.length > 0 && (
            <section className="sd-card">
              <h2>Your tries in this browser</h2>
              <ul className="sd-test-list">
                {finished.map((attempt) => {
                  const score = scoreAttempt(attempt, test);
                  return (
                    <li key={attempt.id}>
                      <button type="button" className="sd-test" onClick={() => setViewing(attempt.id)}>
                        <span className="sd-test-main">
                          <strong>{new Date(String(attempt.finishedAt)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                          <small>{score.right} of {score.total} right · {clock(attempt.elapsed)} · {attempt.mode === 'tutor' ? 'Tutor' : 'Exam'}</small>
                        </span>
                        <span className={`sd-score ${scoreTone(pct(score.right, score.total))}`}>{pct(score.right, score.total)}%</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="hb-text-btn sd-danger-link sd-self-start" onClick={forget}>Clear my answers from this browser</button>
            </section>
          )}
        </>
      )}
    </>
  );
}
