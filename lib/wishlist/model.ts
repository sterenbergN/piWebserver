// Wishlists: pure logic (no files, no network) so it can be tested. A person has
// several lists. "mine" lists are things they want and can be shared by link;
// "for" lists are private notes about what someone else wants (a gift idea
// jotted down when she mentions it) and are never shared with anyone.
//
// Claims ("I'm getting this") are NOT part of this data on purpose: they live
// in their own file (see claims.ts) so nothing the owner's pages load can
// carry them, even by mistake.

export const PRIORITIES = ['must', 'love', 'nice'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { must: 'Must-have', love: 'Would love', nice: 'Nice to have' };

export type WishItem = {
  id: string;
  url: string;
  title: string;
  /** An image id (a file under .data/wishlist/images/<owner>/), not a link: pictures are kept on the site. */
  image: string;
  description: string;
  price: number | null;
  currency: string;
  /** The shop's domain, worked out from the link. */
  store: string;
  priority: Priority;
  quantity: number;
  /** Size, colour, anything the giver should know. */
  note: string;
  /** Bought it themselves: hidden from anyone given the list. */
  gotIt: boolean;
  addedAt: string;
  /** Id of the group of alternatives it belongs to (one of its list's `groups`), or ''. */
  group: string;
  /** When the daily price check last read this item's price (ISO), or ''. Set only by the check. */
  checkedAt: string;
  /** Why the last price check didn't get a price ("The shop didn't say"), or ''. Set only by the check. */
  checkNote: string;
};

/**
 * Alternatives for one want ("a vacuum"): any one of them will do. Givers see the
 * one the rules pick on top, and getting any of them covers the whole group.
 */
export type WishGroup = {
  id: string;
  name: string;
  /** Tried in order; the first that holds picks its item. */
  rules: PriceRule[];
  /** Picked when no rule holds; '' means the group's first item. */
  fallback: string;
};

/**
 * "Pick <pick> if <subject> costs at most / more than <amount>", or with `other`:
 * "if <subject> costs at most <amount> more than <other>". A rule whose prices
 * aren't known is passed over.
 */
export type PriceRule = { pick: string; subject: string; op: 'atMost' | 'over' | 'withinOf'; amount: number; other?: string };

export type ListKind = 'mine' | 'for';

export type WishList = {
  id: string;
  name: string;
  emoji: string;
  kind: ListKind;
  /** Who a "for" list is about. */
  person: string;
  occasion: string;
  /** YYYY-MM-DD or empty. */
  date: string;
  note: string;
  /** Only "mine" lists can have one. Whoever has the link can see the list. */
  shareToken: string | null;
  items: WishItem[];
  groups: WishGroup[];
};

/** One thing the owner was given, kept after a tidy-up. Who gave it is only known because the owner chose to look. */
export type ReceivedItem = {
  id: string;
  title: string;
  url: string;
  /** An image id, same as a list item's. */
  image: string;
  price: number | null;
  currency: string;
  store: string;
  quantity: number;
  /** The list it was on, as it was called then. */
  listName: string;
  givers: { name: string; qty: number }[];
  claimedAt: string;
  thanked: boolean;
};

/** Everything received in one tidy-up, named by the owner ("Christmas 2026"). */
export type ReceivedGroup = { id: string; name: string; at: string; items: ReceivedItem[] };

export type WishlistData = {
  lists: WishList[];
  /** Kept in this file (not a new one) so exports and backups already include it. */
  received: ReceivedGroup[];
  /** ISO time of the last tidy-up of every list, or empty. */
  lastTidyAt: string;
};

export const MAX_RECEIVED_GROUPS = 60;

export const MAX_LISTS = 40;
export const MAX_GROUPS = 40;
export const MAX_RULES = 8;
export const MAX_ITEMS = 300;
export const MAX_QUANTITY = 99;

export class WishlistInputError extends Error {}

export const emptyWishlist = (): WishlistData => ({ lists: [], received: [], lastTidyAt: '' });

const ID = /^[\w-]{1,64}$/;
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const TOKEN = /^[\w-]{16,64}$/;
export const isShareToken = (v: unknown): v is string => typeof v === 'string' && TOKEN.test(v);

export function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  text = multiline ? text.replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

/** An http(s) link, or empty. Anything else (javascript:, data:) is dropped. */
export function cleanUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || raw.length > 2000) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || !url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** An Amazon product or short link. Amazon blocks automatic page reads, so its prices are checked by hand. */
export function isAmazonLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)amazon\.[a-z.]{2,}$/.test(host) || /(^|\.)amzn\.(com|to)$/.test(host) || host === 'a.co';
  } catch {
    return false;
  }
}

