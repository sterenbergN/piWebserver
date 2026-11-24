import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { asinFromUrl, priceCheckRunning, readPriceRun, resolveShortLink, runDailyCheck } from '@/lib/wishlist/prices';
import {
  cleanBaseUrl, countryForHost, fetchAmazonPrice, loadPriceService, PriceServiceError, savePriceService, toPublicPriceService,
} from '@/lib/wishlist/price-service';

// Admin → Wishlist prices. GET: the price service settings (the key is never sent, only
// whether one is saved and its last four characters), the last daily run, and whether a run
// is going. POST { action: 'save', baseUrl?, apiKey?, clearKey? } saves (a blank key keeps the
// saved one); { action: 'test', input, baseUrl?, apiKey? } looks up one Amazon link or ASIN;
// { action: 'run' } starts the daily check now, for every account, in the background.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, private' };
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

async function view() {
  return { service: toPublicPriceService(await loadPriceService()), last: await readPriceRun(), running: priceCheckRunning() };
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  return NextResponse.json(await view(), { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === 'save') {
      await savePriceService({ baseUrl: body.baseUrl, apiKey: body.apiKey, clearKey: body.clearKey });
      return NextResponse.json(await view(), { headers: NO_STORE });
    }
    if (body.action === 'run') {
      if (!priceCheckRunning()) {
        void runDailyCheck({ force: true }).catch((error) => console.error('Wishlist price check failed:', error instanceof Error ? error.message : 'unknown error'));
      }
      return NextResponse.json({ ...(await view()), running: true }, { headers: NO_STORE });
    }
    if (body.action === 'test') {
      const saved = await loadPriceService();
      const typedUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? cleanBaseUrl(body.baseUrl, true) : '';
      const baseUrl = typedUrl || saved.baseUrl;
      const typedKey = typeof body.apiKey === 'string' ? body.apiKey.trim().slice(0, 200) : '';
      // A saved key only goes with the address it was saved for.
      const apiKey = typedKey || (baseUrl === saved.baseUrl ? saved.apiKey : '');
      if (!baseUrl) return NextResponse.json({ ok: false, error: 'Enter the price service’s address first.' }, { headers: NO_STORE });
      const input = typeof body.input === 'string' ? body.input.trim().slice(0, 1000) : '';
      let asin: string | null = null;
      let host = 'amazon.com';
      if (/^[A-Z0-9]{10}$/.test(input)) asin = input;
      else {
        let url = input;
        try {
          const first = new URL(url);
          if (first.hostname === 'amzn.to' || first.hostname === 'a.co') url = await resolveShortLink(url);
          host = new URL(url).hostname;
        } catch {
          // handled below: no product number found
        }
        asin = asinFromUrl(url);
      }
      if (!asin) return NextResponse.json({ ok: false, error: 'Paste an Amazon product link or a 10-character ASIN.' }, { headers: NO_STORE });
      try {
        const found = await fetchAmazonPrice({ baseUrl, apiKey }, asin, countryForHost(host));
        return NextResponse.json({ ok: true, asin, price: found.price, currency: found.currency }, { headers: NO_STORE });
      } catch (error) {
        return NextResponse.json({ ok: false, error: error instanceof PriceServiceError ? error.message : 'Couldn’t reach the price service.' }, { headers: NO_STORE });
      }
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    if (error instanceof PriceServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Wishlist prices admin request failed');
    return NextResponse.json({ error: 'That didn’t work.' }, { status: 500 });
  }
}
