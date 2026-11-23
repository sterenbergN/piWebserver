import { appManifest, homeApp } from '@/lib/home-apps';
import { choiceFromParam, customManifestIcons } from '@/lib/home-icons';

// A section of the site as its own app on a home screen: /apps/journal/manifest.webmanifest.
// Each section's layout points here (lib/home-apps.ts, homeScreenMetadata).

// ?icon= swaps in the symbol and colour chosen for this app (lib/home-icons.ts).
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const app = homeApp((await params).slug);
  if (!app) return new Response('Not found', { status: 404 });
  const choice = choiceFromParam(new URL(request.url).searchParams.get('icon'));
  const manifest = appManifest(app);
  return new Response(JSON.stringify(choice ? { ...manifest, icons: customManifestIcons(choice) } : manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
