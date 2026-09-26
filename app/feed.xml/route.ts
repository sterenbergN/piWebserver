import { headers } from 'next/headers';
import { getPosts, mediaUrl, siteOrigin } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

const escape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

/** RSS feed of blog posts, newest first. */
export async function GET() {
  const origin = siteOrigin(await headers());
  const posts = (await getPosts()).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 30);
  const items = posts.map((post) => {
    const url = `${origin}/blog/${post.slug}`;
    const image = mediaUrl(post.image);
    return `    <item>
      <title>${escape(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      ${post.date ? `<pubDate>${new Date(post.date).toUTCString()}</pubDate>` : ''}
      ${post.description ? `<description>${escape(post.description)}</description>` : ''}
      ${post.category ? `<category>${escape(post.category)}</category>` : ''}
      ${image ? `<enclosure url="${escape(origin + image)}" type="image/jpeg" length="0" />` : ''}
    </item>`;
  }).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Noah Sterenberg — Posts</title>
    <link>${origin}/blog</link>
    <atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Build logs, write-ups and notes.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
