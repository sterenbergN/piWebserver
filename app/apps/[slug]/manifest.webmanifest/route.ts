import { appManifest, homeApp } from '@/lib/home-apps';

// A section of the site as its own app on a home screen: /apps/journal/manifest.webmanifest.
// Each section's layout points here (lib/home-apps.ts, homeScreenMetadata).

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const app = homeApp((await params).slug);
  if (!app) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(appManifest(app)), { headers: { 'Content-Type': 'application/manifest+json' } });
}
