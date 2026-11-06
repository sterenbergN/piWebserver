'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// An entry as it reads: Markdown (lists, bold, headings, quotes, checklists) with
// each line break kept, since a journal is written line by line, not in paragraphs.
// Raw HTML in an entry is shown as text, never run.

const REMARK = [remarkGfm];

export default function JournalMarkdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`jr-md ${className}`}>
      <Markdown remarkPlugins={REMARK} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {text}
      </Markdown>
    </div>
  );
}