export function storeFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').slice(0, 80);
  } catch {
    return '';
  }
}

export function cleanPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

const cleanCurrency = (v: unknown) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : 'USD');
const cleanDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');
const cleanEmoji = (v: unknown, fallback: string) => {
  const text = typeof v === 'string' ? v.trim() : '';
  return text && text.length <= 12 && !/[<>\w]/.test(text) ? text : fallback;
};
const cleanQuantity = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_QUANTITY, Math.max(1, n)) : 1;
};

/** Read one item from anything (stored data or a client's draft); unknown fields are dropped. */
export function normalizeItem(raw: unknown, fallbackId: string, now = new Date()): WishItem {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const url = cleanUrl(r.url);
  const priority = PRIORITIES.includes(r.priority as Priority) ? (r.priority as Priority) : 'love';
  return {
    id: isId(r.id) ? r.id : fallbackId,
    url,
    title: cleanText(r.title, 200),
    image: isId(r.image) ? r.image : '',
    description: cleanText(r.description, 1000, true),
    price: cleanPrice(r.price),
    currency: cleanCurrency(r.currency),
    store: cleanText(r.store, 80) || storeFromUrl(url),
    priority,
    quantity: cleanQuantity(r.quantity ?? 1),
    note: cleanText(r.note, 300),
    gotIt: r.gotIt === true,
    addedAt: typeof r.addedAt === 'string' && !Number.isNaN(Date.parse(r.addedAt)) ? r.addedAt : now.toISOString(),
    group: isId(r.group) ? r.group : '',
    checkedAt: typeof r.checkedAt === 'string' && !Number.isNaN(Date.parse(r.checkedAt)) ? r.checkedAt : '',
    checkNote: cleanText(r.checkNote, 160),
  };
}

export function normalizeList(raw: unknown, fallbackId: string, newId: () => string = () => fallbackId): WishList {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind: ListKind = r.kind === 'for' ? 'for' : 'mine';
  const seen = new Set<string>();
  const items: WishItem[] = [];
  for (const item of Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS) : []) {
    const clean = normalizeItem(item, newId());
    if (seen.has(clean.id)) continue;
    seen.add(clean.id);
    items.push(clean);
  }
  return {
    id: isId(r.id) ? r.id : fallbackId,
    name: cleanText(r.name, 60) || (kind === 'for' ? 'Gift ideas' : 'My list'),
    emoji: cleanEmoji(r.emoji, kind === 'for' ? '💡' : '🎁'),
    kind,
    person: kind === 'for' ? cleanText(r.person, 40) : '',
    occasion: cleanText(r.occasion, 40),
    date: cleanDate(r.date),
    note: cleanText(r.note, 500, true),
    shareToken: kind === 'mine' && isShareToken(r.shareToken) ? r.shareToken : null,
    items,
    groups: normalizeGroups(r.groups, items),
  };
}

const RULE_OPS: PriceRule['op'][] = ['atMost', 'over', 'withinOf'];

function cleanRule(raw: unknown, members: Set<string>): PriceRule | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = r.pick as string;
  const subject = r.subject as string;
  const op = r.op as PriceRule['op'];
  if (!members.has(pick) || !members.has(subject) || !RULE_OPS.includes(op)) return null;
  const amount = cleanPrice(r.amount);
  if (amount === null) return null;
  if (op !== 'withinOf') return { pick, subject, op, amount };
  const other = r.other as string;
  if (!members.has(other) || other === subject) return null;
  return { pick, subject, op, amount, other };
}

