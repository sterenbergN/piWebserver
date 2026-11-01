import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createElement } from 'react';
import { markupLength, splitParagraphs, textToParagraphs, type BookFormat } from '@/lib/reader/items';
import type { FlowSource, TocEntry } from '../source';
import { toSafePage } from './epub';

// Plain text, Markdown and HTML files, as the same flowing sections as an EPUB chapter.
// Headings make the contents list; a text file's "Chapter 3" lines count as headings.

const CHAPTER_LINE = /^<p>((?:chapter|part|book|prologue|epilogue)\b[^<]{0,70})<\/p>$/i;

function markdownToHtml(text: string) {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, text)));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

function blocksFrom(format: BookFormat, text: string) {
  if (format === 'txt') return textToParagraphs(text).map((p) => p.replace(CHAPTER_LINE, '<h2>$1</h2>'));
  const body = new DOMParser().parseFromString(format === 'md' ? markdownToHtml(text) : text, 'text/html').body;
  return [...body.children].map((el) => el.outerHTML);
}

export async function openTextBook(blob: Blob, format: BookFormat): Promise<FlowSource> {
  const groups = splitParagraphs(blocksFrom(format, await blob.text()));
  const pages = groups.map((blocks) => blocks.join('\n'));
  const toc: TocEntry[] = [];
  const marked = pages.map((markup, section) => {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    doc.querySelectorAll('h1, h2, h3').forEach((heading, i) => {
      if (!heading.id) heading.id = `rd-h-${section}-${i}`;
      if (heading.textContent?.trim()) toc.push({ label: heading.textContent.trim(), depth: Number(heading.tagName[1]) - 1, section, fragment: heading.id });
    });
    return doc;
  });
  const lift = Math.min(...toc.map((entry) => entry.depth), 9);
  for (const entry of toc) entry.depth -= lift;

  return {
    toc,
    sections: marked.map((doc, i) => ({ length: markupLength(pages[i]), load: async () => toSafePage(doc.cloneNode(true) as Document, []) })),
    resolve: (from, href) => {
      if (!href.startsWith('#')) return null;
      const fragment = href.slice(1);
      const section = marked.findIndex((doc) => doc.getElementById(fragment));
      return { section: section < 0 ? from : section, fragment };
    },
    destroy: () => {},
  };
}
