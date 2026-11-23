import { ICON_KINDS, isIconColor, symbolFromId, type IconKind } from '@/lib/home-icons';
import { renderHomeIcon } from '@/lib/home-icon-render';

// A chosen home-screen icon: /apps/icon/<symbol>/<colour>/<kind>.png. Only the
// site's own symbols and colours, so there's a small, fixed set of these.

export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string; color: string; file: string }> }) {
  const { symbol, color, file } = await params;
  const kind = file.replace(/\.png$/, '') as IconKind;
  if (!symbolFromId(symbol) || !isIconColor(color) || !ICON_KINDS.includes(kind)) return new Response('Not found', { status: 404 });
  try {
    const png = await renderHomeIcon({ symbol, color }, kind);
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
