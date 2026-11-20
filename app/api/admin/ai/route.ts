import { NextResponse } from 'next/server';
import { currentCatalog, refreshCatalog, type Catalog } from '@/lib/ai/catalog';
import { AiError, providerFor } from '@/lib/ai/providers';
import { PROVIDERS, isProviderId, resolveChoice } from '@/lib/ai/providers-list';
import { AiSettingsError, getAiSettings, saveAiSettings, toPublic, type AiSettings } from '@/lib/ai/settings';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { loadUsersData } from '@/lib/workout/users';

export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

/** The site's accounts, to pick who may use the AI. */
async function accounts() {
  const data = await loadUsersData().catch(() => ({ users: [], deletedUserIds: [] as string[] }));
  const deleted = new Set(data.deletedUserIds ?? []);
  return data.users.filter((u) => !deleted.has(u.id)).map((u) => ({ id: u.id, username: u.username }));
}

/** The model list as the page needs it (no key hint). */
const publicCatalog = (c: Catalog | null) => (c ? { provider: c.provider, fetchedAt: c.fetchedAt, models: c.models } : null);

async function catalogFor(settings: AiSettings) {
  return settings.apiKey ? currentCatalog(settings, providerFor(settings.provider)).catch(() => null) : null;
}

/** The AI connection, without the key (only its last four characters), and the models it can use. */
export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const settings = await getAiSettings();
  return NextResponse.json({ settings: toPublic(settings), providers: PROVIDERS, accounts: await accounts(), catalog: publicCatalog(await catalogFor(settings)) });
}

/** Save provider, models, key, who may use it or the on/off switch. A blank key keeps the saved one. */
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const patch = await request.json();
    const settings = await saveAiSettings(patch ?? {});
    return NextResponse.json({ settings: toPublic(settings), catalog: publicCatalog(await catalogFor(settings)) });
  } catch (error) {
    if (error instanceof AiSettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    console.error('Saving the AI settings failed');
    return NextResponse.json({ error: 'Couldn’t save the AI settings.' }, { status: 500 });
  }
}

/**
 * `{ action: 'models' }` fetches the saved key's model list again now.
 * Otherwise it tests the connection: the key typed into the form if there is one,
 * otherwise the saved key, with the chosen provider and model. Nothing is saved.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; provider?: unknown; model?: unknown; apiKey?: unknown };
  const saved = await getAiSettings();

  if (body.action === 'models') {
    if (!saved.apiKey) return NextResponse.json({ ok: false, error: 'Save a key first.' });
    try {
      return NextResponse.json({ ok: true, catalog: publicCatalog(await refreshCatalog(saved, providerFor(saved.provider))) });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof AiError ? error.message : 'Couldn’t reach the AI provider.' });
    }
  }

  const provider = isProviderId(body.provider) ? body.provider : saved.provider;
  const choice = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : saved.model;
  // The saved key only ever goes to the provider it was saved for.
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : provider === saved.provider ? saved.apiKey : '';
  if (!apiKey) return NextResponse.json({ ok: false, error: `Add a ${PROVIDERS[provider].label} API key first.` });
  try {
    // Listing the models proves the key, and turns "Newest …" into the model it means today.
    const models = await providerFor(provider).listModels({ apiKey, timeoutMs: 15_000 });
    const model = resolveChoice(provider, choice, models);
    const { modelLabel } = await providerFor(provider).check({ apiKey, model: model.id, timeoutMs: 15_000 });
    return NextResponse.json({ ok: true, message: `Connected. ${modelLabel} is ready, and this key can use ${models.length} model${models.length === 1 ? '' : 's'}.` });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof AiError ? error.message : 'Couldn’t reach the AI provider.' });
  }
}
