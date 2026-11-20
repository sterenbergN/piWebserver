'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { loadAiStatus } from '@/lib/ai/client';
import { AUTO_PREFIX, newerFirst, resolveChoice, type CatalogModel, type ProviderId, type ProviderInfo } from '@/lib/ai/providers-list';
import type { AiPublicSettings, PublicConnection } from '@/lib/ai/settings';
import { AI_TASKS, AI_TASK_IDS } from '@/lib/ai/tasks';

// Connect an AI so the copy-prompt / paste-reply features get a Generate button.
// The site has one connection, which Admin and any account given "the site key"
// share; an account can instead be given its own provider and key. Only this page
// sets any of it. Keys are sent here once and never come back: the page only ever
// sees their last four characters. Models come from each key's own list (refreshed
// daily), and the "Newest …" choices move to new releases by themselves.

const OTHER = '__other__';
type Account = { id: string; username: string };
type PublicCatalog = { provider: ProviderId; fetchedAt: string; models: CatalogModel[] };
type Draft = { provider: ProviderId; model: string; customModel: boolean; taskModels: Record<string, string>; apiKey: string };
type Mode = 'none' | 'site' | 'own';
type Notice = { kind: 'success' | 'error'; text: string };
type Payload = Record<string, unknown>;

function modelsFor(providers: Record<ProviderId, ProviderInfo>, provider: ProviderId, catalog?: PublicCatalog | null): CatalogModel[] {
  return catalog && catalog.provider === provider && catalog.models.length ? [...catalog.models].sort(newerFirst) : providers[provider].models;
}

function draftFrom(conn: Omit<PublicConnection, 'hasKey' | 'keyHint'>, providers: Record<ProviderId, ProviderInfo>, catalog?: PublicCatalog | null): Draft {
  const models = modelsFor(providers, conn.provider, catalog);
  return {
    provider: conn.provider,
    model: conn.model,
    customModel: !conn.model.startsWith(AUTO_PREFIX) && !models.some((m) => m.id === conn.model),
    taskModels: { ...conn.taskModels },
    apiKey: '',
  };
}

/** What saving a connection sends: the key only when one was typed. */
function draftPatch(d: Draft): Payload {
  const taskModels = Object.fromEntries(Object.entries(d.taskModels).filter(([, v]) => v));
  return { provider: d.provider, model: d.model.trim(), taskModels, ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}) };
}

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