/**
 * Keep groups that still have items, and rules that only name their own items.
 * Items pointing at a group that isn't there any more are let go (`group` = '').
 * Changes `items` in place.
 */
export function normalizeGroups(raw: unknown, items: WishItem[]): WishGroup[] {
  const groups: WishGroup[] = [];
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_GROUPS)) {
    const g = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (!isId(g.id) || groups.some((x) => x.id === g.id)) continue;
    const members = new Set(items.filter((i) => i.group === g.id).map((i) => i.id));
    if (!members.size) continue;
    const rules = (Array.isArray(g.rules) ? g.rules : []).slice(0, MAX_RULES).map((x) => cleanRule(x, members)).filter((x): x is PriceRule => !!x);
    groups.push({ id: g.id, name: cleanText(g.name, 60) || 'Any one of these', rules, fallback: members.has(g.fallback as string) ? (g.fallback as string) : '' });
  }
  const kept = new Set(groups.map((g) => g.id));
  for (const item of items) if (item.group && !kept.has(item.group)) item.group = '';
  return groups;
}

export type GroupPick = { itemId: string; /** Why, in words ("Robot vac is $480, no more than $500"); '' when nothing in particular picked it. */ reason: string };

type Priced = Pick<WishItem, 'id' | 'title' | 'price' | 'currency' | 'gotIt' | 'group'>;

/** Which of a group's items to show on top right now, and why. Null if none is still wanted. */
export function pickOfGroup(group: Pick<WishGroup, 'id' | 'rules' | 'fallback'>, items: Priced[]): GroupPick | null {
  const members = items.filter((i) => i.group === group.id && !i.gotIt);
  if (!members.length) return null;
  const by = new Map(members.map((i) => [i.id, i]));
  for (const rule of group.rules) {
    const pick = by.get(rule.pick);
    const subject = by.get(rule.subject);
    if (!pick || !subject || subject.price === null) continue;
    const money = (n: number) => formatPrice(n, subject.currency);
    if (rule.op === 'atMost' && subject.price <= rule.amount) {
      return { itemId: pick.id, reason: `${subject.title} is ${money(subject.price)}, no more than ${money(rule.amount)}` };
    }
    if (rule.op === 'over' && subject.price > rule.amount) {
      return { itemId: pick.id, reason: `${subject.title} is ${money(subject.price)}, over ${money(rule.amount)}` };
    }
    if (rule.op === 'withinOf') {
      const other = rule.other ? by.get(rule.other) : undefined;
      if (!other || other.price === null || other.currency !== subject.currency) continue;
      const diff = Math.round((subject.price - other.price) * 100) / 100;
      if (diff <= rule.amount) {
        return { itemId: pick.id, reason: diff <= 0 ? `${subject.title} costs no more than ${other.title}` : `${subject.title} is only ${money(diff)} more than ${other.title}` };
      }
    }
  }
  return { itemId: by.has(group.fallback) ? group.fallback : members[0].id, reason: '' };
}

/** The other items in an item's group (none if it isn't in one). */
export function groupSiblings<T extends Pick<WishItem, 'id' | 'group'>>(list: { items: T[] }, itemId: string): T[] {
  const item = list.items.find((i) => i.id === itemId);
  return item?.group ? list.items.filter((i) => i.group === item.group && i.id !== itemId) : [];
}

const cleanIso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '');

type Loose = Record<string, any>;

