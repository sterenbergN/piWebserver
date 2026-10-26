'use client';

import katex from 'katex';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { SolutionFigure } from '@/lib/daily/types';

/**
 * remark-math only treats $$ … $$ as a display block when the dollars sit on
 * their own lines; a whole line written as $$ … $$ would render inline. Give
 * such lines their own fences.
 */
export function fenceDisplayMath(text: string) {
  return text.replace(/^[ \t]*\$\$(?!\s*$)([^\n]*?)\$\$[ \t]*$/gm, (_, tex: string) => `$$\n${tex.trim()}\n$$`);
}

// Tables (and ~~strikethrough~~); a single ~ stays a tilde, so "~5 kN" is left alone.
const REMARK = [[remarkGfm, { singleTilde: false }], remarkMath] as Parameters<typeof ReactMarkdown>[0]['remarkPlugins'];

/** An SVG diagram as an image (so its markup can't run anything). Spans, since it sits inside a paragraph. */
export function SvgFigure({ svg, alt, caption }: { svg: string; alt: string; caption?: string }) {
  return (
    <span className="dq-figure" role="figure" aria-label={caption ?? alt}>
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={alt} />
      {caption && <span className="dq-figcaption">{caption}</span>}
    </span>
  );
}

/**
 * Markdown with $inline$ and $$display$$ math, and tables. Raw HTML in the text is not rendered.
 * `figures` are shown where the text has ![](figure:<id>); other images are dropped.
 */
export function MathText({ children, className, figures }: { children: string; className?: string; figures?: SolutionFigure[] }) {
  return (
    <div className={`dq-md${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => (url.startsWith('figure:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children: text }) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>,
          img: ({ src }) => {
            const f = typeof src === 'string' && src.startsWith('figure:') ? figures?.find((x) => x.id === src.slice(7)) : undefined;
            return f ? <SvgFigure svg={f.svg} alt={f.alt} caption={f.caption} /> : null;
          },
        }}>
        {fenceDisplayMath(children)}
      </ReactMarkdown>
    </div>
  );
}

/** One formula, typeset. */
export function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { displayMode: display, throwOnError: false });
  } catch {
    return <code>{latex}</code>;
  }
  return <span className={display ? 'dq-tex is-display' : 'dq-tex'} dangerouslySetInnerHTML={{ __html: html }} />;
}
