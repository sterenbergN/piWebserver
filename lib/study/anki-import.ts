import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import type { AnkiData, AnkiGroup, AnkiLeech } from './coverage';

// Reads an Anki export (.apkg or .colpkg). Inside the zip is a SQLite database:
// `collection.anki21b` (zstd-compressed, newer layout) in a modern export, or
// `collection.anki21` / `collection.anki2` in an older one. A modern file also
// holds a dummy `collection.anki2` that only says to update Anki, so order
// matters. Only counts and the cards she keeps forgetting are kept.
//
// Node's SQLite and zstd are reached at run time rather than imported: the
// bundler leaves them alone, and a Node too old for them gets a clear message.

export class AnkiFileError extends Error {
  /** `server`: the file is fine, and the problem is on this end. */
  constructor(message: string, public kind: 'file' | 'server' = 'file') { super(message); }
}

/** Past this, an export has its media in it. Also just under what Cloudflare lets through. */
export const MAX_APKG_BYTES = 95 * 1024 * 1024;
const MAX_DB_BYTES = 800 * 1024 * 1024;
const MATURE_DAYS = 21;
/** How often a card has to be forgotten before it's worth listing. */
const LEECH_LAPSES = 3;
const MAX_LEECHES = 200;
const MAX_TAGS = 400;

type Row = Record<string, any>;
type Db = { prepare(sql: string): { all(...args: unknown[]): Row[]; get(...args: unknown[]): Row | undefined }; close(): void };

function openDb(file: string): Db {
  const sqlite = (process as any).getBuiltinModule?.('node:sqlite');
  if (!sqlite) throw new AnkiFileError('The server needs Node 22.13 or newer to read Anki files.', 'server');
  return new sqlite.DatabaseSync(file);
}

/** The collection database from the zip, and which kind it is. */
function collectionFrom(zipFile: string): { data: Buffer; format: AnkiData['format'] } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipFile);
  } catch {
    throw new AnkiFileError('That doesn’t look like an Anki export. In Anki, use File → Export and choose “Anki Deck Package”.');
  }
  const entry = (name: string) => zip.getEntry(name);
  const read = (name: string) => {
    const found = entry(name)!;
    if (found.header.size > MAX_DB_BYTES) throw new AnkiFileError('That export is too large to read here.');
    return found.getData();
  };
  if (entry('collection.anki21b')) {
    const zstd = (zlib as any).zstdDecompressSync;
    if (!zstd) throw new AnkiFileError('The server needs Node 22.15 or newer to read this kind of export. In Anki, turn on “Support older Anki versions” when exporting, and it will read that instead.', 'server');
    try {
      return { data: zstd(read('collection.anki21b'), { maxOutputLength: MAX_DB_BYTES }), format: 'modern' };
    } catch (error) {
      if (error instanceof AnkiFileError) throw error;
      throw new AnkiFileError('That export couldn’t be unpacked. Try exporting again, with “Support older Anki versions” turned on.');
    }
  }
  for (const name of ['collection.anki21', 'collection.anki2']) if (entry(name)) return { data: read(name), format: 'legacy' };
  throw new AnkiFileError('There’s no Anki collection in that file. In Anki, use File → Export and choose “Anki Deck Package”.');
}

/** Deck names by id. A newer collection has a table with `\x1f` between levels; an older one keeps JSON in `col`. */
function readDecks(db: Db) {
  const names = new Map<number, string>();
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'decks'").get();
  if (hasTable) for (const row of db.prepare('SELECT id, name FROM decks').all()) names.set(Number(row.id), String(row.name).replace(/\x1f/g, '::'));
  if (!names.size) {
    const col = db.prepare('SELECT decks FROM col').get();
    const decks = col?.decks ? JSON.parse(String(col.decks)) : {};
    for (const deck of Object.values<any>(decks)) if (deck?.id !== undefined && deck?.name) names.set(Number(deck.id), String(deck.name));
  }
  return names;
}

/** A note field as plain text: no markup or media, with cloze answers in [brackets]. */
export function plainField(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\[sound:[^\]]*\]/g, ' ')
    .replace(/\{\{c\d+::([\s\S]*?)(::[\s\S]*?)?\}\}/g, '[$1]')
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const tagsOf = (value: unknown) => String(value ?? '').split(/\s+/).filter((t) => t && t !== 'marked' && t.toLowerCase() !== 'leech');

