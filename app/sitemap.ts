import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { getPosts, siteOrigin } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin(await headers());
  const pages = ['', '/resume', '/blog', '/gallery', '/library', '/game', '/party', '/tools', '/workout'];
  const posts = await getPosts();
  return [
    ...pages.map((p) => ({ url: `${origin}${p}`, changeFrequency: 'weekly' as const, priority: p === '' ? 1 : 0.6 })),
    ...posts.map((post) => ({ url: `${origin}/blog/${post.slug}`, lastModified: post.date ? new Date(post.date) : undefined, priority: 0.7 })),
  ];
}
