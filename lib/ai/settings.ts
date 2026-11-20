import path from 'path';
import { readJson, withLock, writeJsonAtomic } from '@/lib/json-store';
import { DEFAULT_PROVIDER, PROVIDERS, isProviderId, type ProviderId } from './providers-list';
import { isAiTask, type AiTask } from './tasks';

// The AI connections for the copy-prompt / paste-reply features, all set by the
// admin: the site's own, which the admin and any ticked account share, and an
// account's own key when the admin gives it one. Keys live only here on the server:
// never sent to a browser (the admin page sees the last four characters), never
// logged, and backups and account exports leave the whole .data/ai folder out.

/** One provider, key and choice of models. */
export type AiConnection = {
  provider: ProviderId;
  /** The default: an exact model id, or `auto:<family>` for the newest of a family. */
  model: string;
  /** A different model for some tasks; a task left out uses `model`. */
  taskModels: Partial<Record<AiTask, string>>;
  apiKey: string;
};

export type AiSettings = AiConnection & {
  /** Off keeps every key but hides Generate everywhere. */
  enabled: boolean;
  /**
   * Accounts that share the site's connection. Whoever is signed in to Admin always
   * may; nobody else does unless ticked here, so the owner's key isn't shared by default.
   */
  allowedUserIds: string[];
  /** Accounts the admin gave their own key. Theirs is used before the site's. */
  accounts: Record<string, AiConnection>;
  updatedAt?: string;
};

/** Who's asking: a signed-in account, the admin, or both in one browser. */
export type AiCaller = { userId: string | null; isAdmin: boolean };

/** A connection in use: `scope` is "site" or "user:<id>", for keeping each one's model list apart. */
export type ActiveConnection = AiConnection & { scope: string };

export type PublicConnection = Omit<AiConnection, 'apiKey'> & { hasKey: boolean; keyHint: string };

/** What the admin page may see. */
export type AiPublicSettings = Omit<AiSettings, 'apiKey' | 'accounts'> & { hasKey: boolean; keyHint: string; accounts: Record<string, PublicConnection> };

export const AI_FOLDER = '.data/ai/';
export const aiSettingsFile = () => path.join(process.cwd(), '.data', 'ai', 'settings.json');

const MAX_KEY = 400;
const MAX_ACCOUNTS = 50;
export const USER_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

export class AiSettingsError extends Error {}

export function defaultConnection(provider: ProviderId = DEFAULT_PROVIDER): AiConnection {
  return { provider, model: PROVIDERS[provider].defaultModel, taskModels: {}, apiKey: '' };
}

export function defaultAiSettings(): AiSettings {
  return { ...defaultConnection(), enabled: true, allowedUserIds: [], accounts: {} };
}

function cleanConnection(raw: unknown): AiConnection {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const provider = isProviderId(r.provider) ? r.provider : DEFAULT_PROVIDER;
  return {
    provider,
    model: typeof r.model === 'string' && MODEL_RE.test(r.model.trim()) ? r.model.trim() : PROVIDERS[provider].defaultModel,
    taskModels: cleanTaskModels(r.taskModels),
    apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim().slice(0, MAX_KEY) : '',
  };
}

function cleanAccounts(value: unknown): Record<string, AiConnection> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, AiConnection> = {};
  for (const [id, conn] of Object.entries(value).slice(0, MAX_ACCOUNTS)) {
    if (USER_ID_RE.test(id)) out[id] = cleanConnection(conn);
  }
  return out;
}

/** Whatever was stored, made safe to use: unknown providers and odd values fall back to the defaults. */
export function cleanAiSettings(raw: unknown): AiSettings {
  if (!raw || typeof raw !== 'object') return defaultAiSettings();
  const r = raw as Record<string, unknown>;
  return {
    ...cleanConnection(r),
    enabled: r.enabled !== false,
    allowedUserIds: cleanUserIds(r.allowedUserIds),
    accounts: cleanAccounts(r.accounts),
    ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
  };
}

function cleanTaskModels(value: unknown): Partial<Record<AiTask, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<AiTask, string>> = {};
  for (const [task, model] of Object.entries(value)) {
    if (isAiTask(task) && typeof model === 'string' && MODEL_RE.test(model.trim())) out[task] = model.trim();
  }
  return out;
}

/** The model choice for a task: its own, or the default. */
export function choiceFor(conn: AiConnection, task?: AiTask) {
  return (task && conn.taskModels[task]) || conn.model;
}

function cleanUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && USER_ID_RE.test(v)))].slice(0, MAX_ACCOUNTS);
}

export async function getAiSettings(): Promise<AiSettings> {
  return cleanAiSettings(await readJson<unknown>(aiSettingsFile(), null));
}

export function keyHint(apiKey: string) {
  return apiKey ? `…${apiKey.slice(-4)}` : '';
}

function publicConnection({ apiKey, ...rest }: AiConnection): PublicConnection {
  return { ...rest, hasKey: !!apiKey, keyHint: keyHint(apiKey) };
}

export function toPublic(settings: AiSettings): AiPublicSettings {
  const { apiKey, accounts, ...rest } = settings;
  return {
    ...rest,
    hasKey: !!apiKey,
    keyHint: keyHint(apiKey),
    accounts: Object.fromEntries(Object.entries(accounts).map(([id, conn]) => [id, publicConnection(conn)])),
  };
}

/** The site's connection is ready: switched on, with a key. */
export function isAiReady(settings: AiSettings) {
  return settings.enabled && !!settings.apiKey;
}

/** Whether this caller may share the site's key: the admin, or an account the admin ticked. */
export function mayUseAi(settings: AiSettings, caller: AiCaller) {
  return caller.isAdmin || (!!caller.userId && settings.allowedUserIds.includes(caller.userId));
}

