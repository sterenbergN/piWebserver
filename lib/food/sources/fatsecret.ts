import { per100FromServings, round, toNumber } from '../nutrients';
import type { Food, Nutrients, Serving } from '../types';
import { getFoodSettings, recordSourceStatus } from '../settings';
import { fetchWithTimeout, SourceError, USER_AGENT, type FoodSourceAdapter } from './types';

// FatSecret Platform API (https://platform.fatsecret.com/docs), the main
// remote source when the admin has entered a client id and secret.
//
// - OAuth 2.0 client credentials: POST https://oauth.fatsecret.com/connect/token
//   with Basic auth. No scope asked for, so the token carries every scope the
//   key has (basic, premier, barcode…). Tokens last a day; one is kept in memory
//   until a minute before it expires.
// - Calls go to https://platform.fatsecret.com/rest/<path> with a Bearer token.
//   foods.search v6 (/foods/search/v6) includes servings but is Premier; the
//   Basic plan gets v1 (/foods/search/v1), which only has a one-line summary,
//   so those results are marked partial and the full food is fetched with
//   food.get (/food/v5, then /food/v4) when picked. Barcodes
//   (/food/barcode/find-by-id/v3) need the Premier and barcode scopes.
// - FatSecret only answers requests from IP addresses listed on the key, so a
//   new server (or a changed home IP) fails until it's added there.
// - Errors come back as { error: { code, message } } with HTTP 200.

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API = 'https://platform.fatsecret.com/rest/';
const TIMEOUT_MS = 5000;

// ─── Normalising (pure) ─────────────────────────────────────────────────────

/** FatSecret sends a lone item as an object and several as an array. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

type RawServing = Record<string, string | number | undefined>;
type RawFood = { food_id?: string | number; food_name?: string; brand_name?: string; food_type?: string; food_description?: string; servings?: { serving?: RawServing | RawServing[] } };

function servingNutrients(s: RawServing): Nutrients | null {
  const kcal = toNumber(s.calories);
  if (kcal === null) return null;
  const n: Nutrients = {
    kcal: Math.round(kcal),
    protein: round(toNumber(s.protein) ?? 0),
    carbs: round(toNumber(s.carbohydrate) ?? 0),
    fat: round(toNumber(s.fat) ?? 0),
  };
  const opt: [keyof Nutrients, unknown][] = [['fiber', s.fiber], ['sugar', s.sugar], ['sodium', s.sodium], ['satFat', s.saturated_fat]];
  for (const [key, v] of opt) {
    const num = toNumber(v);
    if (num !== null) n[key] = key === 'sodium' ? Math.round(num) : round(num);
  }
  return n;
}

export function normalizeFatSecretServing(s: RawServing): Serving | null {
  const nutrients = servingNutrients(s);
  const id = s.serving_id !== undefined ? String(s.serving_id) : '';
  if (!nutrients || !/^[\w.-]{1,40}$/.test(id)) return null;
  const amount = toNumber(s.metric_serving_amount);
  const unit = String(s.metric_serving_unit || '').toLowerCase();
  const description = String(s.serving_description || '').trim() || '1 serving';
  const serving: Serving = { id, label: description.slice(0, 80), nutrients };
  if (amount && amount > 0) {
    if (unit === 'g') serving.grams = round(amount, 2);
    else if (unit === 'ml') serving.ml = round(amount, 2);
    else if (unit === 'oz') serving.grams = round(amount * 28.3495, 2);
    const metric = serving.grams ? `${round(serving.grams)} g` : serving.ml ? `${round(serving.ml)} ml` : '';
    // "1 cup" → "1 cup (240 g)", but "100 g" stays as it is.
    if (metric && !/\d\s*(g|ml|oz)\b/i.test(description)) serving.label = `${description} (${metric})`.slice(0, 80);
  }
  return serving;
}

/** A food.get / foods.search v6 / barcode food as a Food. */
export function normalizeFatSecretFood(raw: RawFood): Food | null {
  const id = raw?.food_id !== undefined ? String(raw.food_id) : '';
  const name = String(raw?.food_name || '').trim();
  if (!/^\d{1,20}$/.test(id) || !name) return null;
  const rawServings = asArray(raw.servings?.serving);
  // The suggested serving first (Premier flags it), the rest as FatSecret ordered them.
  rawServings.sort((a, b) => Number(b.is_default === '1' || b.is_default === 1) - Number(a.is_default === '1' || a.is_default === 1));
  const servings = rawServings.map(normalizeFatSecretServing).filter((s): s is Serving => !!s).slice(0, 20);
  if (!servings.length) return null;
  const food: Food = { id: `fatsecret:${id}`, source: 'fatsecret', sourceId: id, name: name.slice(0, 120), servings };
  if (raw.brand_name) food.brand = String(raw.brand_name).slice(0, 80);
  const hundred = servings.find((s) => s.grams === 100 || s.ml === 100);
  const per100 = hundred ? hundred.nutrients : per100FromServings(servings);
  if (per100) food.per100 = per100;
  return food;
}

