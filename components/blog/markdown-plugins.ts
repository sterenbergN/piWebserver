import type { Element, Root, Text } from 'hast';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export type TocHeading = {
  id: string;
  level: 2 | 3;
  text: string;
};

/**
 * remark-math only treats $$ … $$ as block math when the $$ fences sit on
 * their own lines; single-line `$$ E = mc^2 $$` outside code blocks gets fenced.
 */
export function fenceDisplayMath(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let fence: string | null = null;
  const out: string[] = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker[0];
      else if (marker[0] === fence && marker.length >= 3) fence = null;
      out.push(line);
      continue;
    }
    if (!fence) {
      const m = line.match(/^[ \t]*\$\$(?!\s*$)((?:(?!\$\$).)+?)\$\$[ \t]*$/);
      if (m) {
        out.push(`$$\n${m[1].trim()}\n$$`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();
}

export function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

function nextHeadingId(text: string, counts: Map<string, number>): string {
  const base = slugifyHeading(text);
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/** Extract ## and ### headings outside fenced code blocks with deterministic anchor ids. */
export function extractToc(markdown: string): TocHeading[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let fence: string | null = null;
  const counts = new Map<string, number>();
  const headings: TocHeading[] = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker[0];
      else if (marker[0] === fence && marker.length >= 3) fence = null;
      continue;
    }
    if (fence) continue;

    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length as 2 | 3;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;
    headings.push({ id: nextHeadingId(text, counts), level, text });
  }
  return headings;
}

function hastText(node: Element | Text | { type: string; children?: unknown[] }): string {
  if (node.type === 'text') return (node as Text).value || '';
  if (!Array.isArray((node as Element).children)) return '';
  return ((node as Element).children as Array<Element | Text>).map(hastText).join('');
}

/** Rehype plugin that assigns deterministic id attributes to h2 and h3 headings. */
export function rehypeHeadingIds() {
  return (tree: Root) => {
    const counts = new Map<string, number>();
    const visit = (node: Root | Element) => {
      if (node.type === 'element' && (node.tagName === 'h2' || node.tagName === 'h3')) {
        const text = hastText(node).trim();
        if (text) {
          node.properties = node.properties || {};
          node.properties.id = nextHeadingId(text, counts);
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (child.type === 'element') visit(child);
        }
      }
    };
    visit(tree);
  };
}

export const BLOG_REMARK_PLUGINS: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkMath,
];

export const BLOG_REHYPE_PLUGINS: PluggableList = [
  rehypeHeadingIds,
  rehypeKatex,
];
