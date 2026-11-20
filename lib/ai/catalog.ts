import path from 'path';
import { readJson, withLock, writeJsonAtomic } from '@/lib/json-store';
import type { Provider } from './providers';
import { resolveChoice, type CatalogModel, type ProviderId } from './providers-list';
import { choiceFor, keyHint, type AiSettings } from './settings';
import type { AiTask } from './tasks';

// What the provider says it has, kept for a day. It's what the admin page lists and
// what "Newest Flash"-style choices pick from, so a model released tomorrow shows up
// without a site update. Lives in .data/ai with the key, so backups skip it too.

export type Catalog = { provider: ProviderId; keyHint: string; fetchedAt: string; models: CatalogModel[] };

export const CATALOG_MAX_AGE_MS = 24 * 60 * 60_000;
export const catalogFile = () => path.join(process.cwd(), '.data', 'ai', 'models.json');

function belongsTo(catalog: Catalog | null, settings: AiSettings): catalog is Catalog {
  return !!catalog && catalog.provider === settings.provider && catalog.keyHint === keyHint(settings.apiKey) && Array.isArray(catalog.models);
}

/** The saved list for these settings, however old; null when there's none for this provider and key. */
export async function savedCatalog(settings: AiSettings): Promise<Catalog | null> {
  const catalog = await readJson<Catalog | null>(catalogFile(), null).catch(() => null);
  return belongsTo(catalog, settings) ? catalog : null;
}

/** Ask the provider for its models now and keep the answer. Throws AiError if it can't. */
export async function refreshCatalog(settings: AiSettings, provider: Provider, now = new Date()): Promise<Catalog> {
  const models = await provider.listModels({ apiKey: settings.apiKey, timeoutMs: 15_000 });
  const catalog: Catalog = { provider: settings.provider, keyHint: keyHint(settings.apiKey), fetchedAt: now.toISOString(), models };
  await withLock(catalogFile(), () => writeJsonAtomic(catalogFile(), catalog, true));
  return catalog;
}

/**
 * The list to choose from: the saved one while it's under a day old, otherwise a
 * fresh one. If the provider can't be reached the old list (or none) is used, so a
 * failed refresh never stops a reply.
 */
export async function currentCatalog(settings: AiSettings, provider: Provider, now = Date.now()): Promise<Catalog | null> {
  const saved = await savedCatalog(settings);
  if (!settings.apiKey) return saved;
  if (saved && now - Date.parse(saved.fetchedAt) < CATALOG_MAX_AGE_MS) return saved;
  try {
    return await refreshCatalog(settings, provider, new Date(now));
  } catch {
    console.warn('AI model list could not be refreshed');
    return saved;
  }
}

/** The model a task uses right now. */
export function modelForTask(settings: AiSettings, catalog: Catalog | null, task?: AiTask): CatalogModel {
  return resolveChoice(settings.provider, choiceFor(settings, task), catalog?.models ?? []);
}
