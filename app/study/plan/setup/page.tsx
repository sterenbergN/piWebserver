'use client';

import Link from 'next/link';
import { Icon, KIND_GLYPH, Pancakes } from '@/components/study/Icon';
import { Loading } from '@/components/study/Ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { usePlan } from '@/components/study/usePlan';
import { buildSyllabusPrompt } from '@/lib/study/prompt';
import { KIND_ICON, parseSyllabusReply, PlanInputError, recentPace, type SyllabusPack } from '@/lib/study/plan';

// Where the plan gets its dates and limits: her week, her Google Calendar, and
// syllabuses read through her AI.

type Planner = ReturnType<typeof usePlan>;
const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']] as const;
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

function YourWeek({ planner }: { planner: Planner }) {
  const { data, post, today } = planner;
  const settings = data!.plan.settings;
  const [error, setError] = useState('');
  const save = (payload: Record<string, unknown>) => post('settings', payload).catch((e) => setError(e.message));
  const toggle = (day: number) => save({ studyDays: settings.studyDays.includes(day) ? settings.studyDays.filter((d) => d !== day) : [...settings.studyDays, day] });
  const pace = recentPace(data!.plan, today);
  return (
    <section className="sd-card">
      <h2>Your week</h2>
      <div>
        <p className="sd-setup-title">Days you study</p>
        <div className="sd-systems" role="group" aria-label="Days you study">
          {WEEK.map(([day, name]) => <button key={day} type="button" aria-pressed={settings.studyDays.includes(day)} onClick={() => toggle(day)}>{name}</button>)}
        </div>
      </div>
      <div>
        <p className="sd-setup-title">Pancakes you can manage in a day, roughly</p>
        <div className="sd-actions">
          <button type="button" className="hb-small-btn" aria-label="One fewer" disabled={settings.perDay <= 1} onClick={() => save({ perDay: settings.perDay - 1 })}>−</button>
          <strong className="sd-perday"><Pancakes count={settings.perDay} /></strong>
          <button type="button" className="hb-small-btn" aria-label="One more" disabled={settings.perDay >= 40} onClick={() => save({ perDay: settings.perDay + 1 })}>+</button>
          {pace !== null && Math.round(pace) !== settings.perDay && Math.round(pace) >= 1 && (
            <button type="button" className="hb-text-btn" onClick={() => save({ perDay: Math.round(pace) })}>Lately you’re eating about {Math.round(pace)} a day. Use that</button>
          )}
        </div>
      </div>
      <p className="hb-hint">This doesn’t limit what goes on your plate. It’s what the plan warns you about when a date won’t fit. Pancakes on a day you turn off move to the days you study.</p>
      {error && <p className="sd-warning" role="alert">{error}</p>}
    </section>
  );
}

function GoogleCalendar({ planner }: { planner: Planner }) {
  const { data, post } = planner;
  const calendar = data!.plan.calendar;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const done = await work();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post('calendar-connect', { url: url.trim(), timeZone: zone() });
      setUrl('');
      return 'Connected. Anything that looks like an exam or due date is waiting on your plan.';
    });
  };
  const upload = (picked: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!picked) return;
    run(async () => {
      await post('calendar-file', { text: await picked.text(), timeZone: zone() });
      return 'Read. Anything that looks like an exam or due date is waiting on your plan.';
    });
  };
  const when = calendar.lastFetchedAt ? new Date(calendar.lastFetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <section className="sd-card">
      <h2>Google Calendar</h2>
      {calendar.connected ? (
        <>
          <p className="hb-hint">Connected{when ? `, last read ${when}` : ''}. The site reads your calendar and never changes it. A moved exam moves its countdown and its upcoming pancakes.</p>
          {calendar.lastError && <p className="sd-warning" role="alert"><Icon name="alert" /><span>{calendar.lastError}</span></p>}
          <div className="sd-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(async () => { await post('calendar-refresh'); })}>{busy ? 'Reading…' : 'Read it now'}</button>
            <Link className="sd-more" href="/study/plan">See what’s waiting →</Link>
            <button type="button" className="hb-text-btn sd-danger-link" disabled={busy} onClick={() => run(async () => { await post('calendar-disconnect'); return 'Disconnected, and the address is deleted from this site. Dates you already added stay.'; })}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="hb-hint">Your dates come in once, then stay up to date by themselves. There’s no Google sign-in, and the site can only read your calendar, never change it.</p>
          <ol className="sd-howto">
            <li>On a computer, open <strong>Google Calendar</strong> and go to <strong>Settings</strong>.</li>
            <li>Under <strong>Settings for my calendars</strong>, click the calendar with your school dates.</li>
            <li>Scroll to <strong>Integrate calendar</strong> and copy <strong>Secret address in iCal format</strong>.</li>
          </ol>
          <form className="sd-fields" onSubmit={connect}>
            <label className="sd-wide">Secret address
              <input type="password" autoComplete="off" value={url} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" onChange={(e) => setUrl(e.target.value)} />
            </label>
            <div className="sd-wide"><button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>{busy ? 'Connecting…' : 'Connect'}</button></div>
          </form>
          <p className="hb-hint">Treat that address like a password, since anyone who has it can read that calendar. It’s kept only in your account, won’t be shown again, and stays out of “Download my data”.</p>
          <details className="sd-more-info">
            <summary>Don’t see the secret address?</summary>
            <p className="hb-hint">Some school accounts turn it off. You can export your calendar from Google Calendar’s Settings, under Import &amp; export, unzip it, and choose the .ics file here. A file won’t update by itself, so upload a new one after changes.</p>
            <input ref={file} className="sd-file" type="file" accept=".ics,text/calendar" aria-label="Your calendar file" onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => file.current?.click()}>Choose a calendar file</button>
          </details>
        </>
      )}
      {notice && <p className="sd-outcome"><Icon name="check" /> {notice}</p>}
      {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
    </section>
  );
}

