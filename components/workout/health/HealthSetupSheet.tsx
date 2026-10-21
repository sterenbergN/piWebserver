'use client';

import './health.css';
import { useState } from 'react';
import Sheet from '@/components/workout/Sheet';
import { useSitePopup } from '@/components/SitePopup';
import { SHORTCUT_SAMPLES, shortcutFieldList } from '@/lib/workout/health-shortcut';
import { timeAgo } from '@/lib/workout/health-insights';
import type { PublicHealth } from '@/lib/workout/health';

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
            <p className="workout-hint">Copy it into the shortcut in step 2. If you lose it, just make a new one.</p>
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

        <Step n={2} title="Build the shortcut">
          <ol className="hc-list">
            <li>Open <strong>Shortcuts</strong>, tap <strong>+</strong> and name it <em>Sync Health</em>.</li>
            <li>
              For each row below, add <strong>Find Health Samples</strong>: set the type, then <em>Start Date is in the last …</em>.
              For <strong>Steps</strong> also turn on <em>Group By: Day</em>. After each one add <strong>Set Variable</strong> with the name shown, so they’re easy to pick out below.
            </li>
          </ol>
          <div className="hc-table" role="table" aria-label="Health samples to find">
            <div className="hc-table-row is-head" role="row"><span role="columnheader">Type</span><span role="columnheader">Last</span><span role="columnheader">Variable</span></div>
            {SHORTCUT_SAMPLES.map((s) => (
              <div key={s.variable} className="hc-table-row" role="row">
                <span role="cell"><strong>{s.type}</strong><small>{s.why}{s.groupByDay ? ' · Group by Day' : ''}</small></span>
                <span role="cell">{s.range}</span>
                <span role="cell"><code>{s.variable}</code></span>
              </div>
            ))}
          </div>
          <ol className="hc-list" start={3}>
            <li>
              Add <strong>Get Contents of URL</strong> and paste the upload address. Tap <em>Show More</em>:
              <ul>
                <li>Method: <strong>POST</strong></li>
                <li>Headers: add <code>Authorization</code> with the value <code>Bearer </code> followed by your key (one space after <em>Bearer</em>)</li>
                <li>Request Body: <strong>JSON</strong>, then add one <strong>Text</strong> field per line below</li>
              </ul>
            </li>
            <li>
              In each field, insert the variable, tap it and choose the property (<em>Value</em>, <em>Start Date</em>…).
              For dates also set <em>Date Format</em> to <strong>ISO 8601</strong> and turn on <em>Include Time</em>.
            </li>
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
            <li>Last, add <strong>Get Dictionary Value</strong> for <code>message</code> from <em>Contents of URL</em>, then <strong>Show Notification</strong> with it — you&apos;ll see what was synced.</li>
          </ol>
          <details className="hc-more">
            <summary>Optional: Watch workouts</summary>
            <p className="workout-hint">
              Heart rate and calories are matched to your logged workouts by time, so this isn&apos;t needed. If your Shortcuts can find
              <em> Workouts</em> samples, you can also send <code>workoutsStarts</code>, <code>workoutsEnds</code>, <code>workoutsNames</code> and
              <code> workoutsCalories</code>; a Watch session then sets the exact start and end, and its calorie total is used.
            </p>
          </details>
        </Step>

        <Step n={3} title="Run it once" done={synced}>
          <p className="workout-hint">
            Tap ▶︎ in the shortcut. iOS asks to let Shortcuts read each Health type: allow them all. The notification says what arrived, and it shows up here.
          </p>
          {health.lastSync ? (
            <p className="hc-ok">✓ Last sync {timeAgo(health.lastSync.at)}</p>
          ) : (
            <button type="button" className="workout-button is-small" onClick={onChanged}>Check again</button>
          )}
        </Step>

        <Step n={4} title="Make it automatic">
          <ol className="hc-list">
            <li>In Shortcuts go to <strong>Automation</strong> → <strong>+</strong> → <strong>Time of Day</strong>.</li>
            <li>Pick <strong>7:30 AM</strong>, <em>Daily</em>, and choose <strong>Run Immediately</strong> (not “Ask Before Running”).</li>
            <li>Choose the <em>Sync Health</em> shortcut. Make a second automation for the evening (e.g. <strong>9:00 PM</strong>) so that day&apos;s workouts get their heart rate.</li>
          </ol>
          <p className="workout-hint">The morning run brings in last night&apos;s sleep for today&apos;s readiness. You can also run it any time from the Shortcuts widget, e.g. right after the gym.</p>
          <details className="hc-more">
            <summary>Bring in past data</summary>
            <p className="workout-hint">
              Duplicate the shortcut, change the ranges for steps, sleep, weight, body fat, resting heart rate and HRV to <em>1 year</em> and run it once.
              Heart rate and active energy only matter for the last two weeks, so leave those at 2 days.
            </p>
          </details>
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
