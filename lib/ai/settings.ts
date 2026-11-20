import path from 'path';
import { readJson, withLock, writeJsonAtomic } from '@/lib/json-store';
import { DEFAULT_PROVIDER, PROVIDERS, isProviderId, type ProviderId } from './providers-list';

// The site owner's connection to an AI provider, for the copy-prompt / paste-reply
// features. The key lives only here on the server: it's never sent to a browser
// (the admin page sees the last four characters), never logged, and backups and
// account exports leave the whole .data/ai folder out.

export type AiSettings = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** Off keeps the key but hides Generate everywhere. */
  enabled: boolean;
  /**
   * Accounts that may use it. Whoever is signed in to Admin always may; nobody
   * else does unless ticked here, so the owner's key isn't shared by default.
   */
  allowedUserIds: string[];
  updatedAt?: string;
};

/** Who's asking: a signed-in account, the admin, or both in one browser. */
export type AiCaller = { userId: string | null; isAdmin: boolean };

/** What the admin page may see. */
export type AiPublicSettings = Omit<AiSettings, 'apiKey'> & { hasKey: boolean; keyHint: string };

export const AI_FOLDER = '.data/ai/';
export const aiSettingsFile = () => path.join(process.cwd(), '.data', 'ai', 'settings.json');

const MAX_KEY = 400;
const MAX_ALLOWED = 50;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

export class AiSettingsError extends Error {}

export function defaultAiSettings(): AiSettings {
  return { provider: DEFAULT_PROVIDER, model: PROVIDERS[DEFAULT_PROVIDER].defaultModel, apiKey: '', enabled: true, allowedUserIds: [] };
}

/** Whatever was stored, made safe to use: unknown providers and odd values fall back to the defaults. */
export function cleanAiSettings(raw: unknown): AiSettings {
  const base = defaultAiSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const provider = isProviderId(r.provider) ? r.provider : base.provider;
  const model = typeof r.model === 'string' && MODEL_RE.test(r.model.trim()) ? r.model.trim() : PROVIDERS[provider].defaultModel;
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim().slice(0, MAX_KEY) : '';
  return {
    provider,
    model,
    apiKey,
    enabled: r.enabled !== false,
    allowedUserIds: cleanUserIds(r.allowedUserIds),
    ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
  };
}

function cleanUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && USER_ID_RE.test(v)))].slice(0, MAX_ALLOWED);
}

export async function getAiSettings(): Promise<AiSettings> {
  return cleanAiSettings(await readJson<unknown>(aiSettingsFile(), null));
}

export function keyHint(apiKey: string) {
  return apiKey ? `…${apiKey.slice(-4)}` : '';
}

export function toPublic(settings: AiSettings): AiPublicSettings {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasKey: !!apiKey, keyHint: keyHint(apiKey) };
}

/** Ready to call: switched on, with a key. */
export function isAiReady(settings: AiSettings) {
  return settings.enabled && !!settings.apiKey;
}

/** Whether this caller may use the key: the admin, or an account the admin ticked. */
export function mayUseAi(settings: AiSettings, caller: AiCaller) {
  return caller.isAdmin || (!!caller.userId && settings.allowedUserIds.includes(caller.userId));
}

export type AiSettingsPatch = {
  provider?: unknown;
  model?: unknown;
  /** A new key. Left out or blank keeps the saved one. */
  apiKey?: unknown;
  /** True forgets the saved key. */
  clearKey?: unknown;
  enabled?: unknown;
  allowedUserIds?: unknown;
};

/** Check a change from the admin page and apply it to `current`. Throws AiSettingsError on bad input. */
export function applyAiPatch(current: AiSettings, patch: AiSettingsPatch, now = new Date()): AiSettings {
  const next = { ...current };
  if (patch.provider !== undefined) {
    if (!isProviderId(patch.provider)) throw new AiSettingsError('Unknown provider.');
    const info = PROVIDERS[patch.provider];
    if (patch.provider !== next.provider) {
      next.model = info.defaultModel;
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
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.allowedUserIds !== undefined) {
    if (!Array.isArray(patch.allowedUserIds)) throw new AiSettingsError('Pick accounts from the list.');
    next.allowedUserIds = cleanUserIds(patch.allowedUserIds);
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
