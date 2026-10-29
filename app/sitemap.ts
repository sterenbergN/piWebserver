import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { getPosts, siteOrigin } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin(await headers());
  const pages = ['', '/resume', '/blog', '/gallery', '/library', '/game', '/party', '/tools', '/loop-lab', '/loop-lab/cases/flow-pi', '/loop-lab/cases/tank-schedule', '/loop-lab/cases/stirred-pid', '/loop-lab/cases/hx-cascade-ff', '/loop-lab/cases/surge-averaging', '/loop-lab/cases/feeder-smith', '/loop-lab/cases/drum-three-element', '/loop-lab/cases/hx-steam-limit', '/loop-lab/cases/jacket-split', '/loop-lab/cases/blend-ratio', '/loop-lab/cases/crane-antisway', '/loop-lab/cases/servo-resonance', '/loop-lab/cases/maglev-unstable', '/loop-lab/cases/mixing-mimo', '/stats', '/workout'];
  const posts = await getPosts();
  return [
    ...pages.map((p) => ({ url: `${origin}${p}`, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.6 })),
    ...posts.map((post) => ({ url: `${origin}/blog/${post.slug}`, lastModified: post.date ? new Date(post.date) : undefined, priority: 0.7 })),
  ];
}