/** Provider, models (default and per task), key, and Test: for the site, or one account. */
function ConnectionEditor({ label, draft, onChange, saved, providers, catalog, busy, notice, onTest, onRefresh }: {
  label: string;
  draft: Draft;
  onChange: (d: Draft) => void;
  saved: PublicConnection | null;
  providers: Record<ProviderId, ProviderInfo>;
  catalog?: PublicCatalog | null;
  busy: boolean;
  notice?: Notice | null;
  onTest: () => void;
  onRefresh: () => void;
}) {
  const info = providers[draft.provider];
  const models = modelsFor(providers, draft.provider, catalog);
  const switching = !!saved && draft.provider !== saved.provider;
  const savedKey = !!saved?.hasKey && !switching;
  const liveList = !!catalog && catalog.provider === draft.provider && !switching;
  const ownModels = AI_TASK_IDS.filter((t) => draft.taskModels[t]).length;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  return (
    <div className="adm-form">
      <label className="adm-field">
        Provider
        <select value={draft.provider} onChange={(e) => {
          const next = e.target.value as ProviderId;
          set({ provider: next, model: providers[next].defaultModel, customModel: false, taskModels: {} });
        }}>
          {(Object.keys(providers) as ProviderId[]).map((id) => <option key={id} value={id}>{providers[id].label}</option>)}
        </select>
      </label>
      <label className="adm-field">
        Model
        <select value={draft.customModel ? OTHER : draft.model} onChange={(e) => {
          if (e.target.value === OTHER) set({ customModel: true });
          else set({ customModel: false, model: e.target.value });
        }}>
          <ModelOptions info={info} provider={draft.provider} models={models} />
          <option value={OTHER}>Other model id…</option>
        </select>
      </label>
      {draft.customModel && (
        <label className="adm-field">
          Model id
          <input value={draft.model} maxLength={100} placeholder={info.models[0]?.id} spellCheck={false} autoCapitalize="off" onChange={(e) => set({ model: e.target.value })} />
        </label>
      )}
      <div className="adm-field is-wide">
        <span>
          {liveList
            ? `Models from ${info.label}, checked ${new Date(catalog!.fetchedAt).toLocaleString()}. The list refreshes daily, and a “Newest” choice moves to a new release on its own.`
            : 'Save a key and the list fills in with every model it can use, kept up to date daily.'}
          {liveList && <> <button type="button" className="adm-link-btn" disabled={busy} onClick={onRefresh}>Check now</button></>}
        </span>
      </div>

      <details className="is-wide" open={ownModels > 0 || undefined}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>A different model for some tasks{ownModels ? ` (${ownModels} set)` : ''}</summary>
        <div className="adm-form" style={{ marginTop: '0.75rem' }}>
          {AI_TASK_IDS.map((task) => (
            <label key={task} className="adm-field">
              {AI_TASKS[task]}
              <select value={draft.taskModels[task] ?? ''} onChange={(e) => set({ taskModels: { ...draft.taskModels, [task]: e.target.value } })}>
                <option value="">Same as the model above</option>
                <ModelOptions info={info} provider={draft.provider} models={models} extra={draft.taskModels[task]} />
              </select>
            </label>
          ))}
        </div>
      </details>

      {info.note && <p className="adm-notice is-info is-wide" style={{ margin: 0 }}>{info.note}</p>}
      <label className="adm-field is-wide">
        {label} {savedKey && <span>(saved, ends {saved!.keyHint})</span>}
        <input
          type="password"
          value={draft.apiKey}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder={savedKey ? 'Leave blank to keep the saved key' : info.keyPlaceholder}
          onChange={(e) => set({ apiKey: e.target.value })}
        />
        <span>
          Make one at <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl.replace(/^https:\/\//, '')}</a>.
          {switching && saved?.hasKey ? ' Saving with a new provider forgets the old key, so paste this provider’s key.' : ' Any charges go to that account.'}
        </span>
      </label>
      <div className="adm-actions is-wide" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-secondary adm-small-btn" disabled={busy || (!draft.apiKey.trim() && !savedKey) || !draft.model.trim()} onClick={onTest}>Test connection</button>
        {notice && <span role="status" style={{ color: notice.kind === 'error' ? 'var(--danger)' : 'var(--success)', fontSize: '0.88rem' }}>{notice.text}</span>}
      </div>
    </div>
  );
}

export default function AiPanel() {
  const [settings, setSettings] = useState<AiPublicSettings | null>(null);
  const [providers, setProviders] = useState<Record<ProviderId, ProviderInfo> | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, PublicCatalog | null>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [site, setSite] = useState<Draft | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [own, setOwn] = useState<Record<string, Draft>>({});
  const [enabled, setEnabled] = useState(true);
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState('');
  const [notices, setNotices] = useState<Record<string, Notice | null>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const { confirm, popup } = useSitePopup();

  type View = { settings: AiPublicSettings; providers: Record<ProviderId, ProviderInfo>; accounts: Account[]; catalogs: Record<string, PublicCatalog | null> };

  const payloadOf = (s: Draft, m: Record<string, Mode>, o: Record<string, Draft>, on: boolean, saved: AiPublicSettings, list: Account[]): Payload => ({
    ...draftPatch(s),
    enabled: on,
    allowedUserIds: list.filter((a) => m[a.id] === 'site').map((a) => a.id),
    accounts: Object.fromEntries(list.flatMap((a) => (
      m[a.id] === 'own' && o[a.id] ? [[a.id, draftPatch(o[a.id])]] : saved.accounts[a.id] ? [[a.id, { remove: true }]] : []
    ))),
  });

  const adopt = (v: View) => {
    setSettings(v.settings);
    setProviders(v.providers);
    setAccounts(v.accounts);
    setCatalogs(v.catalogs);
    const s = draftFrom(v.settings, v.providers, v.catalogs.site);
    const m: Record<string, Mode> = {};
    const o: Record<string, Draft> = {};
    for (const a of v.accounts) {
      const conn = v.settings.accounts[a.id];
      m[a.id] = conn ? 'own' : v.settings.allowedUserIds.includes(a.id) ? 'site' : 'none';
      o[a.id] = conn ? draftFrom(conn, v.providers, v.catalogs[a.id]) : draftFrom({ provider: v.settings.provider, model: v.providers[v.settings.provider].defaultModel, taskModels: {} }, v.providers);
    }
    setSite(s);
    setModes(m);
    setOwn(o);
    setEnabled(v.settings.enabled);
    setBaseline(JSON.stringify(payloadOf(s, m, o, v.settings.enabled, v.settings, v.accounts)));
  };

  useEffect(() => {
    fetch('/api/admin/ai', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(adopt)
      .catch(() => setLoadError(true));
  }, []);

  if (!settings || !providers || !site) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>✨ AI</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load the AI settings.</div> : <p className="adm-muted">Loading…</p>}
      </section>
    );
  }

  const payload = payloadOf(site, modes, own, enabled, settings, accounts);
  const dirty = JSON.stringify(payload) !== baseline;
  const call = async (method: 'PUT' | 'POST', body: Payload) => {
    const r = await fetch('/api/admin/ai', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || 'That didn’t work.');
    return json;
  };

  const save = async (body: Payload, doing: 'save' | 'remove') => {
    setBusy(doing);
    setNotice(null);
    try {
      adopt(await call('PUT', body));
      setNotices({});
      void loadAiStatus(true);
      setNotice({ kind: 'success', text: doing === 'remove' ? 'Site key removed.' : 'Saved.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t save.' });
    } finally {
      setBusy('');
    }
  };

  /** Test a connection: "site" or an account id. */
  const test = async (id: string, d: Draft) => {
    setBusy(`test:${id}`);
    setNotices((n) => ({ ...n, [id]: null }));
    try {
      const body = await call('POST', { ...(id === 'site' ? {} : { account: id }), provider: d.provider, model: d.model.trim(), apiKey: d.apiKey.trim() });
      setNotices((n) => ({ ...n, [id]: body.ok ? { kind: 'success', text: body.message } : { kind: 'error', text: body.error || 'That didn’t work.' } }));
    } catch (e) {
      setNotices((n) => ({ ...n, [id]: { kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t reach the site.' } }));
    } finally {
      setBusy('');
    }
  };

  const refresh = async (id: string) => {
    setBusy(`models:${id}`);
    try {
      const body = await call('POST', { action: 'models', ...(id === 'site' ? {} : { account: id }) });
      if (!body.ok) throw new Error(body.error);
      setCatalogs((c) => ({ ...c, [id]: body.catalog }));
      setNotices((n) => ({ ...n, [id]: { kind: 'success', text: `Got ${body.catalog.models.length} models.` } }));
    } catch (e) {
      setNotices((n) => ({ ...n, [id]: { kind: 'error', text: e instanceof Error ? e.message : 'Couldn’t get the list.' } }));
    } finally {
      setBusy('');
    }
  };

  const name = (id: string) => accounts.find((a) => a.id === id)?.username ?? id;
  const sharing = settings.allowedUserIds.map(name);
  const withOwn = Object.entries(settings.accounts).filter(([, c]) => c.hasKey).map(([id]) => name(id));
  const siteModel = resolveChoice(settings.provider, settings.model, modelsFor(providers, settings.provider, catalogs.site)).label;

  return (
    <section className="adm-card" aria-labelledby="ai-title">
      {popup}
      <div className="adm-card-head"><h2 id="ai-title">✨ AI</h2></div>
      <p className="adm-muted" style={{ marginTop: 0 }}>
        Connect an AI and the copy-prompt features (Recipes, PA Study, Skills, Notes summaries) get a <strong>Generate</strong> button
        that fills in the reply for you. If there’s no key, or the AI fails or sends something unreadable, the page says so and copy and paste works as always.
        Keys stay on this server: they aren’t shown again, and backups and account downloads leave them out. Only Admin can set them.
      </p>

      <div role="status" className={`adm-notice ${settings.enabled && (settings.hasKey || withOwn.length) ? 'is-success' : 'is-info'}`}>
        {!settings.enabled
          ? 'Off: Generate is hidden everywhere.'
          : settings.hasKey || withOwn.length
            ? [
              settings.hasKey ? `Site key (${siteModel}, ${settings.keyHint}): Admin${sharing.length ? `, ${sharing.join(', ')}` : ''}.` : '',
              withOwn.length ? `Own key: ${withOwn.join(', ')}.` : '',
            ].filter(Boolean).join(' ')
            : 'Not connected: every page uses copy and paste.'}
      </div>

      <h3 className="adm-h3">Site key</h3>
      <p className="adm-muted">Used whenever you’re signed in to Admin, and by any account below set to share it.</p>
      <ConnectionEditor
        label="API key"
        draft={site}
        onChange={setSite}
        saved={settings}
        providers={providers}
        catalog={catalogs.site}
        busy={!!busy}
        notice={notices.site}
        onTest={() => test('site', site)}
        onRefresh={() => refresh('site')}
      />

      <h3 className="adm-h3" style={{ marginTop: '1.5rem' }}>Accounts</h3>
      <p className="adm-muted">Each account gets nothing, a share of the site key, or a key of its own (with its own models). Its own key is used first.</p>
      <div className="adm-list">
        {accounts.map((a) => (
          <div key={a.id} className="adm-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
            <label className="adm-field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <strong style={{ color: 'var(--foreground)', fontSize: '0.95rem' }}>{a.username}</strong>
              <select value={modes[a.id] ?? 'none'} onChange={(e) => setModes({ ...modes, [a.id]: e.target.value as Mode })} aria-label={`AI for ${a.username}`} style={{ maxWidth: '100%' }}>
                <option value="none">No AI (copy and paste)</option>
                <option value="site">Shares the site key</option>
                <option value="own">Its own key</option>
              </select>
            </label>
            {modes[a.id] === 'own' && own[a.id] && (
              <ConnectionEditor
                label={`${a.username}’s API key`}
                draft={own[a.id]}
                onChange={(d) => setOwn({ ...own, [a.id]: d })}
                saved={settings.accounts[a.id] ?? null}
                providers={providers}
                catalog={catalogs[a.id]}
                busy={!!busy}
                notice={notices[a.id]}
                onTest={() => test(a.id, own[a.id])}
                onRefresh={() => refresh(a.id)}
              />
            )}
            {modes[a.id] === 'own' && !settings.accounts[a.id]?.hasKey && !own[a.id]?.apiKey.trim() && (
              <p className="adm-muted" style={{ margin: 0 }}>Add a key, or {a.username} won’t see Generate.</p>
            )}
          </div>
        ))}
      </div>

      <label className="adm-check" style={{ marginTop: '1.25rem' }}>
        <input type="checkbox" className="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Show Generate buttons
      </label>

      {notice && <div role="status" className={`adm-notice is-${notice.kind}`} style={{ marginTop: '1rem', marginBottom: 0 }}>{notice.text}</div>}

      <div className="adm-actions" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={!!busy || !dirty || !site.model.trim()} onClick={() => save(payload, 'save')}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {settings.hasKey && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={async () => {
            if (await confirm({ title: 'Remove the site key?', message: 'Admin and accounts sharing it lose Generate until you add one again. Accounts with their own key keep theirs.', confirmLabel: 'Remove', danger: true })) void save({ clearKey: true }, 'remove');
          }}>
            {busy === 'remove' ? 'Removing…' : 'Remove site key'}
          </button>
        )}
      </div>
    </section>
  );
}