export function readCollection(file: string, fileName: string, format: AnkiData['format'], now: string): AnkiData {
  const db = openDb(file);
  try {
    const deckNames = readDecks(db);
    const noteTags = new Map<number, string[]>();
    for (const row of db.prepare('SELECT id, tags FROM notes').all()) noteTags.set(Number(row.id), tagsOf(row.tags));

    // Review answers per card. Type 1 is a real review of a graduated card, and ease 0 is a manual reschedule.
    const history = new Map<number, { passed: number; graded: number; reviews: number; last: number }>();
    for (const row of db.prepare(`SELECT cid,
        SUM(CASE WHEN type = 1 AND ease > 1 THEN 1 ELSE 0 END) AS passed,
        SUM(CASE WHEN type = 1 AND ease > 0 THEN 1 ELSE 0 END) AS graded,
        SUM(CASE WHEN ease > 0 THEN 1 ELSE 0 END) AS reviews,
        MAX(CASE WHEN ease > 0 THEN id END) AS last
      FROM revlog GROUP BY cid`).all()) {
      history.set(Number(row.cid), { passed: Number(row.passed), graded: Number(row.graded), reviews: Number(row.reviews), last: Number(row.last) || 0 });
    }

    const cards = db.prepare('SELECT id, nid, did, odid, type, queue, ivl, reps, lapses FROM cards').all();
    if (!cards.length) throw new AnkiFileError('That export has no cards in it.');

    // The tags worth keeping: the commonest, since a deep tag tree can run to thousands.
    const tagCounts = new Map<string, number>();
    for (const card of cards) for (const tag of noteTags.get(Number(card.nid)) ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS).map(([tag]) => tag);
    const tagIndex = new Map(tags.map((tag, i) => [tag, i]));

    const decks: string[] = [];
    const deckIndex = new Map<string, number>();
    const indexOfDeck = (name: string) => {
      let index = deckIndex.get(name);
      if (index === undefined) {
        index = decks.push(name) - 1;
        deckIndex.set(name, index);
      }
      return index;
    };

    const groups = new Map<string, AnkiGroup>();
    const forgotten: { nid: number; deck: number; tags: number[]; lapses: number }[] = [];
    let reviewedAny = false;
    let lastSeen = 0;
    for (const card of cards) {
      // A card in a filtered deck still belongs to the deck it came from.
      const deckId = Number(card.odid) || Number(card.did);
      const deck = indexOfDeck(deckNames.get(deckId) ?? 'Unknown deck');
      const cardTags = (noteTags.get(Number(card.nid)) ?? []).flatMap((t) => tagIndex.get(t) ?? []).sort((a, b) => a - b);
      const key = `${deck}|${cardTags.join(',')}`;
      const group = groups.get(key) ?? { deck, tags: cardTags, cards: 0, fresh: 0, young: 0, mature: 0, suspended: 0, lapses: 0, reviews: 0, passed: 0, graded: 0 };
      const reps = Number(card.reps) || 0;
      const lapses = Number(card.lapses) || 0;
      const seen = history.get(Number(card.id));
      group.cards++;
      if (Number(card.type) === 0 && !reps) group.fresh++;
      else if (Number(card.type) === 2 && Number(card.ivl) >= MATURE_DAYS) group.mature++;
      else group.young++;
      if (Number(card.queue) === -1) group.suspended++;
      group.lapses += lapses;
      group.reviews += seen?.reviews ?? reps;
      group.passed += seen?.passed ?? 0;
      group.graded += seen?.graded ?? 0;
      if (seen?.last) {
        lastSeen = Math.max(lastSeen, seen.last);
        const day = new Date(seen.last).toISOString().slice(0, 10);
        if (!group.lastReview || day > group.lastReview) group.lastReview = day;
      }
      if (reps) reviewedAny = true;
      groups.set(key, group);
      if (lapses >= LEECH_LAPSES) forgotten.push({ nid: Number(card.nid), deck, tags: cardTags, lapses });
    }

    forgotten.sort((a, b) => b.lapses - a.lapses);
    const fields = db.prepare('SELECT flds FROM notes WHERE id = ?');
    const leeches: AnkiLeech[] = [];
    const usedNotes = new Set<number>();
    for (const card of forgotten) {
      if (leeches.length >= MAX_LEECHES) break;
      if (usedNotes.has(card.nid)) continue;
      usedNotes.add(card.nid);
      const parts = String(fields.get(card.nid)?.flds ?? '').split('\x1f').map(plainField).filter(Boolean);
      if (!parts.length) continue;
      leeches.push({ deck: card.deck, tags: card.tags, front: parts[0], back: parts[1] ?? '', lapses: card.lapses });
    }

    return { importedAt: now, fileName: fileName.slice(0, 120), format, hasHistory: reviewedAny, decks, tags, groups: [...groups.values()], leeches };
  } catch (error) {
    if (error instanceof AnkiFileError) throw error;
    console.error('Reading an Anki collection failed:', error);
    throw new AnkiFileError('That export couldn’t be read. Try exporting again, with “Include Scheduling Information” and “Support older Anki versions” turned on. If it still fails, the export format may need more work on this end.');
  } finally {
    db.close();
  }
}

/** Read an export from disk. Its unpacked database is written next to it, and always removed. */
export async function readApkg(zipFile: string, fileName: string, now: string): Promise<AnkiData> {
  const { data, format } = collectionFrom(zipFile);
  const dbFile = path.join(path.dirname(zipFile), `import-${crypto.randomBytes(6).toString('hex')}.sqlite.tmp`);
  try {
    await fs.writeFile(dbFile, data);
    return readCollection(dbFile, fileName, format, now);
  } finally {
    await fs.rm(dbFile, { force: true });
    await fs.rm(`${dbFile}-journal`, { force: true });
  }
}