export function normalizeReceived(raw: unknown, newId: () => string): ReceivedGroup[] {
  const groups: ReceivedGroup[] = [];
  const seen = new Set<string>();
  for (const g of (Array.isArray(raw) ? raw : []).slice(0, MAX_RECEIVED_GROUPS) as Loose[]) {
    if (!g || typeof g !== 'object') continue;
    const id = isId(g.id) && !seen.has(g.id) ? g.id : newId();
    seen.add(id);
    const items: ReceivedItem[] = [];
    for (const it of (Array.isArray(g.items) ? g.items : []).slice(0, MAX_ITEMS) as Loose[]) {
      if (!it || typeof it !== 'object') continue;
      const givers = (Array.isArray(it.givers) ? it.givers : []).slice(0, 20).map((x: Loose) => ({
        name: cleanText(x?.name, 40), qty: cleanQuantity(x?.qty ?? 1),
      }));
      items.push({
        id: isId(it.id) ? it.id : newId(),
        title: cleanText(it.title, 200) || 'Something I wanted',
        url: cleanUrl(it.url),
        image: isId(it.image) ? it.image : '',
        price: cleanPrice(it.price),
        currency: cleanCurrency(it.currency),
        store: cleanText(it.store, 80),
        quantity: cleanQuantity(it.quantity ?? 1),
        listName: cleanText(it.listName, 60),
        givers,
        claimedAt: cleanIso(it.claimedAt),
        thanked: it.thanked === true,
      });
    }
    groups.push({ id, name: cleanText(g.name, 60) || 'Received', at: cleanIso(g.at), items });
  }
  return groups;
}

export function normalizeWishlist(raw: unknown, newId: () => string = () => `x${Math.random().toString(36).slice(2, 10)}`): WishlistData {
  const lists: WishList[] = [];
  const seen = new Set<string>();
  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as { lists?: unknown; received?: unknown; lastTidyAt?: unknown };
  const source = Array.isArray(rawObj.lists) ? (rawObj.lists as unknown[]) : [];
  for (const entry of source.slice(0, MAX_LISTS)) {
    const list = normalizeList(entry, newId(), newId);
    if (seen.has(list.id)) continue;
    seen.add(list.id);
    lists.push(list);
  }
  return { lists, received: normalizeReceived(rawObj.received, newId), lastTidyAt: cleanIso(rawObj.lastTidyAt) };
}

// ---- Changes the owner can make ------------------------------------------------

export type ListFields = Partial<Pick<WishList, 'name' | 'emoji' | 'person' | 'occasion' | 'date' | 'note'>>;
export type ItemFields = Partial<Omit<WishItem, 'id' | 'addedAt'>>;

export type WishlistAction =
  | { type: 'addList'; id?: string; kind?: ListKind; fields?: ListFields }
  | { type: 'updateList'; id: string; fields: ListFields }
  | { type: 'removeList'; id: string }
  | { type: 'moveList'; id: string; dir: -1 | 1 }
  | { type: 'addItem'; listId: string; id?: string; item: ItemFields }
  | { type: 'updateItem'; listId: string; id: string; fields: ItemFields }
  | { type: 'removeItem'; listId: string; id: string }
  | { type: 'moveItem'; listId: string; id: string; dir: -1 | 1 }
  | { type: 'transferItem'; listId: string; id: string; toListId: string }
  | { type: 'saveGroup'; listId: string; id?: string; name?: string; itemIds: string[]; rules?: PriceRule[]; fallback?: string }
  | { type: 'removeGroup'; listId: string; id: string };

/** What only the site sets: an item's group changes through saveGroup, its check fields through the price check. */
function ownerFields(fields: unknown): Record<string, unknown> {
  const copy = { ...((fields && typeof fields === 'object' ? fields : {}) as Record<string, unknown>) };
  delete copy.group;
  delete copy.checkedAt;
  delete copy.checkNote;
  return copy;
}

function findList(data: WishlistData, id: unknown): WishList {
  const list = isId(id) ? data.lists.find((l) => l.id === id) : undefined;
  if (!list) throw new WishlistInputError('That list isn’t there any more.');
  return list;
}
function findItem(list: WishList, id: unknown): number {
  const index = isId(id) ? list.items.findIndex((i) => i.id === id) : -1;
  if (index < 0) throw new WishlistInputError('That item isn’t there any more.');
  return index;
}

function shift<T>(array: T[], index: number, dir: number) {
  const to = index + (dir < 0 ? -1 : 1);
  if (to < 0 || to >= array.length) return;
  [array[index], array[to]] = [array[to], array[index]];
}

