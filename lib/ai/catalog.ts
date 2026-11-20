import fs from 'fs/promises';
import path from 'path';
import { readJson, withLock, writeJsonAtomic } from '@/lib/json-store';
import type { Provider } from './providers';
import { resolveChoice, type CatalogModel, type ProviderId } from './providers-list';
import { USER_ID_RE, choiceFor, keyHint, type ActiveConnection, type AiConnection } from './settings';
import type { AiTask } from './tasks';

// What a provider says a key can use, kept for a day: what the admin page lists, and
// what "Newest Flash"-style choices pick from, so a model released tomorrow shows up
// without a site update. One list per connection (the site's, and each account's own
// key). Lives in .data/ai with the keys, so backups skip it too.

export type Catalog = { provider: ProviderId; keyHint: string; fetchedAt: string; models: CatalogModel[] };

export const CATALOG_MAX_AGE_MS = 24 * 60 * 60_000;

/** Where a connection's list is kept: "site", or "user:<id>". */
export function catalogFile(scope = 'site') {
  const id = scope.startsWith('user:') ? scope.slice(5) : '';
  if (id && !USER_ID_RE.test(id)) throw new Error('Bad account id');
  return path.join(process.cwd(), '.data', 'ai', id ? `models-${id}.json` : 'models.json');
}

function belongsTo(catalog: Catalog | null, conn: AiConnection): catalog is Catalog {
  return !!catalog && catalog.provider === conn.provider && catalog.keyHint === keyHint(conn.apiKey) && Array.isArray(catalog.models);
}

/** The saved list for this connection, however old; null when there's none for its provider and key. */
export async function savedCatalog(conn: ActiveConnection): Promise<Catalog | null> {
  const catalog = await readJson<Catalog | null>(catalogFile(conn.scope), null).catch(() => null);
  return belongsTo(catalog, conn) ? catalog : null;
}

/** Ask the provider for its models now and keep the answer. Throws AiError if it can't. */
export async function refreshCatalog(conn: ActiveConnection, provider: Provider, now = new Date()): Promise<Catalog> {
  const models = await provider.listModels({ apiKey: conn.apiKey, timeoutMs: 15_000 });
  const catalog: Catalog = { provider: conn.provider, keyHint: keyHint(conn.apiKey), fetchedAt: now.toISOString(), models };
  const file = catalogFile(conn.scope);
  await withLock(file, () => writeJsonAtomic(file, catalog, true));
  return catalog;
}

/**
 * The list to choose from: the saved one while it's under a day old, otherwise a
 * fresh one. If the provider can't be reached the old list (or none) is used, so a
 * failed refresh never stops a reply.
 */
export async function currentCatalog(conn: ActiveConnection, provider: Provider, now = Date.now()): Promise<Catalog | null> {
  const saved = await savedCatalog(conn);
  if (!conn.apiKey) return saved;
  if (saved && now - Date.parse(saved.fetchedAt) < CATALOG_MAX_AGE_MS) return saved;
  try {
    return await refreshCatalog(conn, provider, new Date(now));
  } catch {
    console.warn('AI model list could not be refreshed');
    return saved;
  }
}

/** The model a task uses right now. */
export function modelForTask(conn: AiConnection, catalog: Catalog | null, task?: AiTask): CatalogModel {
  return resolveChoice(conn.provider, choiceFor(conn, task), catalog?.models ?? []);
}

/** Drop an account's saved model list (its key was taken away, or the account deleted). */
export async function forgetCatalog(userId: string) {
  if (!USER_ID_RE.test(userId)) return;
  await fs.rm(catalogFile(`user:${userId}`), { force: true }).catch(() => {});
}