/**
 * The connection this caller's Generate uses: the account's own key if the admin
 * gave it one, else the site's if they may share it, else none.
 */
export function connectionFor(settings: AiSettings, caller: AiCaller): ActiveConnection | null {
  if (!settings.enabled) return null;
  const own = caller.userId ? settings.accounts[caller.userId] : undefined;
  if (own?.apiKey) return { ...own, scope: `user:${caller.userId}` };
  if (settings.apiKey && mayUseAi(settings, caller)) return { ...siteConnection(settings), scope: 'site' };
  return null;
}

export function siteConnection(settings: AiSettings): AiConnection {
  return { provider: settings.provider, model: settings.model, taskModels: settings.taskModels, apiKey: settings.apiKey };
}

export type ConnectionPatch = {
  provider?: unknown;
  model?: unknown;
  /** A new key. Left out or blank keeps the saved one. */
  apiKey?: unknown;
  /** True forgets the saved key. */
  clearKey?: unknown;
  /** Per-task models; a blank one goes back to the default. */
  taskModels?: unknown;
};

export type AiSettingsPatch = ConnectionPatch & {
  enabled?: unknown;
  allowedUserIds?: unknown;
  /** Per account: changes to its own connection, or `{ remove: true }` to take it away. */
  accounts?: unknown;
};

function applyConnectionPatch(current: AiConnection, patch: ConnectionPatch): AiConnection {
  const next = { ...current };
  if (patch.provider !== undefined) {
    if (!isProviderId(patch.provider)) throw new AiSettingsError('Unknown provider.');
    const info = PROVIDERS[patch.provider];
    if (patch.provider !== next.provider) {
      next.model = info.defaultModel;
      // Another provider's models mean nothing here.
      next.taskModels = {};
      // A key belongs to one provider: never send it to another.
      next.apiKey = '';
    }
    next.provider = patch.provider;
  }
  if (patch.model !== undefined) {
    const model = typeof patch.model === 'string' ? patch.model.trim() : '';
    if (!MODEL_RE.test(model)) throw new AiSettingsError('That model name doesn’t look right.');
    next.model = model;
  }
  if (patch.clearKey === true) next.apiKey = '';
  if (patch.apiKey !== undefined && patch.apiKey !== null) {
    if (typeof patch.apiKey !== 'string') throw new AiSettingsError('The key should be text.');
    const key = patch.apiKey.trim();
    if (key.length > MAX_KEY || /\s/.test(key)) throw new AiSettingsError('That key doesn’t look right.');
    if (key) next.apiKey = key;
  }
  if (patch.taskModels !== undefined) {
    if (!patch.taskModels || typeof patch.taskModels !== 'object' || Array.isArray(patch.taskModels)) throw new AiSettingsError('Pick models from the list.');
    for (const [task, model] of Object.entries(patch.taskModels)) {
      if (!isAiTask(task)) continue;
      if (model !== '' && model !== null && (typeof model !== 'string' || !MODEL_RE.test(model.trim()))) throw new AiSettingsError('That model name doesn’t look right.');
    }
    next.taskModels = cleanTaskModels(patch.taskModels);
  }
  return next;
}

/** Check a change from the admin page and apply it to `current`. Throws AiSettingsError on bad input. */
export function applyAiPatch(current: AiSettings, patch: AiSettingsPatch, now = new Date()): AiSettings {
  const next: AiSettings = { ...current, ...applyConnectionPatch(siteConnection(current), patch), accounts: { ...current.accounts } };
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.allowedUserIds !== undefined) {
    if (!Array.isArray(patch.allowedUserIds)) throw new AiSettingsError('Pick accounts from the list.');
    next.allowedUserIds = cleanUserIds(patch.allowedUserIds);
  }
  if (patch.accounts !== undefined) {
    if (!patch.accounts || typeof patch.accounts !== 'object' || Array.isArray(patch.accounts)) throw new AiSettingsError('Pick accounts from the list.');
    for (const [id, change] of Object.entries(patch.accounts as Record<string, unknown>)) {
      if (!USER_ID_RE.test(id)) throw new AiSettingsError('Pick accounts from the list.');
      const c = (change && typeof change === 'object' ? change : {}) as ConnectionPatch & { remove?: unknown };
      if (c.remove === true) { delete next.accounts[id]; continue; }
      if (!next.accounts[id] && Object.keys(next.accounts).length >= MAX_ACCOUNTS) throw new AiSettingsError('Too many accounts.');
      next.accounts[id] = applyConnectionPatch(next.accounts[id] ?? defaultConnection(isProviderId(c.provider) ? c.provider : current.provider), c);
    }
  }
  next.updatedAt = now.toISOString();
  return next;
}

export async function saveAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  const file = aiSettingsFile();
  return withLock(file, async () => {
    const next = applyAiPatch(cleanAiSettings(await readJson<unknown>(file, null)), patch);
    await writeJsonAtomic(file, next, true);
    return next;
  });
}

/** A deleted account's AI settings go with it: its own key, and its place on the site key. */
export async function forgetAiAccount(userId: string) {
  const file = aiSettingsFile();
  await withLock(file, async () => {
    const raw = await readJson<unknown>(file, null);
    if (!raw) return;
    const settings = cleanAiSettings(raw);
    if (!settings.accounts[userId] && !settings.allowedUserIds.includes(userId)) return;
    delete settings.accounts[userId];
    settings.allowedUserIds = settings.allowedUserIds.filter((id) => id !== userId);
    await writeJsonAtomic(file, settings, true);
  });
}
