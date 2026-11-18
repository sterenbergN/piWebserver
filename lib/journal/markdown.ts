import type { Edit, FormatAction } from '@/lib/blog/markdown-format';

// Writing Markdown on a phone keyboard: Enter on a list line starts the next item,
// and Enter on an empty item ends the list, while toolbar actions keep line prefixes
// and inline bold marks clean without selecting prefixes or merging neighboring lines.

const ITEM = /^(\s*)([-*+]|\d+[.)]|>)(\s+)(\[[ xX]\]\s+)?(.*)$/;

/** What Enter does at `caret` (with nothing selected), or null when it's just a new line. */
export function continueList(text: string, caret: number): Edit | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = text.indexOf('\n', caret) === -1 ? text.length : text.indexOf('\n', caret);
  const line = text.slice(lineStart, lineEnd);
  const m = line.match(ITEM);
  if (!m || caret < lineStart + m[1].length + m[2].length) return null;
  const [, indent, mark, gap, box = '', rest] = m;

  // An empty item: Enter ends the list. A blank line after it keeps what comes next
  // from reading as part of the last item.
  if (!rest.trim()) {
    return { text: `${text.slice(0, lineStart)}\n${text.slice(lineEnd)}`, selStart: lineStart + 1, selEnd: lineStart + 1 };
  }
  const numbered = mark.match(/^(\d+)([.)])$/);
  const nextMark = numbered ? `${Number(numbered[1]) + 1}${numbered[2]}` : mark;
  const nextBox = box ? '[ ] ' : '';
  const insert = `\n${indent}${nextMark}${gap}${nextBox}`;
  const at = caret + insert.length;
  return { text: text.slice(0, caret) + insert + text.slice(caret), selStart: at, selEnd: at };
}

const WRAP_MARKS: Partial<Record<FormatAction, [string, string]>> = {
  bold: ['**', 'bold text'],
  italic: ['_', 'italic text'],
  code: ['`', 'code'],
};

function wrapInlineOrLines(text: string, rawStart: number, rawEnd: number, mark: string, placeholder: string): Edit {
  // Never absorb trailing line breaks from line selections into inline marks.
  let end = rawEnd;
  while (end > rawStart && text[end - 1] === '\n') end--;
  const start = rawStart;
  const selected = text.slice(start, end);

  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return {
      text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length),
      selStart: start - mark.length,
      selEnd: end - mark.length,
    };
  }

  if (selected.includes('\n')) {
    const lines = selected.split('\n');
    const nonEmpty = lines.filter((line) => line.length > 0);
    const allWrapped = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(mark) && line.endsWith(mark) && line.length >= mark.length * 2);
    const replaced = lines.map((line) => {
      if (!line) return line;
      return allWrapped ? line.slice(mark.length, line.length - mark.length) : `${mark}${line}${mark}`;
    }).join('\n');
    return { text: text.slice(0, start) + replaced + text.slice(end), selStart: start, selEnd: start + replaced.length };
  }

  const inner = selected || placeholder;
  return {
    text: text.slice(0, start) + mark + inner + mark + text.slice(end),
    selStart: start + mark.length,
    selEnd: start + mark.length + inner.length,
  };
}

function formatPrefixLines(text: string, start: number, end: number, action: FormatAction): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = text.indexOf('\n', Math.max(effectiveEnd, start));
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const pattern = { h2: /^##\s/, h3: /^###\s/, quote: /^>\s?/, ul: /^[-*]\s/, ol: /^\d+\.\s/ }[action as 'h2'];
  const allHave = lines.every((l) => pattern.test(l));
  const next = lines.map((line, i) => {
    if (allHave) return line.replace(pattern, '');
    const bare = action === 'h2' || action === 'h3' ? line.replace(/^#{1,6}\s/, '') : line;
    const mark = action === 'h2' ? '## ' : action === 'h3' ? '### ' : action === 'quote' ? '> ' : action === 'ul' ? '- ' : `${i + 1}. `;
    return mark + bare;
  }).join('\n');
  const updated = text.slice(0, lineStart) + next + text.slice(lineEnd);
  if (start === end && lines.length === 1) {
    const delta = next.length - lines[0].length;
    const caret = Math.max(lineStart, Math.min(lineStart + next.length, start + delta));
    return { text: updated, selStart: caret, selEnd: caret };
  }
  return { text: updated, selStart: lineStart, selEnd: lineStart + next.length };
}

/** Line-safe Markdown formatting for private posts: prefixes place a collapsed caret; inline wraps never cross or merge lines. */
export function applyJournalFormat(text: string, start: number, end: number, action: FormatAction): Edit {
  if (action === 'link') {
    let linkEnd = end;
    while (linkEnd > start && text[linkEnd - 1] === '\n') linkEnd--;
    const label = text.slice(start, linkEnd).replace(/\n+/g, ' ') || 'link text';
    const url = 'https://';
    const insert = `[${label}](${url})`;
    const urlAt = start + label.length + 3;
    return { text: text.slice(0, start) + insert + text.slice(linkEnd), selStart: urlAt, selEnd: urlAt + url.length };
  }
  if (action === 'code' && text.slice(start, end).includes('\n')) {
    let codeEnd = end;
    while (codeEnd > start && text[codeEnd - 1] === '\n') codeEnd--;
    const block = `\`\`\`\n${text.slice(start, codeEnd)}\n\`\`\``;
    return { text: text.slice(0, start) + block + text.slice(codeEnd), selStart: start + 4, selEnd: start + block.length - 4 };
  }
  const wrapSpec = WRAP_MARKS[action];
  if (wrapSpec) return wrapInlineOrLines(text, start, end, wrapSpec[0], wrapSpec[1]);
  return formatPrefixLines(text, start, end, action);
}