/**
 * foods.search v1's one-line summary ("Per 100g - Calories: 52kcal | Fat: 0.17g |
 * Carbs: 13.81g | Protein: 0.26g") as a single serving, so a Basic-plan result
 * can show calories before the full food is fetched.
 */
export function parseFoodDescription(description: string): Serving | null {
  const m = description.match(/^Per\s+(.+?)\s+-\s+(.*)$/i);
  if (!m) return null;
  const label = m[1].trim();
  const value = (key: string) => {
    const hit = m[2].match(new RegExp(`${key}:\\s*([\\d.]+)`, 'i'));
    return hit ? Number(hit[1]) : null;
  };
  const kcal = value('Calories');
  if (kcal === null) return null;
  const serving: Serving = {
    id: 'summary',
    label,
    nutrients: { kcal: Math.round(kcal), protein: round(value('Protein') ?? 0), carbs: round(value('Carbs') ?? 0), fat: round(value('Fat') ?? 0) },
  };
  const grams = label.match(/^([\d.]+)\s*g$/i);
  const ml = label.match(/^([\d.]+)\s*ml$/i);
  if (grams) serving.grams = Number(grams[1]);
  else if (ml) serving.ml = Number(ml[1]);
  return serving;
}

/** A foods.search v1 result: name and summary only, marked partial. */
export function normalizeFatSecretSummary(raw: RawFood): Food | null {
  const id = raw?.food_id !== undefined ? String(raw.food_id) : '';
  const name = String(raw?.food_name || '').trim();
  const serving = parseFoodDescription(String(raw?.food_description || ''));
  if (!/^\d{1,20}$/.test(id) || !name || !serving) return null;
  const food: Food = { id: `fatsecret:${id}`, source: 'fatsecret', sourceId: id, name: name.slice(0, 120), servings: [serving], partial: true };
  if (raw.brand_name) food.brand = String(raw.brand_name).slice(0, 80);
  return food;
}

/** What a FatSecret error code means for us. */
export function classifyFatSecretError(code: number, message = ''): SourceError {
  const text = `FatSecret said: ${message || `error ${code}`}`;
  if (code === 21 || /\bip\b|ip address/i.test(message)) {
    return new SourceError('fatsecret', 'ip', `${text}. Add this server’s public IP address to the key’s allowed list on platform.fatsecret.com.`);
  }
  if (code === 14 || code === 12 || /scope|premier|not permitted|permission/i.test(message)) return new SourceError('fatsecret', 'not-permitted', text);
  if ((code >= 2 && code <= 9) || code === 13) return new SourceError('fatsecret', 'auth', text);
  if (code === 22 || /limit|too many/i.test(message)) return new SourceError('fatsecret', 'rate-limited', text);
  return new SourceError('fatsecret', 'unavailable', text);
}

// ─── Talking to FatSecret ───────────────────────────────────────────────────

type Credentials = { clientId: string; clientSecret: string };
let token: { key: string; value: string; expiresAt: number } | null = null;

async function credentials(): Promise<Credentials> {
  const settings = await getFoodSettings();
  if (!settings.sources.fatsecret) throw new SourceError('fatsecret', 'off', 'FatSecret is switched off.');
  if (!settings.fatsecret.clientId || !settings.fatsecret.clientSecret) throw new SourceError('fatsecret', 'off', 'FatSecret isn’t set up.');
  return settings.fatsecret;
}

async function getToken(creds: Credentials, force = false): Promise<string> {
  const key = `${creds.clientId}:${creds.clientSecret.slice(-6)}`;
  if (!force && token && token.key === key && Date.now() < token.expiresAt) return token.value;
  const res = await fetchWithTimeout('fatsecret', TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  }, TIMEOUT_MS);
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (!res.ok || !json?.access_token) {
    const reason = json?.error_description || json?.error || `HTTP ${res.status}`;
    if (/ip/i.test(reason)) throw new SourceError('fatsecret', 'ip', `FatSecret refused this server’s IP address (${reason}). Add it to the key’s allowed list.`);
    if (json?.error === 'invalid_client' || res.status === 401) throw new SourceError('fatsecret', 'auth', 'FatSecret didn’t accept the client id and secret.');
    throw new SourceError('fatsecret', 'unavailable', `FatSecret wouldn’t give a token (${reason}).`);
  }
  const lifetime = Math.max(60, Number(json.expires_in) || 3600);
  token = { key, value: json.access_token, expiresAt: Date.now() + (lifetime - 60) * 1000 };
  return token.value;
}

