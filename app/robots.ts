import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { siteOrigin } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = siteOrigin(await headers());
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/login', '/workout/', '/party/host/', '/party/player/', '/party/audience/'] },
    sitemap: `${origin}/sitemap.xml`,
  };
}
