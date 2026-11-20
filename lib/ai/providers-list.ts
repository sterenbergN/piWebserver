// The providers the AI connection knows, and their models. No SDK code here, so the
// admin page can show the same list. Adding one (an OpenAI-compatible endpoint,
// say) means an entry here and a `generate`/`check` pair in providers.ts.
// Gemini model ids are from Google's model and pricing pages, November 2026.

export type ProviderId = 'anthropic' | 'gemini';

export type ProviderInfo = {
  label: string;
  /** Where to get a key, shown on the admin page. */
  keyUrl: string;
  keyPlaceholder: string;
  /** Said on the admin page when this provider is picked. */
  note?: string;
  defaultModel: string;
  models: { id: string; label: string }[];
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    defaultModel: 'claude-opus-5-5',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best all-round)' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper, quicker)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest, fastest)' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (most capable, costs most)' },
    ],
  },
  gemini: {
    label: 'Google Gemini (AI Studio)',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    note: 'On Google’s free tier, what you send (study notes, recipes, recording transcripts) may be used to improve Google’s products, and the free quota runs out after so many replies a minute and a day. A key with billing turned on isn’t used that way.',
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (free tier)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (free tier)' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (free tier, fastest)' },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (free tier)' },
    ],
  },
};

export const DEFAULT_PROVIDER: ProviderId = 'anthropic';

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
