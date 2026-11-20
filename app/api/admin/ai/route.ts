import { NextResponse } from 'next/server';
import { AiError, providerFor } from '@/lib/ai/providers';
import { PROVIDERS, isProviderId } from '@/lib/ai/providers-list';
import { AiSettingsError, getAiSettings, saveAiSettings, toPublic } from '@/lib/ai/settings';
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

/** The AI connection, without the key (only its last four characters). */
export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  return NextResponse.json({ settings: toPublic(await getAiSettings()), providers: PROVIDERS, accounts: await accounts() });
}

/** Save provider, model, key or the on/off switch. A blank key keeps the saved one. */
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const patch = await request.json();
    return NextResponse.json({ settings: toPublic(await saveAiSettings(patch ?? {})) });
  } catch (error) {
    if (error instanceof AiSettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    console.error('Saving the AI settings failed');
    return NextResponse.json({ error: 'Couldn’t save the AI settings.' }, { status: 500 });
  }
}

/**
 * Test the connection: the key typed into the form if there is one, otherwise the
 * saved key, with the chosen provider and model. Nothing is saved.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; model?: unknown; apiKey?: unknown };
  const saved = await getAiSettings();
  const provider = isProviderId(body.provider) ? body.provider : saved.provider;
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : saved.model;
  // The saved key only ever goes to the provider it was saved for.
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : provider === saved.provider ? saved.apiKey : '';
  if (!apiKey) return NextResponse.json({ ok: false, error: `Add a ${PROVIDERS[provider].label} API key first.` });
  try {
    const { modelLabel } = await providerFor(provider).check({ apiKey, model, timeoutMs: 15_000 });
    return NextResponse.json({ ok: true, message: `Connected. ${modelLabel} is ready.` });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof AiError ? error.message : 'Couldn’t reach the AI provider.' });
  }
}
