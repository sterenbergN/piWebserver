'use client';

import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

/** Markdown with $inline$ and $$display$$ math. Raw HTML in the text is not rendered. */
export function MathText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`dq-md${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
        components={{ a: ({ href, children: text }) => <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> }}>
        {children}
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
