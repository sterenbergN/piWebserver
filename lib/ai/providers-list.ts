// The providers the AI connection knows, and their models. No SDK code here, so the
// admin page can show the same list. Adding one (an OpenAI-compatible endpoint,
// say) means an entry here and a `generate`/`check` pair in providers.ts.

export type ProviderId = 'anthropic';

export type ProviderInfo = {
  label: string;
  /** Where to get a key, shown on the admin page. */
  keyUrl: string;
  keyPlaceholder: string;
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
};

export const DEFAULT_PROVIDER: ProviderId = 'anthropic';

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
