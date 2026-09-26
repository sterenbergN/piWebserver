import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getPosts, mediaUrl, siteOrigin } from '@/lib/site-content';

// Title, description and preview image for shared blog links.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = (await getPosts()).find((p) => p.slug === slug);
  if (!post) return { title: 'Post not found' };
  const origin = siteOrigin(await headers());
  const image = mediaUrl(post.image);
  return {
    // Absolute: the /blog layout's own title would otherwise drop the site-name suffix.
    title: { absolute: `${post.title} · Noah Sterenberg` },
    description: post.description,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url: `${origin}/blog/${post.slug}`,
      publishedTime: post.date,
      images: image ? [{ url: `${origin}${image}` }] : undefined,
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: post.title, description: post.description },
  };
}

export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return children;
}
