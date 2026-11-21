// Tidying a model's reply before it goes in the paste-reply box. Models like to wrap a
// whole JSON or Markdown answer in a code fence ("```json … ```"), which people then
// have to delete by hand. Shared by the browser and the server, so no imports.

const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^\n`]*$/;

type Fence = { line: number; char: string; size: number; info: string };

function fencesIn(lines: string[]): Fence[] {
  const found: Fence[] = [];
  lines.forEach((text, line) => {
    const m = FENCE_LINE.exec(text);
    if (m) found.push({ line, char: m[1][0], size: m[1].length, info: m[2] });
  });
  return found;
}

/**
 * Whether the fence opened at `open` is closed only by the last of `fences`, with
 * every fence in between paired off: then it wraps everything between them.
 * A bare fence closes; one with a language ("```js") opens a block inside.
 */
function wrapsToEnd(fences: Fence[], open: Fence) {
  const close = fences[fences.length - 1];
  if (close === open || close.char !== open.char || close.size < open.size || close.info) return false;
  let depth = 0;
  for (const f of fences.slice(fences.indexOf(open) + 1, -1)) {
    if (f.char !== open.char) continue;
    if (f.info) depth++;
    else if (depth > 0) depth--;
    else return false; // this one closes the outer block early: more than one block
  }
  return depth === 0;
}

const inside = (lines: string[], from: number, to: number) => lines.slice(from + 1, to).join('\n').replace(/^\s*\n/, '').trimEnd();

/**
 * The reply without the code fence around it, when one fence wraps the whole thing
 * (```json, ```markdown, a bare ``` or ~~~), or follows a one-line lead-in such as
 * "Here’s the JSON:". Text where fences are part of the content (several blocks,
 * prose with a code sample in it) comes back as it was.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  const lines = trimmed.split('\n');
  const fences = fencesIn(lines);
  if (!fences.length) return text;
  const first = fences[0];

  if (first.line === 0) {
    // Cut off before the closing fence (a reply that ran out of room): drop the opener.
    if (fences.length === 1) return inside(lines, 0, lines.length);
    const last = fences[fences.length - 1];
    if (last.line === lines.length - 1 && wrapsToEnd(fences, first)) return inside(lines, 0, last.line);
    return text;
  }

  // "Here’s the JSON:" then a single block that ends the reply.
  const lead = lines.slice(0, first.line).join(' ').trim();
  if (fences.length !== 2 || lines.length - 1 !== fences[1].line || !wrapsToEnd(fences, first)) return text;
  if (first.line > 2 || lead.length > 160) return text;
  const body = inside(lines, first.line, fences[1].line);
  const looksLikeData = /^(json|jsonc|json5)?$/i.test(first.info) && /^[[{]/.test(body.trimStart());
  return lead.endsWith(':') || looksLikeData ? body : text;
}
