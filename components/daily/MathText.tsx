'use client';

import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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

/** Markdown with $inline$ and $$display$$ math, and tables. Raw HTML in the text is not rendered. */
export function MathText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`dq-md${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={[rehypeKatex]}
        components={{ a: ({ href, children: text }) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> }}>
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
