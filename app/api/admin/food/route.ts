import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { FoodSettingsError, getFoodSettings, saveFoodSettings, toPublicFoodSettings } from '@/lib/food/settings';
import { resetFatSecret, testFatSecret } from '@/lib/food/sources/fatsecret';
import { allLibraryFoods, libraryStats } from '@/lib/food/sources/library';
import { fetchWithTimeout, SourceError, USER_AGENT } from '@/lib/food/sources/types';
import { usdaInfo } from '@/lib/food/sources/usda';

// Admin → Food. GET: settings (secret masked), library size, the bundled USDA
// set; ?download=1 downloads the whole library as JSON. PUT saves (a blank
// secret keeps the saved one). POST { action: 'test', clientId?, clientSecret? }
// tests FatSecret with what's typed (or saved); { action: 'ip' } asks a public
// service which address this server's requests come from, for FatSecret's allowed list.

export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const NO_STORE = { 'Cache-Control': 'no-store, private' };

async function view() {
  return { settings: toPublicFoodSettings(await getFoodSettings()), library: await libraryStats(), usda: usdaInfo() };
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  if (new URL(request.url).searchParams.get('download') === '1') {
    const foods = await allLibraryFoods();
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), count: foods.length, foods }, null, 2), {
      headers: { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="food-library-${day}.json"` },
    });
  }
  return NextResponse.json(await view(), { headers: NO_STORE });
}

export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const patch = await request.json();
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    await saveFoodSettings(patch);
    resetFatSecret();
    return NextResponse.json(await view(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof FoodSettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
    console.error('Saving the food settings failed');
    return NextResponse.json({ error: 'Couldn’t save the food settings.' }, { status: 500 });
  }
}

/** This server's public IPv4 address as the outside world sees it (what FatSecret must allow). */
async function publicIp(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout('fatsecret', 'https://api.ipify.org?format=json', { headers: { 'User-Agent': USER_AGENT } }, 4000);
    const json = (await res.json().catch(() => null)) as { ip?: string } | null;
    return json?.ip && /^[\d.:a-fA-F]{3,45}$/.test(json.ip) ? json.ip : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; clientId?: unknown; clientSecret?: unknown };
  if (body.action === 'ip') {
    const ip = await publicIp();
    return NextResponse.json(ip ? { ok: true, ip } : { ok: false, error: 'Couldn’t find out this server’s public address.' }, { headers: NO_STORE });
  }
  if (body.action !== 'test') return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  const saved = (await getFoodSettings()).fatsecret;
  const typedId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const typedSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
  const clientId = typedId || saved.clientId;
  // A saved secret only goes with the client id it was saved for.
  const clientSecret = typedSecret || (clientId === saved.clientId ? saved.clientSecret : '');
  if (!clientId || !clientSecret) return NextResponse.json({ ok: false, error: 'Enter the client id and secret first.' }, { headers: NO_STORE });
  if (clientId.length > 200 || clientSecret.length > 200) return NextResponse.json({ ok: false, error: 'Those don’t look like FatSecret keys.' }, { headers: NO_STORE });
  try {
    const result = await testFatSecret({ clientId, clientSecret });
    return NextResponse.json({ ok: true, message: result.message, premier: result.premier }, { headers: NO_STORE });
  } catch (error) {
    const ip = error instanceof SourceError && error.kind === 'ip' ? await publicIp() : null;
    const message = error instanceof SourceError ? error.message : 'Couldn’t reach FatSecret.';
    return NextResponse.json({ ok: false, error: ip ? `${message} This server’s public address looks like ${ip}.` : message, kind: error instanceof SourceError ? error.kind : 'unavailable' }, { headers: NO_STORE });
  } finally {
    // The test may have used typed (unsaved) keys; the next real call starts fresh.
    resetFatSecret();
  }
}