/** GET a REST path with the token; one retry with a new token if FatSecret says the old one is bad. */
async function call(pathName: string, params: Record<string, string>, creds?: Credentials): Promise<Record<string, any>> {
  const c = creds ?? (await credentials());
  const url = `${API}${pathName}?${new URLSearchParams({ ...params, format: 'json' })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const access = await getToken(c, attempt > 0);
    const res = await fetchWithTimeout('fatsecret', url, { headers: { Authorization: `Bearer ${access}`, 'User-Agent': USER_AGENT, Accept: 'application/json' } }, TIMEOUT_MS);
    const json = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!json) throw new SourceError('fatsecret', 'unavailable', `FatSecret sent something unreadable (HTTP ${res.status}).`);
    if (json.error) {
      const code = Number(json.error.code);
      if (code === 13 && attempt === 0) continue;
      throw classifyFatSecretError(code, String(json.error.message || ''));
    }
    if (!res.ok) throw new SourceError('fatsecret', 'unavailable', `FatSecret answered HTTP ${res.status}.`);
    return json;
  }
  throw new SourceError('fatsecret', 'auth', 'FatSecret kept refusing the token.');
}

// The newest versions the key's plan allows, learned on first use (until restart or a new key).
let searchVersion: 'v6' | 'v1' = 'v6';
let getVersions: string[] = ['v5', 'v4'];

async function tracked<T>(work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    void recordSourceStatus('fatsecret', true);
    return result;
  } catch (error) {
    if (error instanceof SourceError && error.kind !== 'off' && error.kind !== 'not-permitted') void recordSourceStatus('fatsecret', false, error.message);
    throw error;
  }
}

async function searchFatSecret(query: string, limit: number): Promise<Food[]> {
  const params = { search_expression: query.slice(0, 100), max_results: String(Math.min(Math.max(limit, 1), 50)) };
  if (searchVersion === 'v6') {
    try {
      const json = await call('foods/search/v6', params);
      return asArray(json.foods_search?.results?.food).map(normalizeFatSecretFood).filter((f): f is Food => !!f);
    } catch (error) {
      if (!(error instanceof SourceError && error.kind === 'not-permitted')) throw error;
      searchVersion = 'v1';
    }
  }
  const json = await call('foods/search/v1', params);
  return asArray(json.foods?.food).map(normalizeFatSecretSummary).filter((f): f is Food => !!f);
}

async function getFatSecret(id: string): Promise<Food | null> {
  if (!/^\d{1,20}$/.test(id)) return null;
  for (const version of [...getVersions]) {
    try {
      const json = await call(`food/${version}`, { food_id: id });
      return normalizeFatSecretFood(json.food);
    } catch (error) {
      if (error instanceof SourceError && error.kind === 'not-permitted' && getVersions.length > 1) {
        getVersions = getVersions.filter((v) => v !== version);
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function barcodeFatSecret(gtin13: string): Promise<Food | null> {
  try {
    const json = await call('food/barcode/find-by-id/v3', { barcode: gtin13 });
    if (json.food) return normalizeFatSecretFood(json.food);
    const id = json.food_id?.value ?? json.food_id;
    return id && String(id) !== '0' ? getFatSecret(String(id)) : null;
  } catch (error) {
    // 211: "No food item detected" — just not in their database.
    if (error instanceof SourceError && /\b211\b|no food item/i.test(error.message)) return null;
    if (error instanceof SourceError && error.kind === 'not-permitted') {
      throw new SourceError('fatsecret', 'not-permitted', 'This FatSecret key can’t look up barcodes (that needs the Premier and barcode scopes).');
    }
    throw error;
  }
}

export const fatSecretSource: FoodSourceAdapter = {
  id: 'fatsecret',
  search: (query, limit) => tracked(() => searchFatSecret(query, limit)),
  get: (id) => tracked(() => getFatSecret(id)),
  barcode: (gtin13) => tracked(() => barcodeFatSecret(gtin13)),
};

/**
 * For Admin → Test connection: a token and one search with the given (or saved)
 * credentials, nothing saved. Says which search and barcode access the key has.
 */
export async function testFatSecret(creds: Credentials): Promise<{ message: string; premier: boolean }> {
  token = null;
  await getToken(creds, true);
  let premier = true;
  let json: Record<string, any>;
  try {
    json = await call('foods/search/v6', { search_expression: 'banana', max_results: '1' }, creds);
  } catch (error) {
    if (!(error instanceof SourceError && error.kind === 'not-permitted')) throw error;
    premier = false;
    json = await call('foods/search/v1', { search_expression: 'banana', max_results: '1' }, creds);
  }
  searchVersion = premier ? 'v6' : 'v1';
  getVersions = ['v5', 'v4'];
  const total = Number(json.foods_search?.total_results ?? json.foods?.total_results ?? 0);
  return {
    premier,
    message: premier
      ? `Connected with Premier search (${total.toLocaleString()} results for “banana”). Barcodes work if the key also has the barcode scope.`
      : `Connected on the Basic plan (${total.toLocaleString()} results for “banana”): search works and full details are fetched when a food is picked. Barcodes use Open Food Facts.`,
  };
}

/** Forget the token (after the key changes). */
export function resetFatSecret() {
  token = null;
  searchVersion = 'v6';
  getVersions = ['v5', 'v4'];
}
