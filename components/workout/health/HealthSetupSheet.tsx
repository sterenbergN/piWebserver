'use client';

import './health.css';
import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { useSitePopup } from '@/components/SitePopup';
import { KEY_PLACEHOLDER, SHORTCUT_NAMES, SHORTCUT_SAMPLES, shortcutFieldList, shortcutPrompt } from '@/lib/workout/health-shortcut';
import { timeAgo } from '@/lib/workout/health-insights';
import { describeSync, type PublicHealth } from '@/lib/workout/health';

type Props = {
  health: PublicHealth;
  onChanged: () => void;
  onClose: () => void;
};

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="hc-copy">
      <span className="hc-copy-label">{label}</span>
      <div className="hc-copy-row">
        <code className={secret ? 'is-secret' : ''}>{value}</code>
        <button type="button" className="workout-button is-small" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

/** A ready-made prompt for building one of the shortcuts, with copy and preview. */
function PromptCard({ title, about, prompt }: { title: string; about: string; prompt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="hc-prompt">
      <div className="hc-prompt-head">
        <div>
          <strong>{title}</strong>
          <small>{about}</small>
        </div>
        <button type="button" className="workout-button is-small is-primary" onClick={copy}>{copied ? '✓ Copied' : 'Copy prompt'}</button>
      </div>
      <details className="hc-more">
        <summary>Show prompt</summary>
        <pre className="hc-prompt-text">{prompt}</pre>
      </details>
    </div>
  );
}

function Step({ n, title, children, done = false }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className={`hc-step${done ? ' is-done' : ''}`}>
      <div className="hc-step-head">
        <span className="hc-step-num" aria-hidden>{done ? '✓' : n}</span>
        <h3>{title}</h3>
      </div>
      <div className="hc-step-body">{children}</div>
    </section>
  );
}

/**
 * Connecting Apple Health: make a sync key, build the iOS Shortcut that
 * sends Health data here, and automate it. Also replace / revoke the key and
 * delete everything.
 */
