import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getPosts, siteOrigin } from '@/lib/site-content';
import { mediaSrc } from '@/lib/media-url';

// Title, description and preview image for shared blog links.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = (await getPosts()).find((p) => p.slug === slug);
  if (!post) return { title: 'Post not found' };
  const origin = siteOrigin(await headers());
  // A 1280px copy: quick for link-preview crawlers, sharp enough for large cards.
  const image = post.image ? mediaSrc(post.image, 1280) : undefined;
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
