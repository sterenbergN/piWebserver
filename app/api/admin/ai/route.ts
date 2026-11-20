import { NextResponse } from 'next/server';
import { currentCatalog, forgetCatalog, refreshCatalog, type Catalog } from '@/lib/ai/catalog';
import { AiError, providerFor } from '@/lib/ai/providers';
import { PROVIDERS, isProviderId, resolveChoice } from '@/lib/ai/providers-list';
import { AiSettingsError, USER_ID_RE, getAiSettings, saveAiSettings, siteConnection, toPublic, type ActiveConnection, type AiConnection, type AiSettings } from '@/lib/ai/settings';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { loadUsersData } from '@/lib/workout/users';

export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

/** The site's accounts, to give AI to. */
async function accounts() {
  const data = await loadUsersData().catch(() => ({ users: [], deletedUserIds: [] as string[] }));
  const deleted = new Set(data.deletedUserIds ?? []);
  return data.users.filter((u) => !deleted.has(u.id)).map((u) => ({ id: u.id, username: u.username }));
}

/** The model list as the page needs it (no key hint). */
const publicCatalog = (c: Catalog | null) => (c ? { provider: c.provider, fetchedAt: c.fetchedAt, models: c.models } : null);

/** The connection for "site" or an account id, as saved. */
function savedConnection(settings: AiSettings, account?: string): ActiveConnection | null {
  if (!account) return { ...siteConnection(settings), scope: 'site' };
  const conn = settings.accounts[account];
  return conn ? { ...conn, scope: `user:${account}` } : null;
}

async function listFor(conn: ActiveConnection | null) {
  return conn?.apiKey ? publicCatalog(await currentCatalog(conn, providerFor(conn.provider)).catch(() => null)) : null;
}

/** Everything the page shows: settings without keys, accounts, and each connection's models. */
async function view(settings: AiSettings) {
  const catalogs: Record<string, ReturnType<typeof publicCatalog>> = { site: await listFor(savedConnection(settings)) };
  for (const id of Object.keys(settings.accounts)) catalogs[id] = await listFor(savedConnection(settings, id));
  return { settings: toPublic(settings), providers: PROVIDERS, accounts: await accounts(), catalogs };
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  return NextResponse.json(await view(await getAiSettings()));
}

/** Save the site's connection, who shares it, accounts' own keys and the on/off switch. A blank key keeps the saved one. */
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const patch = await request.json();
    const before = await getAiSettings();
    const settings = await saveAiSettings(patch ?? {});
    // An account whose own key went away loses its saved model list too.
    for (const id of Object.keys(before.accounts)) if (!settings.accounts[id]?.apiKey) await forgetCatalog(id);
    return NextResponse.json(await view(settings));
  } catch (error) {
    if (error instanceof AiSettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    console.error('Saving the AI settings failed');
    return NextResponse.json({ error: 'Couldn’t save the AI settings.' }, { status: 500 });
  }
}

/**
 * `{ action: 'models', account? }` fetches a connection's model list again now.
 * Otherwise it tests a connection (the site's, or `account`'s): the key typed into
 * the form if there is one, otherwise the saved key, with the chosen provider and
 * model. Nothing is saved.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; account?: unknown; provider?: unknown; model?: unknown; apiKey?: unknown };
  const account = typeof body.account === 'string' && body.account ? body.account : undefined;
  if (account && !USER_ID_RE.test(account)) return NextResponse.json({ ok: false, error: 'Unknown account.' });
  const settings = await getAiSettings();
  const saved: AiConnection | null = savedConnection(settings, account);

  if (body.action === 'models') {
    const conn = savedConnection(settings, account);
    if (!conn?.apiKey) return NextResponse.json({ ok: false, error: 'Save a key first.' });
    try {
      return NextResponse.json({ ok: true, catalog: publicCatalog(await refreshCatalog(conn, providerFor(conn.provider))) });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof AiError ? error.message : 'Couldn’t reach the AI provider.' });
    }
  }

  const provider = isProviderId(body.provider) ? body.provider : saved?.provider ?? settings.provider;
  const choice = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : saved?.model ?? PROVIDERS[provider].defaultModel;
  // A saved key only ever goes to the provider it was saved for.
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : saved && provider === saved.provider ? saved.apiKey : '';
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
