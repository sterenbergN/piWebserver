import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import type { SourceId } from './sources/types';

// The food tracker's site-wide settings, set in Admin → Food: the FatSecret
// client id and secret, which sources are on, and how each remote source last
// went. The secret never leaves the server: the admin page only sees its last
// four characters.

export const FOOD_DIR = () => path.join(process.cwd(), '.data', 'food');
export const foodSettingsFile = () => path.join(FOOD_DIR(), 'settings.json');

export type RemoteSource = 'fatsecret' | 'off';
export type SourceStatus = { lastOkAt?: string; lastErrorAt?: string; lastError?: string };

export type FoodAdminSettings = {
  fatsecret: { clientId: string; clientSecret: string };
  /** Each source on or off. USDA and the library can't be turned off together (something must answer). */
  sources: Record<Exclude<SourceId, 'library'>, boolean>;
  /**
   * Keep FatSecret foods in the library for good. FatSecret's terms allow keeping
   * only its ids, and other data for up to 24 hours, so this is off by default:
   * copies older than a day are dropped and fetched again when needed.
   */
  keepFatSecretCopies: boolean;
  status: Partial<Record<RemoteSource, SourceStatus>>;
  updatedAt?: string;
};

export type FoodAdminPublic = Omit<FoodAdminSettings, 'fatsecret'> & {
  fatsecret: { clientId: string; hasSecret: boolean; secretHint: string; configured: boolean };
};

const MAX_CRED = 200;
const CRED = /^[\x21-\x7e]*$/;

export class FoodSettingsError extends Error {}

export const defaultFoodSettings = (): FoodAdminSettings => ({
  fatsecret: { clientId: '', clientSecret: '' },
  sources: { usda: true, fatsecret: true, off: true },
  keepFatSecretCopies: false,
  status: {},
});

function cleanStatus(raw: unknown): SourceStatus {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: SourceStatus = {};
  if (typeof r.lastOkAt === 'string') out.lastOkAt = r.lastOkAt;
  if (typeof r.lastErrorAt === 'string') out.lastErrorAt = r.lastErrorAt;
  if (typeof r.lastError === 'string') out.lastError = r.lastError.slice(0, 300);
  return out;
}

export function cleanFoodSettings(raw: unknown): FoodAdminSettings {
  const d = defaultFoodSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const cred = (v: unknown) => (typeof v === 'string' && CRED.test(v.trim()) ? v.trim().slice(0, MAX_CRED) : '');
  return {
    fatsecret: { clientId: cred(r.fatsecret?.clientId), clientSecret: cred(r.fatsecret?.clientSecret) },
    sources: {
      usda: r.sources?.usda !== false,
      fatsecret: r.sources?.fatsecret !== false,
      off: r.sources?.off !== false,
    },
    keepFatSecretCopies: r.keepFatSecretCopies === true,
    status: { fatsecret: cleanStatus(r.status?.fatsecret), off: cleanStatus(r.status?.off) },
    ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
  };
}

export const secretHint = (secret: string) => (secret ? `…${secret.slice(-4)}` : '');

export function toPublicFoodSettings(s: FoodAdminSettings): FoodAdminPublic {
  return {
    ...s,
    fatsecret: {
      clientId: s.fatsecret.clientId,
      hasSecret: !!s.fatsecret.clientSecret,
      secretHint: secretHint(s.fatsecret.clientSecret),
      configured: !!(s.fatsecret.clientId && s.fatsecret.clientSecret),
    },
  };
}

// Settings are read on every search, so they're kept in memory and re-read only after a save here.
let cached: { at: number; value: FoodAdminSettings } | null = null;

export async function getFoodSettings(): Promise<FoodAdminSettings> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = cleanFoodSettings(await readJson<unknown>(foodSettingsFile(), null));
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Apply the admin's changes. A blank secret keeps the saved one; `clearFatSecret`
 * removes both id and secret.
 */
export async function saveFoodSettings(patch: Record<string, any>): Promise<FoodAdminSettings> {
  const result = await updateJson<Record<string, unknown>, FoodAdminSettings>(foodSettingsFile(), {}, (stored) => {
    const current = cleanFoodSettings(stored);
    const next: FoodAdminSettings = { ...current, fatsecret: { ...current.fatsecret }, sources: { ...current.sources } };
    if (patch.clearFatSecret === true) next.fatsecret = { clientId: '', clientSecret: '' };
    else if (patch.fatsecret && typeof patch.fatsecret === 'object') {
      const { clientId, clientSecret } = patch.fatsecret as Record<string, unknown>;
      if (typeof clientId === 'string') {
        if (!CRED.test(clientId.trim()) || clientId.length > MAX_CRED) throw new FoodSettingsError('That client id has characters it can’t have.');
        next.fatsecret.clientId = clientId.trim();
      }
      if (typeof clientSecret === 'string' && clientSecret.trim()) {
        if (!CRED.test(clientSecret.trim()) || clientSecret.length > MAX_CRED) throw new FoodSettingsError('That client secret has characters it can’t have.');
        next.fatsecret.clientSecret = clientSecret.trim();
      }
    }
    if (patch.sources && typeof patch.sources === 'object') {
      for (const key of ['usda', 'fatsecret', 'off'] as const) {
        if (typeof patch.sources[key] === 'boolean') next.sources[key] = patch.sources[key];
      }
    }
    if (typeof patch.keepFatSecretCopies === 'boolean') next.keepFatSecretCopies = patch.keepFatSecretCopies;
    next.updatedAt = new Date().toISOString();
    for (const key of Object.keys(stored)) delete stored[key];
    Object.assign(stored, next);
    return next;
  }, true);
  cached = { at: Date.now(), value: result };
  return result;
}

// How remote sources went, written only when it changes from working to failing
// (or back), or every ten minutes, so a busy day of searches isn't a write each time.
const lastWritten: Partial<Record<RemoteSource, { ok: boolean; at: number }>> = {};

export async function recordSourceStatus(source: RemoteSource, ok: boolean, error?: string) {
  const prev = lastWritten[source];
  if (prev && prev.ok === ok && Date.now() - prev.at < 10 * 60_000) return;
  lastWritten[source] = { ok, at: Date.now() };
  try {
    const value = await updateJson<Record<string, any>, FoodAdminSettings>(foodSettingsFile(), {}, (stored) => {
      const current = cleanFoodSettings(stored);
      const now = new Date().toISOString();
      const status = { ...current.status[source] };
      if (ok) status.lastOkAt = now;
      else { status.lastErrorAt = now; status.lastError = (error || 'Failed').slice(0, 300); }
      current.status = { ...current.status, [source]: status };
      for (const key of Object.keys(stored)) delete stored[key];
      Object.assign(stored, current);
      return current;
    }, true);
    cached = { at: Date.now(), value };
  } catch {
    // Status is only informational; never fail a search over it.
  }
}
