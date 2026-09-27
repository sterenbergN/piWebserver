// Formatting-bar actions for the Markdown post editor. Each takes the text
// and the current selection, and returns the new text and what to select
// next (so, say, "Bold" with nothing selected leaves "bold text" selected
// ready to type over).

export type FormatAction = 'bold' | 'italic' | 'code' | 'link' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol';
export type Edit = { text: string; selStart: number; selEnd: number };

const WRAP: Partial<Record<FormatAction, [string, string]>> = {
  bold: ['**', 'bold text'],
  italic: ['_', 'italic text'],
  code: ['`', 'code'],
};

function wrap(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const selected = text.slice(start, end);
  // Already wrapped: unwrap.
  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return { text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length), selStart: start - mark.length, selEnd: end - mark.length };
  }
  const inner = selected || placeholder;
  return { text: text.slice(0, start) + mark + inner + mark + text.slice(end), selStart: start + mark.length, selEnd: start + mark.length + inner.length };
}

/** Apply a line prefix ("## ", "> ", "- ", "1. ") to every line in the selection, or remove it if all have it. */
function prefixLines(text: string, start: number, end: number, action: FormatAction): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', Math.max(end - (end > start && text[end - 1] === '\n' ? 1 : 0), start));
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const pattern = { h2: /^##\s/, h3: /^###\s/, quote: /^>\s?/, ul: /^[-*]\s/, ol: /^\d+\.\s/ }[action as 'h2'];
  const allHave = lines.every((l) => pattern.test(l));
  const next = lines.map((line, i) => {
    if (allHave) return line.replace(pattern, '');
    // Headings replace any other heading level; lists/quotes just add their mark.
    const bare = action === 'h2' || action === 'h3' ? line.replace(/^#{1,6}\s/, '') : line;
    const mark = action === 'h2' ? '## ' : action === 'h3' ? '### ' : action === 'quote' ? '> ' : action === 'ul' ? '- ' : `${i + 1}. `;
    return mark + bare;
  }).join('\n');
  return { text: text.slice(0, lineStart) + next + text.slice(lineEnd), selStart: lineStart, selEnd: lineStart + next.length };
}

export function applyFormat(text: string, start: number, end: number, action: FormatAction): Edit {
  if (action === 'link') {
    const label = text.slice(start, end) || 'link text';
    const url = 'https://';
    const insert = `[${label}](${url})`;
    const urlAt = start + label.length + 3;
    return { text: text.slice(0, start) + insert + text.slice(end), selStart: urlAt, selEnd: urlAt + url.length };
  }
  if (action === 'code' && text.slice(start, end).includes('\n')) {
    const block = `\`\`\`\n${text.slice(start, end).replace(/\n$/, '')}\n\`\`\``;
    return { text: text.slice(0, start) + block + text.slice(end), selStart: start + 4, selEnd: start + block.length - 4 };
  }
  const w = WRAP[action];
  if (w) return wrap(text, start, end, w[0], w[1]);
  return prefixLines(text, start, end, action);
}