/** Apply one change in place. Throws WishlistInputError for anything that doesn't make sense. */
export function applyWishlistAction(data: WishlistData, action: WishlistAction, newId: () => string, now = new Date()): void {
  switch (action?.type) {
    case 'addList': {
      if (data.lists.length >= MAX_LISTS) throw new WishlistInputError(`That’s the most lists (${MAX_LISTS}).`);
      const id = isId(action.id) && !data.lists.some((l) => l.id === action.id) ? action.id : newId();
      data.lists.push(normalizeList({ ...(action.fields ?? {}), id, kind: action.kind, items: [] }, id, newId));
      return;
    }
    case 'updateList': {
      const list = findList(data, action.id);
      const next = normalizeList({ ...list, ...pick(action.fields, ['name', 'emoji', 'person', 'occasion', 'date', 'note']) }, list.id, newId);
      Object.assign(list, { name: next.name, emoji: next.emoji, person: next.person, occasion: next.occasion, date: next.date, note: next.note });
      return;
    }
    case 'removeList':
      findList(data, action.id);
      data.lists = data.lists.filter((l) => l.id !== action.id);
      return;
    case 'moveList': {
      findList(data, action.id);
      shift(data.lists, data.lists.findIndex((l) => l.id === action.id), action.dir);
      return;
    }
    case 'addItem': {
      const list = findList(data, action.listId);
      if (list.items.length >= MAX_ITEMS) throw new WishlistInputError(`That list is full (${MAX_ITEMS} items).`);
      const id = isId(action.id) && !list.items.some((i) => i.id === action.id) ? action.id : newId();
      const item = normalizeItem({ ...ownerFields(action.item), id }, id, now);
      if (!item.title && !item.url) throw new WishlistInputError('Give it a name or a link.');
      if (!item.title) item.title = item.store || 'Something I want';
      list.items.push(item);
      return;
    }
    case 'updateItem': {
      const list = findList(data, action.listId);
      const index = findItem(list, action.id);
      const old = list.items[index];
      const merged = normalizeItem({ ...old, ...ownerFields(action.fields), id: old.id, addedAt: old.addedAt }, old.id, now);
      if (!merged.title) merged.title = old.title || 'Something I want';
      list.items[index] = merged;
      return;
    }
    case 'removeItem': {
      const list = findList(data, action.listId);
      list.items.splice(findItem(list, action.id), 1);
      list.groups = normalizeGroups(list.groups, list.items);
      return;
    }
    case 'moveItem': {
      const list = findList(data, action.listId);
      shift(list.items, findItem(list, action.id), action.dir);
      return;
    }
    case 'transferItem': {
      const from = findList(data, action.listId);
      const to = findList(data, action.toListId);
      if (from === to) return;
      if (to.items.length >= MAX_ITEMS) throw new WishlistInputError('The other list is full.');
      const [item] = from.items.splice(findItem(from, action.id), 1);
      to.items.push({ ...item, group: '' });
      from.groups = normalizeGroups(from.groups, from.items);
      return;
    }
    case 'saveGroup': {
      const list = findList(data, action.listId);
      const ids = new Set((Array.isArray(action.itemIds) ? action.itemIds : []).filter((id) => list.items.some((i) => i.id === id)));
      if (ids.size < 2) throw new WishlistInputError('Pick at least two things that could stand in for each other.');
      const existing = isId(action.id) ? list.groups.find((g) => g.id === action.id) : undefined;
      if (!existing && list.groups.length >= MAX_GROUPS) throw new WishlistInputError(`That’s the most groups for one list (${MAX_GROUPS}).`);
      const id = existing?.id ?? (isId(action.id) ? action.id : newId());
      for (const item of list.items) {
        if (ids.has(item.id)) item.group = id;
        else if (item.group === id) item.group = '';
      }
      const raw = { id, name: action.name, rules: action.rules, fallback: action.fallback };
      list.groups = normalizeGroups(existing ? list.groups.map((g) => (g.id === id ? raw : g)) : [...list.groups, raw], list.items);
      return;
    }
    case 'removeGroup': {
      const list = findList(data, action.listId);
      if (!list.groups.some((g) => g.id === action.id)) throw new WishlistInputError('That group isn’t there any more.');
      for (const item of list.items) if (item.group === action.id) item.group = '';
      list.groups = list.groups.filter((g) => g.id !== action.id);
      return;
    }
    default:
      throw new WishlistInputError('That change isn’t one I know.');
  }
}

