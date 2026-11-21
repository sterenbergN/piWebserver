'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import type { FoodAdminPublic, SourceStatus } from '@/lib/food/settings';

// Admin → Food: the food tracker's sources. FatSecret needs a client id and
// secret from platform.fatsecret.com, and only answers from IP addresses listed
// on the key, so this page can find the server's public address to add there.
// The secret is sent here once and never comes back (only its last four
// characters). USDA foods are bundled and the library is built from use, so
// the tracker works with every remote source off.

type View = {
  settings: FoodAdminPublic;
  library: { total: number; bySource: Record<string, number> };
  usda: { count: number; builtAt: string; source: string } | null;
};
type Notice = { kind: 'success' | 'error' | 'info'; text: string };

const LIBRARY_LABELS: Record<string, string> = { custom: 'from labels', fatsecret: 'FatSecret', off: 'Open Food Facts', usda: 'USDA' };

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : '';
}

function StatusLine({ label, status }: { label: string; status?: SourceStatus }) {
  if (!status?.lastOkAt && !status?.lastErrorAt) return <li>{label}: not used yet.</li>;
  const failedLast = !!status.lastErrorAt && (!status.lastOkAt || status.lastErrorAt > status.lastOkAt);
  return (
    <li>
      {label}: {status.lastOkAt ? `worked ${when(status.lastOkAt)}` : 'never worked yet'}
      {failedLast && <> · <span style={{ color: 'var(--danger)' }}>failed {when(status.lastErrorAt)}: {status.lastError}</span></>}
    </li>
  );
}

