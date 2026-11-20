// The providers the AI connection knows, and how a model is chosen. No SDK code
// here, so the admin page can use the same list. Adding a provider (an
// OpenAI-compatible endpoint, say) means an entry here and a provider in providers.ts.
//
// Models stay current two ways: the admin page lists what the provider says it has
// right now (fetched with the key, refreshed daily), and the "Newest …" choices
// resolve to the newest model of a family each time, so a new release is picked up
// without touching the settings. The fixed lists below are only the fallback for
// before the first fetch (Gemini ids from Google's model and pricing pages, Nov 2026).

export type ProviderId = 'anthropic' | 'gemini';

/** A model as a provider lists it. */
export type CatalogModel = { id: string; label: string; createdAt?: string };

/** "Use the newest model whose id matches": stored as `auto:<key>`. */
export type AutoChoice = { key: string; label: string; hint?: string; pattern: string; fallback: string };

export type ProviderInfo = {
  label: string;
  /** Where to get a key, shown on the admin page. */
  keyUrl: string;
  keyPlaceholder: string;
  /** Said on the admin page when this provider is picked. */
  note?: string;
  defaultModel: string;
  autos: AutoChoice[];
  /** Used until the provider's own list has been fetched. */
  models: CatalogModel[];
};

export const AUTO_PREFIX = 'auto:';

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    defaultModel: 'auto:opus',
    autos: [
      { key: 'opus', label: 'Newest Opus', hint: 'best all-round', pattern: '^claude-opus-\\d', fallback: 'claude-opus-5-5' },
      { key: 'sonnet', label: 'Newest Sonnet', hint: 'cheaper, quicker', pattern: '^claude-sonnet-\\d', fallback: 'claude-sonnet-5-5' },
      { key: 'haiku', label: 'Newest Haiku', hint: 'cheapest, fastest', pattern: '^claude-haiku-\\d', fallback: 'claude-haiku-5-5' },
    ],
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
    ],
  },
  gemini: {
    label: 'Google Gemini (AI Studio)',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    note: 'On Google’s free tier, what you send (study notes, recipes, recording transcripts) may be used to improve Google’s products, and the free quota runs out after so many replies a minute and a day. A key with billing turned on isn’t used that way. Not every model has a free tier: Flash and Flash-Lite do.',
    defaultModel: 'auto:flash',
    autos: [
      { key: 'flash', label: 'Newest Flash', hint: 'free tier', pattern: '^gemini-\\d+(\\.\\d+)?-flash$', fallback: 'gemini-3.8-flash' },
      { key: 'flash-lite', label: 'Newest Flash-Lite', hint: 'free tier, fastest', pattern: '^gemini-\\d+(\\.\\d+)?-flash-lite$', fallback: 'gemini-3.5-flash-lite' },
    ],
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'anthropic';

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/** Version numbers in an id, for ordering when the provider gives no dates: "gemini-3.10-flash" → [3, 10]. */
function versionOf(id: string): number[] {
  const m = id.match(/(\d+(?:[.-]\d+)*)/);
  return m ? m[1].split(/[.-]/).map(Number) : [];
}

/** Sort order: newest first (by date when the provider gives one, else by version number). */
export function newerFirst(a: CatalogModel, b: CatalogModel) {
  if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  const va = versionOf(a.id), vb = versionOf(b.id);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? -1) - (va[i] ?? -1);
    if (d) return d;
  }
  return a.id.length - b.id.length;
}

/** The newest model in `models` matching `auto`, or its fallback when none does. */
export function newestFor(auto: AutoChoice, models: CatalogModel[]): CatalogModel {
  const re = new RegExp(auto.pattern);
  const found = models.filter((m) => re.test(m.id)).sort(newerFirst)[0];
  return found ?? { id: auto.fallback, label: auto.fallback };
}

/** What a stored choice means right now: an exact id stays as it is; `auto:…` becomes the newest match. */
export function resolveChoice(provider: ProviderId, choice: string, models: CatalogModel[]): CatalogModel {
  const info = PROVIDERS[provider];
  const list = models.length ? models : info.models;
  if (choice.startsWith(AUTO_PREFIX)) {
    const auto = info.autos.find((a) => `${AUTO_PREFIX}${a.key}` === choice) ?? info.autos[0];
    return newestFor(auto, list);
  }
  return list.find((m) => m.id === choice) ?? info.models.find((m) => m.id === choice) ?? { id: choice, label: choice };
}