function pick(source: unknown, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source && typeof source === 'object') for (const k of keys) if (k in (source as object)) out[k] = (source as Record<string, unknown>)[k];
  return out;
}

/** Set (or clear, with null) a list's share token. Only "mine" lists can be shared. */
export function setShareToken(data: WishlistData, listId: string, token: string | null): WishList {
  const list = findList(data, listId);
  if (token && list.kind !== 'mine') throw new WishlistInputError('Only your own wishes can be shared, not gift ideas for someone else.');
  list.shareToken = token;
  return list;
}

// ---- What each kind of viewer is allowed to see ------------------------------

export type ItemView = Omit<WishItem, 'image'> & { imageUrl: string | null };
export type OwnerList = Omit<WishList, 'items'> & { items: ItemView[] };

const itemView = (item: WishItem, imageUrl: (id: string) => string): ItemView => {
  const { image, ...rest } = item;
  return { ...rest, imageUrl: image ? imageUrl(image) : null };
};

/**
 * What the owner's pages get. Built from a whitelist, and the stored data has no
 * claims in it at all, so there is nothing about who's getting what to leak.
 */
export function ownerView(data: WishlistData, imageUrl: (id: string) => string): OwnerList[] {
  return data.lists.map((list) => ({ ...list, items: list.items.map((i) => itemView(i, imageUrl)) }));
}

export type Claim = { id: string; itemId: string; /** who: "k:<hash of a browser key>" or "u:<account id>" */ who: string; name: string; note: string; qty: number; at: string };

/** One claim as the claimer sees it. */
export type MyClaim = { qty: number; name: string; note: string };

export type GiverItem = Omit<ItemView, 'checkedAt' | 'checkNote'> & {
  /** How many of the wanted ones are already spoken for (by anyone). */
  claimed: number;
  /** This viewer's own claim, so they can change or undo it. */
  mine: MyClaim | null;
  /** Someone is getting another item in its group, which covers this one too. */
  groupTaken: boolean;
};
/** A group as givers see it: which item is on top and why. */
export type GiverGroup = { id: string; name: string; pick: string; reason: string };
export type GiverList = {
  id: string;
  name: string;
  emoji: string;
  occasion: string;
  date: string;
  note: string;
  items: GiverItem[];
  groups: GiverGroup[];
};

/**
 * The list as someone other than the owner sees it, with claims. "Got it myself"
 * items are left out, and so is the rest of their group: any one of those would do.
 */
export function giverView(list: WishList, claims: Claim[], who: string | null, imageUrl: (id: string) => string): GiverList {
  const done = new Set(list.items.filter((i) => i.gotIt && i.group).map((i) => i.group));
  return {
    id: list.id,
    name: list.name,
    emoji: list.emoji,
    occasion: list.occasion,
    date: list.date,
    note: list.note,
    items: list.items
      .filter((item) => !item.gotIt && !(item.group && done.has(item.group)))
      .map((item) => {
        const mine = who ? claims.find((c) => c.itemId === item.id && c.who === who) : undefined;
        const { checkedAt, checkNote, ...view } = itemView(item, imageUrl);
        void checkedAt; void checkNote;
        const siblings = new Set(groupSiblings(list, item.id).map((i) => i.id));
        return {
          ...view,
          claimed: claims.filter((c) => c.itemId === item.id).reduce((sum, c) => sum + c.qty, 0),
          mine: mine ? { qty: mine.qty, name: mine.name, note: mine.note } : null,
          groupTaken: claims.some((c) => siblings.has(c.itemId)),
        };
      }),
    groups: list.groups.filter((g) => !done.has(g.id)).flatMap((g) => {
      const pick = pickOfGroup(g, list.items);
      return pick ? [{ id: g.id, name: g.name, pick: pick.itemId, reason: pick.reason }] : [];
    }),
  };
}

