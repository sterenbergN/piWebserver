import { mediaSrc, mediaSrcSet } from '@/lib/media-url';

/**
 * A picture in a post's Markdown. Site pictures get resized copies; a title
 * (`![alt](src "Caption")`) shows as a caption underneath. Spans, not
 * <figure>, because Markdown puts images inside a <p>.
 */
export default function PostImage({ src, alt, title }: { src?: unknown; alt?: string; title?: string }) {
  const url = typeof src === 'string' ? src : undefined;
  const img = url?.startsWith('/api/media') ? (
    <img src={mediaSrc(url, 1280)} srcSet={mediaSrcSet(url, [640, 960, 1280, 1920])} sizes="(max-width: 900px) 100vw, 860px" alt={alt || ''} title={title} loading="lazy" decoding="async" />
  ) : <img src={url} alt={alt || ''} title={title} loading="lazy" />;
  if (!title) return img;
  return (
    <span className="post-figure">
      {img}
      <span className="post-caption">{title}</span>
    </span>
  );
}