export default function HealthSetupSheet({ health, onChanged, onClose }: Props) {
  const { confirm, popup } = useSitePopup();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listCopied, setListCopied] = useState(false);
  const url = typeof window === 'undefined' ? '/api/workout/health/import' : `${window.location.origin}/api/workout/health/import`;
  const synced = !!health.lastSync;
  const last = health.lastSync;
  const hasProblems = !!last && (!!last.unreadableDates || !!last.mismatched?.length || !!last.ignored?.length);

  const call = async (init: RequestInit) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/workout/health', init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Something went wrong');
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createKey = async () => {
    if (health.connected && !(await confirm({ title: 'New sync key', message: 'The current key stops working. You’ll need to paste the new one into your shortcut.', confirmLabel: 'Make a new key' }))) return;
    const data = await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createKey' }) });
    if (data?.key) { setKey(data.key); onChanged(); }
  };
  const revoke = async () => {
    if (!(await confirm({ title: 'Stop syncing', message: 'Your shortcut will stop being accepted. Data already synced stays.', confirmLabel: 'Stop syncing', danger: true }))) return;
    if (await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revokeKey' }) })) { setKey(null); onChanged(); }
  };
  const wipe = async () => {
    if (!(await confirm({ title: 'Delete health data', message: 'Delete all synced sleep, steps, heart rate and workout heart rate data, and the sync key? Your workouts and bodyweight log are kept.', confirmLabel: 'Delete', danger: true }))) return;
    if (await call({ method: 'DELETE' })) { setKey(null); onChanged(); }
  };
  const copyList = async () => {
    await navigator.clipboard?.writeText(shortcutFieldList()).catch(() => {});
    setListCopied(true);
    setTimeout(() => setListCopied(false), 1800);
  };

  return (
    <Sheet title="Connect Apple Health" subtitle="Your iPhone sends Health data here with a Shortcut" onClose={onClose}>
      <div className="hc-setup">
        <p className="workout-hint" style={{ marginTop: 0 }}>
          Websites can&apos;t read Apple Health directly, so a Shortcut on your iPhone reads it and sends it here. Your Watch,
          your Renpho scale and anything else that writes to Health all come through it. Everything is optional and stays private to your account.
        </p>

        <Step n={1} title="Make your sync key" done={health.connected}>
          {key ? (<>
            <CopyField label="Sync key (shown only now)" value={key} secret />
            <p className="workout-hint">It is now filled into the prompts in step 2. If you lose it, just make a new one.</p>
          </>) : health.connected ? (
            <p className="workout-hint">You have a key ending in <strong>…{health.keyHint}</strong>{health.keyCreatedAt ? `, made ${timeAgo(health.keyCreatedAt)}` : ''}. Keys are only shown once — make a new one if you need it again.</p>
          ) : (
            <p className="workout-hint">The key lets your shortcut send data without logging in. Keep it private, like a password.</p>
          )}
          <CopyField label="Upload address" value={url} />
          <button type="button" className={`workout-button is-block${health.connected ? '' : ' is-primary'}`} disabled={busy} onClick={createKey}>
            {health.connected ? 'Make a new key' : 'Create sync key'}
          </button>
        </Step>

        <Step n={2} title="Make the two shortcuts">
          <p className="workout-hint">
            Copy a prompt into the AI in the Shortcuts app (or any AI assistant) and it builds the shortcut for you. You want both:
            a <strong>daily</strong> one that runs automatically, and a <strong>30-day</strong> one you run once to fill in history.
          </p>
          {!key && (
            <p className="hc-warn">
              The prompts say <code>{KEY_PLACEHOLDER}</code> where your key goes, because keys are only shown once.
              Make a new key in step 1 to have it filled in (then put the new key in any shortcut you already made).
            </p>
          )}
          <PromptCard
            title={SHORTCUT_NAMES.daily}
            about="The last few days of everything, in one upload. Set it to run every morning and evening."
            prompt={shortcutPrompt('daily', { url, key })}
          />
          <PromptCard
            title={SHORTCUT_NAMES.backfill}
            about="Run once. Sends 30 days of steps, sleep, weight, body fat, resting heart rate and HRV, then heart rate and energy one day at a time for two weeks (14 small uploads, so the phone doesn’t run out of memory). Made one before? Delete it and copy this again."
            prompt={shortcutPrompt('backfill', { url, key })}
          />
          <p className="workout-hint">
            When it is built, check that every date field uses <strong>ISO 8601</strong>. If anything is off, the notification after a run says exactly what to fix.
          </p>
          <details className="hc-more">
            <summary>Build it by hand instead</summary>
            <ol className="hc-list" style={{ marginTop: '0.5rem' }}>
              <li>Open <strong>Shortcuts</strong>, tap <strong>+</strong> and name it <em>{SHORTCUT_NAMES.daily}</em>.</li>
              <li>
                For each row below, add <strong>Find Health Samples</strong>: set the type, then <em>Start Date is in the last N days</em>.
                For <strong>Steps</strong> also set <em>Group By: Day</em>. After each one add <strong>Set Variable</strong> with the name shown.
              </li>
            </ol>
            <div className="hc-table" role="table" aria-label="Health samples to find">
              <div className="hc-table-row is-head" role="row"><span role="columnheader">Type</span><span role="columnheader">Last</span><span role="columnheader">Variable</span></div>
              {SHORTCUT_SAMPLES.map((s) => (
                <div key={s.variable} className="hc-table-row" role="row">
                  <span role="cell"><strong>{s.type}</strong><small>{s.why}{s.groupByDay ? ' · Group by Day' : ''}</small></span>
                  <span role="cell">{s.days} days</span>
                  <span role="cell"><code>{s.variable}</code></span>
                </div>
              ))}
            </div>
            <ol className="hc-list" start={3}>
              <li>Add <strong>Get Contents of URL</strong> with the upload address, Method <strong>POST</strong>, Request Body <strong>JSON</strong>.</li>
              <li>Add a Text field <code>key</code> with your sync key, then one Text field per line below: insert the variable, tap it and choose the property. For dates set <em>Date Format</em> to <strong>ISO 8601</strong> with <em>Include Time</em> on.</li>
            </ol>
            <div className="hc-fields">
              {SHORTCUT_SAMPLES.flatMap((s) => s.fields.map((f) => (
                <div key={f.key} className="hc-field">
                  <code>{f.key}</code>
                  <span>{s.variable} › {f.property}{f.property.endsWith('Date') ? ' · ISO 8601' : ''}</span>
                </div>
              )))}
            </div>
            <button type="button" className="workout-button is-small" onClick={copyList}>{listCopied ? '✓ Copied' : 'Copy this list'}</button>
            <ol className="hc-list" start={5}>
              <li>Add <strong>Get Dictionary Value</strong> for <code>message</code> from <em>Contents of URL</em>, then <strong>Show Notification</strong> with it.</li>
            </ol>
            <p className="workout-hint">For the 30-day version, use 30 days for the first six rows. Then send Heart Rate and Active Energy one day at a time: a Repeat 14 times that finds each type between DayStart and DayEnd (Current Date minus Repeat Index days, and one day before that) and uploads them.</p>
          </details>
        </Step>

        <Step n={3} title="Run both once" done={synced}>
          <p className="workout-hint">
            Run the 30-day shortcut, then the daily one. iOS asks to let Shortcuts read each Health type: allow them all. The notification says what arrived.
          </p>
          {last ? (<>
            <p className={hasProblems ? 'hc-warn' : 'hc-ok'}>{hasProblems ? '⚠︎' : '✓'} Last sync {timeAgo(last.at)}: {describeSync(last)}</p>
            <button type="button" className="workout-button is-small" onClick={onChanged}>Refresh</button>
          </>) : (
            <button type="button" className="workout-button is-small" onClick={onChanged}>Check again</button>
          )}
        </Step>

        <Step n={4} title="Make the daily one automatic">
          <ol className="hc-list">
            <li>In Shortcuts go to <strong>Automation</strong> → <strong>+</strong> → <strong>Time of Day</strong>.</li>
            <li>Pick <strong>7:30 AM</strong>, <em>Daily</em>, and choose <strong>Run Immediately</strong> (not “Ask Before Running”).</li>
            <li>Choose <em>{SHORTCUT_NAMES.daily}</em>. Make a second automation for the evening (e.g. <strong>9:00 PM</strong>) so that day&apos;s workouts get their heart rate.</li>
          </ol>
          <p className="workout-hint">The morning run brings in last night&apos;s sleep for today&apos;s readiness. Run the 30-day one again any time you want to fill gaps.</p>
        </Step>

        {error && <p className="workout-error">{error}</p>}

        {(health.connected || synced) && (
          <div className="hc-danger">
            {health.connected && <button type="button" className="workout-button is-small" disabled={busy} onClick={revoke}>Stop syncing</button>}
            <button type="button" className="workout-text-btn danger" disabled={busy} onClick={wipe}>Delete all health data</button>
          </div>
        )}
      </div>
      {popup}
    </Sheet>
  );
}
