import type { Edit } from '@/lib/blog/markdown-format';

// Writing Markdown on a phone keyboard: Enter on a list line starts the next item,
// and Enter on an empty item ends the list. (Bold, headings and the rest come from
// the post editor's formatting bar: lib/blog/markdown-format.ts.)

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
