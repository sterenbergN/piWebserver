'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { loadAiStatus } from '@/lib/ai/client';
import { AUTO_PREFIX, newerFirst, resolveChoice, type CatalogModel, type ProviderId, type ProviderInfo } from '@/lib/ai/providers-list';
import type { AiPublicSettings } from '@/lib/ai/settings';
import { AI_TASKS, AI_TASK_IDS, type AiTask } from '@/lib/ai/tasks';

// Connect an AI so the copy-prompt / paste-reply features get a Generate button.
// The key is sent here once and never comes back: the page only ever sees its last
// four characters. Models come from the provider's own list (refreshed daily), and
// the "Newest …" choices move to new releases by themselves.

const OTHER = '__other__';
type Account = { id: string; username: string };
type PublicCatalog = { provider: ProviderId; fetchedAt: string; models: CatalogModel[] };
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameMap = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] || '') === (b[k] || ''));
};

/** The options every model picker shows: the "Newest …" choices, then every model the key can use. */
function ModelOptions({ info, provider, models, extra }: { info: ProviderInfo; provider: ProviderId; models: CatalogModel[]; extra?: string }) {
  const known = extra && !extra.startsWith(AUTO_PREFIX) && !models.some((m) => m.id === extra);
  return (
    <>
      <optgroup label="Keeps up with new releases">
        {info.autos.map((a) => (
          <option key={a.key} value={`${AUTO_PREFIX}${a.key}`}>
            {a.label}: now {resolveChoice(provider, `${AUTO_PREFIX}${a.key}`, models).label}{a.hint ? ` (${a.hint})` : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="A fixed model">
        {known && <option value={extra}>{extra}</option>}
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </optgroup>
    </>
  );
}

export default function AiPanel() {
  const [settings, setSettings] = useState<AiPublicSettings | null>(null);
  const [providers, setProviders] = useState<Record<ProviderId, ProviderInfo> | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState(false);
  const [taskModels, setTaskModels] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'remove' | 'models'>('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { confirm, popup } = useSitePopup();

  const modelsFor = (id: ProviderId, list = providers, cat = catalog): CatalogModel[] =>
    cat && cat.provider === id && cat.models.length ? [...cat.models].sort(newerFirst) : list?.[id].models ?? [];

  const adopt = (s: AiPublicSettings, list = providers, cat = catalog) => {
    setSettings(s);
    setProvider(s.provider);
    setModel(s.model);
    setCustomModel(!s.model.startsWith(AUTO_PREFIX) && !modelsFor(s.provider, list, cat).some((m) => m.id === s.model));
    setTaskModels({ ...s.taskModels });
    setEnabled(s.enabled);
    setAllowed(s.allowedUserIds);
    setApiKey('');
  };

  useEffect(() => {
    fetch('/api/admin/ai', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((body: { settings: AiPublicSettings; providers: Record<ProviderId, ProviderInfo>; accounts?: Account[]; catalog?: PublicCatalog | null }) => {
        setProviders(body.providers);
        setAccounts(body.accounts ?? []);
        setCatalog(body.catalog ?? null);
        adopt(body.settings, body.providers, body.catalog ?? null);
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
  const models = modelsFor(provider);
  const switching = provider !== settings.provider;
  const dirty = switching || model.trim() !== settings.model || enabled !== settings.enabled || !!apiKey.trim()
    || !sameSet(allowed, settings.allowedUserIds) || !sameMap(taskModels, settings.taskModels as Record<string, string>);
  // A saved key belongs to its provider, so a new provider needs its own.
  const keyForTest = !!apiKey.trim() || (settings.hasKey && !switching);
  const liveList = catalog && catalog.provider === provider && !switching;

  const call = async (method: 'PUT' | 'POST', payload: Record<string, unknown>) => {
    const r = await fetch('/api/admin/ai', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'That didn’t work.');
    return body;
  };

  const save = async (patch: Record<string, unknown>, doing: 'save' | 'remove') => {
    setBusy(doing);
    setNotice(null);
    try {
      const body = await call('PUT', patch);
      const cat = body.catalog ?? null;
      setCatalog(cat);
      adopt(body.settings, providers, cat);
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
      const body = await call('POST', { provider, model: model.trim(), apiKey: apiKey.trim() });
      setNotice(body.ok ? { kind: 'success', text: body.message } : { kind: 'error', text: body.error || 'That didn’t work.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t reach the site.' });
    } finally {
      setBusy('');
    }
  };

  const refreshModels = async () => {
    setBusy('models');
    setNotice(null);
    try {
      const body = await call('POST', { action: 'models' });
      if (!body.ok) throw new Error(body.error);
      setCatalog(body.catalog);
      setNotice({ kind: 'success', text: `Got ${body.catalog.models.length} models.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t get the list.' });
    } finally {
      setBusy('');
    }
  };

  const ready = settings.enabled && settings.hasKey;
  const allowedNames = settings.allowedUserIds.map((id) => accounts.find((a) => a.id === id)?.username ?? id);
  const savedModel = resolveChoice(settings.provider, settings.model, modelsFor(settings.provider)).label;
  const ownModels = AI_TASK_IDS.filter((t) => taskModels[t]).length;

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
          ? `On, using ${savedModel}${Object.keys(settings.taskModels).length ? ' (some tasks use their own)' : ''}, key ${settings.keyHint}. Generate shows for Admin${allowedNames.length ? ` and ${allowedNames.join(', ')}` : ' only'}.`
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
            setTaskModels({});
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
            <ModelOptions info={info} provider={provider} models={models} />
            <option value={OTHER}>Other model id…</option>
          </select>
        </label>
        {customModel && (
          <label className="adm-field">
            Model id
            <input value={model} maxLength={100} placeholder={info.models[0]?.id} spellCheck={false} autoCapitalize="off" onChange={(e) => setModel(e.target.value)} />
          </label>
        )}
        <div className="adm-field is-wide">
          <span>
            {liveList
              ? `Models from ${info.label}, checked ${new Date(catalog!.fetchedAt).toLocaleString()}. The list refreshes daily, and a “Newest” choice moves to a new release on its own.`
              : 'Save a key and the list fills in with every model it can use, kept up to date daily.'}
            {liveList && (
              <> <button type="button" className="adm-link-btn" disabled={!!busy} onClick={refreshModels}>{busy === 'models' ? 'Checking…' : 'Check now'}</button></>
            )}
          </span>
        </div>

        <details className="is-wide" open={ownModels > 0 || undefined}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>A different model for some tasks{ownModels ? ` (${ownModels} set)` : ''}</summary>
          <div className="adm-form" style={{ marginTop: '0.75rem' }}>
            {AI_TASK_IDS.map((task: AiTask) => (
              <label key={task} className="adm-field">
                {AI_TASKS[task]}
                <select value={taskModels[task] ?? ''} onChange={(e) => setTaskModels({ ...taskModels, [task]: e.target.value })}>
                  <option value="">Same as the model above</option>
                  <ModelOptions info={info} provider={provider} models={models} extra={taskModels[task]} />
                </select>
              </label>
            ))}
          </div>
        </details>

        {info.note && <p className="adm-notice is-info is-wide" style={{ margin: 0 }}>{info.note}</p>}
        <label className="adm-field is-wide">
          API key {settings.hasKey && !switching && <span>(saved, ends {settings.keyHint})</span>}
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={settings.hasKey && !switching ? 'Leave blank to keep the saved key' : info.keyPlaceholder}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span>
            Make one at <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl.replace(/^https:\/\//, '')}</a>.
            {switching && settings.hasKey ? ' Saving with a new provider forgets the old key, so paste this provider’s key.' : ' Any charges go to that account.'}
          </span>
        </label>
        <fieldset className="adm-field is-wide" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: '0.35rem' }}>Who can use it</legend>
          <span>Admin can always use it. Tick your own account so Generate shows when you’re signed in as you; leave the rest unticked to keep it to yourself.</span>
          {accounts.map((a) => (
            <label key={a.id} className="adm-check">
              <input type="checkbox" checked={allowed.includes(a.id)} onChange={(e) => setAllowed(e.target.checked ? [...allowed, a.id] : allowed.filter((id) => id !== a.id))} />
              {a.username}
            </label>
          ))}
        </fieldset>
        <label className="adm-check is-wide">
          <input type="checkbox" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show Generate buttons
        </label>
      </div>

      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <div className="adm-actions" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy || !dirty || !model.trim()} onClick={() => save({ provider, model: model.trim(), taskModels, enabled, allowedUserIds: allowed, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }, 'save')}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary" disabled={!!busy || !keyForTest || !model.trim()} onClick={test}>
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