/** The list for its owner opening their own share link: the giver layout, minus every claim. */
export function ownerPreview(list: WishList, imageUrl: (id: string) => string): GiverList {
  const view = giverView(list, [], null, imageUrl);
  return { ...view, items: view.items.map((item) => { const { claimed, mine, groupTaken, ...rest } = item; void claimed; void mine; void groupTaken; return rest as GiverItem; }) };
}

// ---- Money and text ----------------------------------------------------------

export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: price % 1 === 0 ? 0 : 2 }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

/** Total cost of the must-haves still wanted (price x quantity), one figure per currency. */
export function mustHaveTotal(list: { items: Pick<WishItem, 'priority' | 'gotIt' | 'price' | 'currency' | 'quantity'>[] }): string {
  const totals = new Map<string, number>();
  for (const item of list.items) {
    if (item.priority !== 'must' || item.gotIt || item.price === null) continue;
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.price * item.quantity);
  }
  return [...totals].map(([currency, sum]) => formatPrice(Math.round(sum * 100) / 100, currency)).join(' + ');
}

const PRIORITY_ORDER: Record<Priority, number> = { must: 0, love: 1, nice: 2 };

export type SortMode = 'mine' | 'priority' | 'price-low' | 'price-high';

/** A sorted copy for display ("mine" keeps the list's own order). Unpriced items go last. */
export function sortItems<T extends { priority: Priority; price: number | null }>(items: T[], mode: SortMode): T[] {
  if (mode === 'mine') return items;
  const copy = [...items];
  const price = (i: T, empty: number) => (i.price === null ? empty : i.price);
  if (mode === 'priority') copy.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  if (mode === 'price-low') copy.sort((a, b) => price(a, Infinity) - price(b, Infinity));
  if (mode === 'price-high') copy.sort((a, b) => price(b, -Infinity) - price(a, -Infinity));
  return copy;
}

/** A list as plain text to paste into a message. */
export function listAsText(list: Pick<WishList, 'name' | 'emoji' | 'occasion' | 'note'> & { items: Pick<WishItem, 'title' | 'url' | 'price' | 'currency' | 'quantity' | 'note' | 'gotIt'>[] }): string {
  const lines = [`${list.emoji} ${list.name}${list.occasion ? ` (${list.occasion})` : ''}`];
  if (list.note) lines.push(list.note);
  lines.push('');
  for (const item of list.items.filter((i) => !i.gotIt)) {
    const bits = [formatPrice(item.price, item.currency), item.quantity > 1 ? `x${item.quantity}` : '', item.note].filter(Boolean);
    lines.push(`- ${item.title}${bits.length ? ` (${bits.join(', ')})` : ''}${item.url ? `\n  ${item.url}` : ''}`);
  }
  return lines.join('\n').trim();
}

// ---- Laying a list out with its groups ------------------------------------------

export type Arranged<T> =
  | { kind: 'item'; item: T }
  | { kind: 'group'; id: string; name: string; pick: string; reason: string; items: T[] };

/**
 * Items in display order, with each group's items gathered into one block where
 * its first item would be, the picked one first. Items of a group not in `groups`
 * stay plain items.
 */
export function arrangeGroups<T extends { id: string; group: string }>(items: T[], groups: { id: string; name: string; pick: string; reason: string }[]): Arranged<T>[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: Arranged<T>[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const group = item.group ? byId.get(item.group) : undefined;
    if (!group) { out.push({ kind: 'item', item }); continue; }
    if (placed.has(group.id)) continue;
    placed.add(group.id);
    const members = items.filter((i) => i.group === group.id);
    members.sort((a, b) => Number(b.id === group.pick) - Number(a.id === group.pick));
    out.push({ kind: 'group', id: group.id, name: group.name, pick: group.pick, reason: group.reason, items: members });
  }
  return out;
}
