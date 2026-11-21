import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readJson } from '@/lib/json-store';
import { emptySettings, normalizeSettings, type TicketSettings } from './tickets';

// Where tickets live: .data/tickets/{settings.json, tickets.json, files/<id>.webp}.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_ID = /^[A-Za-z0-9_-]{16,32}$/;

const dir = () => path.join(process.cwd(), '.data', 'tickets');
export const settingsFile = () => path.join(dir(), 'settings.json');
export const ticketsFile = () => path.join(dir(), 'tickets.json');
const imagePath = (id: string) => path.join(dir(), 'files', `${id}.webp`);

export const isImageId = (id: string) => IMAGE_ID.test(id);

let cache: { mtimeMs: number; ids: Set<string> } | null = null;

/** Accounts allowed to file tickets. Runs on every page, so it only re-reads the file when it changed. */
async function enabledIds(): Promise<Set<string>> {
  const mtimeMs = await fs.stat(settingsFile()).then((s) => s.mtimeMs, () => -1);
  if (cache && cache.mtimeMs === mtimeMs) return cache.ids;
  const settings: TicketSettings = mtimeMs < 0 ? emptySettings() : normalizeSettings(await readJson(settingsFile(), emptySettings()));
  cache = { mtimeMs, ids: new Set(settings.enabledUserIds) };
  return cache.ids;
}

/** Whether this account may file tickets. (The admin is allowed separately, by the caller.) */
export async function canFileTickets(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await enabledIds()).has(userId);
  } catch {
    return false;
  }
}

/** Forget the cached list (after Admin changes it, in case the file time didn't move). */
export function forgetEnabledCache() {
  cache = null;
}

let build: { at: number; id?: string } | null = null;

/** The running build id, as /api/health reports it (build-info.json), cached for a minute. */
export async function currentBuild(): Promise<string | undefined> {
  if (build && Date.now() - build.at < 60_000) return build.id;
  const info = await fs.readFile(path.join(process.cwd(), 'build-info.json'), 'utf-8').then((t) => JSON.parse(t) as { id?: unknown; sha?: unknown }, () => null);
  const id = info ? [info.id, typeof info.sha === 'string' ? info.sha.slice(0, 7) : ''].filter((v) => typeof v === 'string' && v).join(' ') : process.env.NODE_ENV === 'production' ? undefined : 'dev';
  build = { at: Date.now(), id: id || undefined };
  return build.id;
}

/** Re-encode an uploaded screenshot or photo as a modest WebP; returns its id. Throws if it isn't an image. */
export async function saveTicketImage(input: Buffer): Promise<string> {
  const webp = await sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const id = crypto.randomBytes(12).toString('base64url');
  await fs.mkdir(path.dirname(imagePath(id)), { recursive: true });
  await fs.writeFile(imagePath(id), webp);
  return id;
}

export async function readTicketImage(id: string): Promise<Buffer | null> {
  if (!isImageId(id)) return null;
  return fs.readFile(imagePath(id)).catch(() => null);
}

export async function deleteTicketImage(id: string | undefined) {
  if (id && isImageId(id)) await fs.rm(imagePath(id), { force: true }).catch(() => {});
}