function readPack(text: string, today: string): { pack?: SyllabusPack; error?: string } {
  if (!text.trim()) return {};
  try {
    return { pack: parseSyllabusReply(text, today) };
  } catch (error) {
    return { error: error instanceof PlanInputError ? error.message : 'That couldn’t be read.' };
  }
}

function Syllabus({ planner }: { planner: Planner }) {
  const { post, today } = planner;
  const [course, setCourse] = useState('');
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const prompt = useMemo(() => buildSyllabusPrompt({ course, today }), [course, today]);
  const { pack, error: readError } = useMemo(() => readPack(reply, today), [reply, today]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      box.current?.focus();
      box.current?.select();
      setCopied('failed');
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await post('syllabus', { text: reply });
      setNotice(`Added ${body.added?.dates ?? 0} date${body.added?.dates === 1 ? '' : 's'} and ${body.added?.work ?? 0} piece${body.added?.work === 1 ? '' : 's'} of work.`);
      setReply('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save.');
    } finally {
      setBusy(false);
    }
  };
  const fmt = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <section className="sd-card" id="syllabus">
      <h2>From a syllabus</h2>
      <p className="hb-hint">Copy this into your AI along with a syllabus or schedule, then paste back what it writes. Check the dates before saving, since an AI can misread them.</p>
      <div className="sd-fields">
        <label className="sd-wide">Class or module (optional)
          <input value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => { setCourse(e.target.value); setCopied('idle'); }} />
        </label>
      </div>
      <div className="sd-actions">
        <button type="button" className="btn btn-secondary" onClick={copy}><Icon name={copied === 'copied' ? 'check' : 'copy'} /> {copied === 'copied' ? 'Copied' : 'Copy prompt'}</button>
        {copied === 'failed' && <span className="hb-hint">Couldn’t reach the clipboard. It’s selected below, so copy it from there.</span>}
      </div>
      <details className="sd-more-info" open={copied === 'failed' || undefined}>
        <summary>Read the prompt</summary>
        <textarea ref={box} className="sd-prompt" readOnly rows={6} value={prompt} aria-label="The prompt to copy" />
      </details>
      <textarea className="sd-reply" rows={6} value={reply} placeholder="Paste the whole reply here" aria-label="The AI’s reply" onChange={(e) => { setReply(e.target.value); setNotice(''); }} />
      {readError && <div className="hb-banner is-error" role="alert"><span>{readError}</span></div>}
      {pack && (
        <div className="sd-preview">
          <p className="sd-found"><strong>{pack.deadlines.length} date{pack.deadlines.length === 1 ? '' : 's'}</strong> and {pack.tasks.length} piece{pack.tasks.length === 1 ? '' : 's'} of work:</p>
          <ul className="sd-setup-list">
            {pack.deadlines.map((d) => (
              <li key={`${d.title}${d.dueOn}`}>
                {KIND_ICON[d.kind]} <strong>{fmt(d.dueOn)}</strong> {d.title}
                {pack.tasks.some((t) => t.forDeadline.toLowerCase() === d.title.toLowerCase()) && ` (${pack.tasks.filter((t) => t.forDeadline.toLowerCase() === d.title.toLowerCase()).reduce((n, t) => n + t.pancakes, 0)} pancakes)`}
              </li>
            ))}
          </ul>
          {pack.problems.length > 0 && (
            <details className="sd-problems" open={pack.problems.length <= 3}>
              <summary>{pack.problems.length} couldn’t be used</summary>
              <ul>{pack.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add to my plan'}</button>
        </div>
      )}
      {notice && <p className="sd-outcome"><Icon name="check" /> {notice} <Link className="sd-more" href="/study/plan">See your plan <Icon name="right" /></Link></p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}
    </section>
  );
}

export default function PlanSetupPage() {
  const planner = usePlan();
  useEffect(() => {
    if (planner.status === 'ready' && window.location.hash === '#syllabus') document.getElementById('syllabus')?.scrollIntoView();
  }, [planner.status]);

  if (planner.status === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to set up your plan">Your plan is only shown to your account.</SignInPrompt></div>;
  return (
    <div className="sd sd-narrow animate-fade-in">
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/plan">← Plan</Link>
          <h1>Your week &amp; calendar</h1>
        </div>
      </header>
      {planner.status === 'loading' && <Loading rows={2} />}
      {planner.status === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your plan.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
      {planner.data && (
        <>
          <YourWeek planner={planner} />
          <GoogleCalendar planner={planner} />
          <Syllabus planner={planner} />
        </>
      )}
    </div>
  );
}
