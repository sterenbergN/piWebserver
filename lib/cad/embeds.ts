// CAD models referenced from posts. The CAD section is the one place a model
// is described; a post only names it, so editing the model updates every post.
//   - A card in the text: a code block in the "cad" language holding the id
//       ```cad
//       bracket-v2
//       ```
//   - A link to it on the home page: [the bracket](/#cad-bracket-v2)

/** The element id of a model's card in the home page's CAD section. */
export const cadAnchor = (id: string) => `cad-${id}`;

/** A link to a model's card on the home page. */
export const cadHref = (id: string) => `/#${cadAnchor(id)}`;

/** The Markdown that shows a model's card in a post. */
export const cadBlock = (id: string) => '```cad\n' + id + '\n```';

const BLOCK = /^(`{3,}|~{3,})cad[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/gm;

/** The model id a "cad" code block holds (its first non-empty line). */
export const cadIdFrom = (text: string) => text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/** Every model a post shows as a card, in order, without repeats. */
export function cadIdsIn(markdown: string): string[] {
  const ids = [...markdown.matchAll(BLOCK)].map((m) => cadIdFrom(m[2])).filter(Boolean);
  return [...new Set(ids)];
}
