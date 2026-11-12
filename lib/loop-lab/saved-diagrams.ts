import { cleanDiagram, type BlockDiagramModel } from './block-sim';

// Block Studio's named diagrams: kept in the signed-in account (and so on every device signed in to
// it), or in this browser when signed out. The same cleaning on both sides of the wire.

export const SAVED_MAX = 30;
/** A diagram bigger than this (as JSON) isn't kept: far past anything the canvas holds. */
export const SAVED_BYTES_MAX = 200_000;

export type SavedDiagram = { id: string; name: string; savedAt: number; model: BlockDiagramModel };

/** One saved diagram, or null if it isn't one. */
export function cleanSaved(raw: unknown): SavedDiagram | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id) || typeof o.name !== 'string') return null;
  const model = cleanDiagram(o.model);
  if (!model || JSON.stringify(model).length > SAVED_BYTES_MAX) return null;
  return { id: o.id, name: o.name.slice(0, 80) || model.name, savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : 0, model };
}

/** A list: valid entries only, one per id, newest first, at most SAVED_MAX. */
export function cleanSavedList(raw: unknown): SavedDiagram[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map(cleanSaved)
    .filter((e): e is SavedDiagram => !!e && !seen.has(e.id) && !!seen.add(e.id))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, SAVED_MAX);
}

/** Put one in (replacing the one with its id), newest first. */
export const withSaved = (list: SavedDiagram[], entry: SavedDiagram) => cleanSavedList([entry, ...list.filter((e) => e.id !== entry.id)]);

/** Bring entries from elsewhere (a browser's own list) in: those the list doesn't have yet. */
export const mergeSaved = (list: SavedDiagram[], incoming: SavedDiagram[]) => cleanSavedList([...list, ...incoming.filter((e) => !list.some((x) => x.id === e.id))]);
