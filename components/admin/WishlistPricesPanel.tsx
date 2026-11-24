'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';

// Admin → Wishlist prices: where Amazon prices come from. Amazon blocks ordinary page
// reads, so the daily price check asks a price service instead. The key is sent here once
// and never comes back (only its last four characters).

type Summary = { checked: number; updated: number; failed: number; skipped: number };
type View = {
  service: { baseUrl: string; hasKey: boolean; keyHint: string; configured: boolean };
  last: { lastRunAt: string; lastSummary: Summary | null };
  running: boolean;
};
type Notice = { kind: 'success' | 'error' | 'info'; text: string };

export default function WishlistPricesPanel() {
  const { confirm, popup } = useSitePopup();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testInput, setTestInput] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [testNotice, setTestNotice] = useState<Notice | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const adopt = useCallback((v: View, fillForm: boolean) => {
    setView(v);
    if (fillForm) {
      setBaseUrl(v.service.baseUrl);
      setApiKey('');
    }
  }, []);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/admin/wishlist-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || 'That didn’t work.');
    return json;
  };

  useEffect(() => {
    fetch('/api/admin/wishlist-prices', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((v: View) => adopt(v, true))
      .catch(() => setLoadError(true));
  }, [adopt]);

  // While a run is going, look again every few seconds until it finishes.
  const running = view?.running ?? false;
  useEffect(() => {
    if (!running) return;
    poll.current = setInterval(() => {
      fetch('/api/admin/wishlist-prices', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((v: View) => adopt(v, false))
        .catch(() => {});
    }, 3000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [running, adopt]);

  if (!view) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>🛒 Wishlist prices</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load the wishlist price settings.</div> : <p className="adm-muted">Loading…</p>}
      </section>
    );
  }

  const s = view.service;
  const dirty = baseUrl.trim() !== s.baseUrl || !!apiKey.trim();

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy('save');
    setNotice(null);
    try {
      adopt(await post({ action: 'save', ...body }), true);
      setNotice({ kind: 'success', text: done });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t save.' });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setTestNotice(null);
    try {
      const res = await post({ action: 'test', input: testInput, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
      setTestNotice(res.ok
        ? { kind: 'success', text: `${res.asin}: ${res.currency} ${Number(res.price).toFixed(2)}` }
        : { kind: 'error', text: res.error });
    } catch (e) {
      setTestNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t test.' });
    } finally {
      setBusy('');
    }
  };

  const runNow = async () => {
    setBusy('run');
    setNotice(null);
    try {
      adopt(await post({ action: 'run' }), false);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t start the check.' });
    } finally {
      setBusy('');
    }
  };

  const last = view.last;
  const sum = last.lastSummary;

  return (
    <section className="adm-card" aria-labelledby="wishlist-prices-title">
      {popup}
      <div className="adm-card-head"><h2 id="wishlist-prices-title">🛒 Wishlist prices</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Once a day the site re-reads the price of each wishlist item that has a link. Amazon blocks ordinary page reads, so Amazon prices come from a
        price service: the free amazon-scraper program running on the Pi at http://127.0.0.1:8000, or its RapidAPI copy (use its address and put the key below).
        Other shops are read directly and need nothing here.
      </p>

      <div role="status" className={`adm-notice ${s.configured ? 'is-success' : 'is-info'}`}>
        {s.configured ? `Amazon price service: ${s.baseUrl}${s.hasKey ? `, key saved (ends in ${s.keyHint})` : ', no key'}.` : 'No Amazon price service yet: Amazon items keep their typed price.'}
      </div>

      <div className="adm-form">
        <label className="adm-field">
          Price service address
          <input value={baseUrl} maxLength={300} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="http://127.0.0.1:8000" onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="adm-field">
          Key (optional) {s.hasKey && <span>(saved, ends in {s.keyHint})</span>}
          <input type="password" value={apiKey} maxLength={200} autoComplete="new-password" placeholder={s.hasKey ? 'Leave blank to keep the saved one' : ''} onChange={(e) => setApiKey(e.target.value)} />
        </label>
      </div>
      <div className="adm-actions" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy || !dirty} onClick={() => void save({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }, 'Saved.')}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {s.hasKey && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={async () => {
            if (await confirm({ title: 'Remove the saved key?', message: 'The price service is then asked without a key.', confirmLabel: 'Remove', danger: true })) {
              void save({ clearKey: true }, 'Key removed.');
            }
          }}>Remove key</button>
        )}
      </div>
      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Test</h3>
      <div className="adm-form">
        <label className="adm-field is-wide">
          An Amazon link or product number (ASIN)
          <input value={testInput} maxLength={1000} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="https://www.amazon.com/dp/B08N5WRWNW" onChange={(e) => setTestInput(e.target.value)} />
        </label>
      </div>
      <div className="adm-actions" style={{ marginTop: '0.75rem' }}>
        <button className="btn btn-secondary" disabled={!!busy || !testInput.trim() || !(baseUrl.trim() || s.baseUrl)} onClick={() => void test()}>
          {busy === 'test' ? 'Testing…' : 'Test price lookup'}
        </button>
      </div>
      {testNotice && <div role="status" className={`adm-notice is-${testNotice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{testNotice.text}</div>}

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Daily check</h3>
      <p className="adm-muted">
        Last daily check: {last.lastRunAt ? new Date(last.lastRunAt).toLocaleString() : 'not yet'}
        {sum && <> · checked {sum.checked}, updated {sum.updated}, couldn’t read {sum.failed}</>}
        {view.running && <> · running now…</>}
      </p>
      <div className="adm-actions">
        <button className="btn btn-secondary" disabled={!!busy || view.running} onClick={() => void runNow()}>
          {view.running ? 'Checking…' : busy === 'run' ? 'Starting…' : 'Run now'}
        </button>
      </div>
    </section>
  );
}
