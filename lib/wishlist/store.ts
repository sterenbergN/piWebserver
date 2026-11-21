// Server side: where wishlist data lives and who may see what. Nothing in here
// is reachable without going through a route that has checked the viewer.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { findHousehold } from '@/lib/chores/households';
import { readJson, updateJson } from '@/lib/json-store';
import { fetchPublic } from '@/lib/recipes/import-fetch';
import { loadUsersData } from '@/lib/workout/users';
import { emptyClaims, normalizeClaims, type ClaimsData } from './claims';
import { emptyWishlist, isId, isShareToken, normalizeWishlist, type WishList, type WishlistData } from './model';

const ROOT = () => path.join(process.cwd(), '.data', 'wishlist');

function safeId(id: string) {
  if (!isId(id)) throw new Error('Invalid id');
  return id;
}

export const listsFile = (userId: string) => path.join(ROOT(), 'lists', `${safeId(userId)}.json`);
export const claimsFile = (ownerId: string) => path.join(ROOT(), 'claims', `${safeId(ownerId)}.json`);
const sharesFile = () => path.join(ROOT(), 'shares.json');
const imageDir = (ownerId: string) => path.join(ROOT(), 'images', safeId(ownerId));

export const newToken = () => crypto.randomBytes(18).toString('base64url');
export const newId = () => crypto.randomBytes(6).toString('base64url');

export async function loadWishlist(userId: string): Promise<WishlistData> {
  return normalizeWishlist(await readJson(listsFile(userId), emptyWishlist()), newId);
}

export async function loadClaims(ownerId: string): Promise<ClaimsData> {
  return normalizeClaims(await readJson(claimsFile(ownerId), emptyClaims()));
}

/** Change a user's wishlist under the file lock; the mutator may throw to abort. */
export async function editWishlist<R>(userId: string, fn: (data: WishlistData) => R): Promise<{ data: WishlistData; result: R }> {
  let result!: R;
  const data = await updateJson<WishlistData, WishlistData>(listsFile(userId), emptyWishlist(), (stored) => {
    const next = normalizeWishlist(stored, newId);
    result = fn(next);
    stored.lists = next.lists;
    return next;
  });
  return { data, result };
}

export async function editClaims<R>(ownerId: string, fn: (data: ClaimsData) => R): Promise<R> {
  let result!: R;
  await updateJson<ClaimsData, void>(claimsFile(ownerId), emptyClaims(), (stored) => {
    const next = normalizeClaims(stored);
    result = fn(next);
    stored.claims = next.claims;
  });
  return result;
}

// ---- Share links -----------------------------------------------------------------

type Shares = { tokens: Record<string, { userId: string; listId: string }> };

export async function registerShare(token: string, userId: string, listId: string) {
  await updateJson<Shares, void>(sharesFile(), { tokens: {} }, (data) => {
    data.tokens ||= {};
    data.tokens[token] = { userId, listId };
  });
}

export async function forgetShare(token: string) {
  await updateJson<Shares, void>(sharesFile(), { tokens: {} }, (data) => {
    if (data.tokens) delete data.tokens[token];
  });
}

/**
 * The list a share token opens, or null. The list's own record is the authority
 * (the index only says where to look), so a revoked or replaced token is dead
 * even if the index is behind.
 */
export async function resolveShare(token: string): Promise<{ ownerId: string; list: WishList } | null> {
  if (!isShareToken(token)) return null;
  const entry = (await readJson<Shares>(sharesFile(), { tokens: {} })).tokens?.[token];
  if (!entry || !isId(entry.userId)) return null;
  const list = (await loadWishlist(entry.userId)).lists.find((l) => l.id === entry.listId);
  if (!list || list.kind !== 'mine' || list.shareToken !== token) return null;
  return { ownerId: entry.userId, list };
}

/** Name to show on a shared list: the account's name (it has no separate first name). */
export async function ownerName(ownerId: string): Promise<string> {
  const user = (await loadUsersData()).users.find((u) => u.id === ownerId);
  return String(user?.firstName || user?.username || 'Someone').slice(0, 40);
}

/** Is `viewerId` in the same household as `ownerId` (and not the same person)? */
export async function sharesHousehold(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return false;
  const household = await findHousehold(viewerId);
  return !!household?.members.includes(ownerId);
}

// ---- Pictures ---------------------------------------------------------------------

export const imageUrlFor = (ownerId: string, token?: string) => (id: string) =>
  `/api/wishlist/image/${ownerId}/${id}${token ? `?t=${token}` : ''}`;

/** Download a product picture once and keep a small copy; returns its id, or null if it isn't a usable picture. */
export async function saveImageFromUrl(ownerId: string, imageUrl: string): Promise<string | null> {
  try {
    const { body } = await fetchPublic(imageUrl, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', maxBytes: 10 * 1024 * 1024, timeoutMs: 12_000 });
    const webp = await sharp(body, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const id = newId();
    await fs.mkdir(imageDir(ownerId), { recursive: true });
    await fs.writeFile(path.join(imageDir(ownerId), `${id}.webp`), webp);
    return id;
  } catch {
    return null;
  }
}

export async function readImage(ownerId: string, id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(imageDir(ownerId), `${safeId(id)}.webp`));
  } catch {
    return null;
  }
}

/** Delete pictures no item uses any more. Files under an hour old are kept: they may be about to be saved. */
export async function sweepImages(ownerId: string, data: WishlistData) {
  const used = new Set(data.lists.flatMap((l) => l.items.map((i) => i.image)));
  let names: string[] = [];
  try {
    names = await fs.readdir(imageDir(ownerId));
  } catch {
    return;
  }
  for (const name of names) {
    const id = name.replace(/\.webp$/, '');
    if (used.has(id)) continue;
    const file = path.join(imageDir(ownerId), name);
    try {
      if (Date.now() - (await fs.stat(file)).mtimeMs > 3_600_000) await fs.unlink(file);
    } catch {
      // Already gone.
    }
  }
}
