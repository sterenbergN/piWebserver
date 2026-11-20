'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { loadAiStatus } from '@/lib/ai/client';
import type { ProviderId, ProviderInfo } from '@/lib/ai/providers-list';
import type { AiPublicSettings } from '@/lib/ai/settings';

// Connect an AI so the copy-prompt / paste-reply features get a Generate button.
// The key is sent here once and never comes back: the page only ever sees its last
// four characters.

const OTHER = '__other__';

export default function AiPanel() {
  const [settings, setSettings] = useState<AiPublicSettings | null>(null);
  const [providers, setProviders] = useState<Record<ProviderId, ProviderInfo> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'remove'>('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { confirm, popup } = useSitePopup();

  const adopt = (s: AiPublicSettings, list = providers) => {
    setSettings(s);
    setProvider(s.provider);
    setModel(s.model);
    setCustomModel(!!list && !list[s.provider].models.some((m) => m.id === s.model));
    setEnabled(s.enabled);
    setApiKey('');
  };

  useEffect(() => {
    fetch('/api/admin/ai', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((body: { settings: AiPublicSettings; providers: Record<ProviderId, ProviderInfo> }) => {
        setProviders(body.providers);
        adopt(body.settings, body.providers);
      })
      .catch(() => setLoadError(true));
  }, []);

  if (!settings || !providers) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>✨ AI</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load the AI settings.</div> : <p className="adm-muted">Loading…</p>}
      </section>
    );
  }

  const info = providers[provider];
  const dirty = provider !== settings.provider || model.trim() !== settings.model || enabled !== settings.enabled || !!apiKey.trim();

  const save = async (patch: Record<string, unknown>, doing: 'save' | 'remove') => {
    setBusy(doing);
    setNotice(null);
    try {
      const r = await fetch('/api/admin/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Couldn’t save.');
      adopt(body.settings);
      void loadAiStatus(true);
      setNotice({ kind: 'success', text: doing === 'remove' ? 'Key removed. Every page is back to copy and paste.' : 'Saved.' });
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
      const r = await fetch('/api/admin/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model: model.trim(), apiKey: apiKey.trim() }) });
      const body = await r.json().catch(() => ({}));
      setNotice(body.ok ? { kind: 'success', text: body.message } : { kind: 'error', text: body.error || 'That didn’t work.' });
    } catch {
      setNotice({ kind: 'error', text: 'Couldn’t reach the site.' });
    } finally {
      setBusy('');
    }
  };

  const ready = settings.enabled && settings.hasKey;
  const savedModel = providers[settings.provider].models.find((m) => m.id === settings.model)?.label.replace(/\s*\(.*\)$/, '') ?? settings.model;

  return (
    <section className="adm-card" aria-labelledby="ai-title">
      {popup}
      <div className="adm-card-head"><h2 id="ai-title">✨ AI</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Connect an AI and the copy-prompt features (Recipes, Study, Skills, Notes summaries) get a <strong>Generate</strong> button
        that fills in the reply for you. If no key is set, or the AI fails or sends something unreadable, the page says so and copy and paste works as always.
        The key stays on this server: it isn’t shown again, and backups and account downloads leave it out.
      </p>

      <div role="status" className={`adm-notice ${ready ? 'is-success' : 'is-info'}`}>
        {ready
          ? `On: signed-in accounts see Generate, using ${savedModel} (key ${settings.keyHint}).`
          : settings.hasKey ? 'Off: the key is saved but Generate is hidden.' : 'Not connected: every page uses copy and paste.'}
      </div>

      <div className="adm-form">
        <label className="adm-field">
          Provider
          <select value={provider} onChange={(e) => {
            const next = e.target.value as ProviderId;
            setProvider(next);
            setModel(providers[next].defaultModel);
            setCustomModel(false);
          }}>
            {(Object.keys(providers) as ProviderId[]).map((id) => <option key={id} value={id}>{providers[id].label}</option>)}
          </select>
        </label>
        <label className="adm-field">
          Model
          <select value={customModel ? OTHER : model} onChange={(e) => {
            if (e.target.value === OTHER) { setCustomModel(true); return; }
            setCustomModel(false);
            setModel(e.target.value);
          }}>
            {info.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value={OTHER}>Other model id…</option>
          </select>
        </label>
        {customModel && (
          <label className="adm-field">
            Model id
            <input value={model} maxLength={100} placeholder={info.defaultModel} spellCheck={false} autoCapitalize="off" onChange={(e) => setModel(e.target.value)} />
          </label>
        )}
        <label className="adm-field is-wide">
          API key {settings.hasKey && <span>(saved, ends {settings.keyHint})</span>}
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={settings.hasKey ? 'Leave blank to keep the saved key' : info.keyPlaceholder}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span>Make one at <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl.replace(/^https:\/\//, '')}</a>. Every Generate is billed to that account.</span>
        </label>
        <label className="adm-check is-wide">
          <input type="checkbox" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show Generate buttons
        </label>
      </div>

      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <div className="adm-actions" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy || !dirty || !model.trim()} onClick={() => save({ provider, model: model.trim(), enabled, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }, 'save')}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary" disabled={!!busy || (!settings.hasKey && !apiKey.trim()) || !model.trim()} onClick={test}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        {settings.hasKey && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={async () => {
            if (await confirm({ title: 'Remove the API key?', message: 'Generate goes away until you add one again.', confirmLabel: 'Remove', danger: true })) void save({ clearKey: true }, 'remove');
          }}>
            {busy === 'remove' ? 'Removing…' : 'Remove key'}
          </button>
        )}
      </div>
    </section>
  );
}