export default function FoodPanel() {
  const { confirm, popup } = useSitePopup();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ip, setIp] = useState('');

  const adopt = (v: View) => {
    setView(v);
    setClientId(v.settings.fatsecret.clientId);
    setSecret('');
  };

  useEffect(() => {
    fetch('/api/admin/food', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(adopt)
      .catch(() => setLoadError(true));
  }, []);

  if (!view) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>🍽️ Food</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load the food settings.</div> : <p className="adm-muted">Loading…</p>}
      </section>
    );
  }

  const s = view.settings;
  const call = async (method: 'PUT' | 'POST', body: Record<string, unknown>) => {
    const r = await fetch('/api/admin/food', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || 'That didn’t work.');
    return json;
  };

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy('save');
    setNotice(null);
    try {
      adopt(await call('PUT', body));
      setNotice({ kind: 'success', text: done });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t save.' });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setNotice(null);
    try {
      const res = await call('POST', { action: 'test', clientId: clientId.trim(), clientSecret: secret.trim() });
      setNotice(res.ok ? { kind: 'success', text: res.message } : { kind: 'error', text: res.error });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t test.' });
    } finally {
      setBusy('');
    }
  };

  const findIp = async () => {
    setBusy('ip');
    try {
      const res = await call('POST', { action: 'ip' });
      setIp(res.ok ? res.ip : '');
      if (!res.ok) setNotice({ kind: 'error', text: res.error });
    } catch {
      setNotice({ kind: 'error', text: 'Couldn’t find the address.' });
    } finally {
      setBusy('');
    }
  };

  const dirty = clientId.trim() !== s.fatsecret.clientId || !!secret.trim();
  const toggle = (key: 'usda' | 'fatsecret' | 'off', on: boolean) => void save({ sources: { [key]: on } }, 'Saved.');

  return (
    <section className="adm-card" aria-labelledby="food-title">
      {popup}
      <div className="adm-card-head"><h2 id="food-title">🍽️ Food</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Where the food tracker (Workout → Food) finds foods. Search always starts with the site’s own library (every food anyone has logged
        or typed in from a label) and the bundled USDA foods, so it keeps working with no internet. FatSecret is asked next when it’s set up;
        Open Food Facts covers barcodes and “Search more”, free and without a key.
      </p>

      <div role="status" className={`adm-notice ${s.fatsecret.configured && s.sources.fatsecret ? 'is-success' : 'is-info'}`}>
        {!s.sources.fatsecret ? 'FatSecret is switched off.'
          : s.fatsecret.configured ? `FatSecret key saved (client ${s.fatsecret.clientId}, secret ${s.fatsecret.secretHint}).`
            : 'FatSecret isn’t set up: search uses the library, USDA and Open Food Facts.'}
      </div>

      <h3 className="adm-h3">FatSecret</h3>
      <p className="adm-muted">
        From your key’s page on platform.fatsecret.com (OAuth 2.0 client id and secret). FatSecret only answers from the IP addresses listed
        on the key, so add this server’s public address there, and again if your home internet’s address changes.
      </p>
      <div className="adm-form">
        <label className="adm-field">
          Client id
          <input value={clientId} maxLength={200} spellCheck={false} autoCapitalize="off" autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
        </label>
        <label className="adm-field">
          Client secret {s.fatsecret.hasSecret && <span>(saved, ends {s.fatsecret.secretHint.replace('…', '')})</span>}
          <input type="password" value={secret} maxLength={200} autoComplete="new-password" placeholder={s.fatsecret.hasSecret ? 'Leave blank to keep the saved one' : ''} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <div className="adm-field is-wide">
          <span>
            {ip ? <>This server’s public address: <strong style={{ color: 'var(--foreground)' }}>{ip}</strong>. Add it to the key’s allowed IP list.</> : 'Not sure which address to allow?'}{' '}
            <button type="button" className="adm-link-btn" disabled={!!busy} onClick={() => void findIp()}>{busy === 'ip' ? 'Checking…' : ip ? 'Check again' : 'Find this server’s address'}</button>
          </span>
        </div>
      </div>
      <div className="adm-actions" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy || !dirty} onClick={() => void save({ fatsecret: { clientId: clientId.trim(), clientSecret: secret.trim() } }, 'FatSecret key saved.')}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary" disabled={!!busy || !(clientId.trim() && (secret.trim() || s.fatsecret.hasSecret))} onClick={() => void test()}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        {s.fatsecret.configured && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={async () => {
            if (await confirm({ title: 'Remove the FatSecret key?', message: 'Search carries on with the library, USDA and Open Food Facts. Foods already in the library stay.', confirmLabel: 'Remove', danger: true })) {
              void save({ clearFatSecret: true }, 'FatSecret key removed.');
            }
          }}>Remove key</button>
        )}
      </div>
      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>How the sources have been doing</h3>
      <ul className="adm-muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
        <StatusLine label="FatSecret" status={s.status.fatsecret} />
        <StatusLine label="Open Food Facts" status={s.status.off} />
      </ul>

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Sources</h3>
      <label className="adm-check"><input type="checkbox" className="switch" checked={s.sources.fatsecret} disabled={!!busy} onChange={(e) => toggle('fatsecret', e.target.checked)} /> FatSecret</label>
      <label className="adm-check"><input type="checkbox" className="switch" checked={s.sources.off} disabled={!!busy} onChange={(e) => toggle('off', e.target.checked)} /> Open Food Facts (barcodes and “Search more”)</label>
      <label className="adm-check"><input type="checkbox" className="switch" checked={s.sources.usda} disabled={!!busy} onChange={(e) => toggle('usda', e.target.checked)} /> USDA generic foods (bundled{view.usda ? `, ${view.usda.count.toLocaleString()} foods` : ', missing from this build'})</label>
      <label className="adm-check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" className="switch" checked={s.keepFatSecretCopies} disabled={!!busy} onChange={(e) => void save({ keepFatSecretCopies: e.target.checked }, 'Saved.')} />
        <span>
          Keep FatSecret foods in the library for good
          <span className="adm-muted" style={{ display: 'block', fontSize: '0.85rem' }}>
            Off by default: FatSecret’s terms only let you keep its food ids, and other data for 24 hours, so copies are dropped after a day.
            Your diary entries always keep what you ate either way. Turn this on only if your FatSecret agreement allows it.
          </span>
        </span>
      </label>

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Library</h3>
      <p className="adm-muted">
        {view.library.total.toLocaleString()} food{view.library.total === 1 ? '' : 's'}
        {view.library.total > 0 && ` (${Object.entries(view.library.bySource).map(([k, n]) => `${n.toLocaleString()} ${LIBRARY_LABELS[k] ?? k}`).join(', ')})`}.
        {' '}Kept on this server in .data/food and in backups.
      </p>
      <div className="adm-actions">
        <a className="btn btn-secondary" href="/api/admin/food?download=1" download>Download library (JSON)</a>
      </div>
    </section>
  );
}
