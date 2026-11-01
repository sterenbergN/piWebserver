import { markupLength, resolveZipPath } from '@/lib/reader/items';
import { ZipReader } from '@/lib/reader/zip';
import type { FlowSource, TocEntry } from '../source';

// An EPUB: find its reading order and contents in the zip, and turn each chapter into
// a self-contained page for the reader's frame. Pictures, fonts and styles become blob
// addresses, and anything that could run or reach the network is removed. The CSP on
// each page (below) stops whatever that misses: a book is someone else's file.

export const BOOK_CSP = "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; font-src blob: data:; media-src blob:";

const REMOVE = 'script, iframe, object, embed, applet, base, meta, form, noscript, link, title';

/** Parse a chapter, leniently: plenty of books aren't quite the XHTML they claim. */
function parseChapter(markup: string) {
  const xml = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
  if (!xml.querySelector('parsererror') && xml.querySelector('body')) return xml;
  return new DOMParser().parseFromString(markup, 'text/html');
}

function cleanAttributes(root: Element) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

/** A parsed document as one safe HTML page, ready for the frame. */
export function toSafePage(doc: Document, styles: string[], extraHead = '') {
  const page = document.implementation.createHTMLDocument('');
  doc.querySelectorAll(REMOVE).forEach((el) => el.remove());
  const body = doc.querySelector('body');
  if (body) {
    cleanAttributes(body);
    for (const attr of [...body.attributes]) page.body.setAttribute(attr.name, attr.value);
    for (const child of [...body.childNodes]) page.body.appendChild(page.importNode(child, true));
  }
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BOOK_CSP}">${styles.map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`).join('')}${extraHead}`;
  return `<!doctype html><html><head>${head}</head>${page.body.outerHTML}</html>`;
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4',
};

export type EpubInfo = { title: string; author: string; coverPath: string | null };

type Package = EpubInfo & {
  opfPath: string;
  items: Map<string, { path: string; type: string; properties: string }>;
  spine: string[];
  ncxId: string | null;
};

const byLocalName = (root: Document | Element, name: string) => [...root.getElementsByTagNameNS('*', name)];

async function readPackage(zip: ZipReader): Promise<Package> {
  const container = new DOMParser().parseFromString(await zip.text('META-INF/container.xml'), 'application/xml');
  const opfPath = byLocalName(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('This EPUB has no contents list.');
  const opf = new DOMParser().parseFromString(await zip.text(opfPath), 'application/xml');
  const items = new Map<string, { path: string; type: string; properties: string }>();
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) items.set(id, { path: resolveZipPath(opfPath, href), type: item.getAttribute('media-type') ?? '', properties: item.getAttribute('properties') ?? '' });
  }
  const spineEl = byLocalName(opf, 'spine')[0];
  const spine = byLocalName(opf, 'itemref').map((ref) => items.get(ref.getAttribute('idref') ?? '')?.path).filter((p): p is string => !!p);
  if (!spine.length) throw new Error('This EPUB has no chapters.');

  const coverId = byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const cover = [...items.values()].find((item) => item.properties.split(/\s+/).includes('cover-image')) ?? (coverId ? items.get(coverId) : undefined);
  return {
    opfPath, items, spine,
    title: byLocalName(opf, 'title')[0]?.textContent?.trim() ?? '',
    author: byLocalName(opf, 'creator').map((c) => c.textContent?.trim()).filter(Boolean).join(', '),
    coverPath: cover?.type.startsWith('image/') ? cover.path : null,
    ncxId: spineEl?.getAttribute('toc') ?? null,
  };
}

export async function readEpubInfo(blob: Blob) {
  const zip = await ZipReader.open(blob);
  const info = await readPackage(zip);
  return { title: info.title, author: info.author, cover: info.coverPath ? new Blob([new Uint8Array(await zip.bytes(info.coverPath))]) : null };
}

async function readToc(zip: ZipReader, pkg: Package, sectionOf: Map<string, number>) {
  const entries: TocEntry[] = [];
  const add = (label: string, href: string, from: string, depth: number) => {
    const section = sectionOf.get(resolveZipPath(from, href));
    if (section === undefined || !label.trim()) return;
    entries.push({ label: label.trim().replace(/\s+/g, ' '), depth, section, fragment: href.split('#')[1] });
  };

  const nav = [...pkg.items.values()].find((item) => item.properties.split(/\s+/).includes('nav'));
  if (nav) {
    const doc = parseChapter(await zip.text(nav.path));
    const navEl = [...doc.querySelectorAll('nav')].find((el) => (el.getAttribute('epub:type') ?? el.getAttributeNS('http://www.idpf.org/2007/ops', 'type')) === 'toc') ?? doc.querySelector('nav');
    const walk = (list: Element, depth: number) => {
      for (const li of list.children) {
        const link = [...li.children].find((c) => c.tagName.toLowerCase() === 'a');
        if (link) add(link.textContent ?? '', link.getAttribute('href') ?? '', nav.path, depth);
        const nested = [...li.children].find((c) => c.tagName.toLowerCase() === 'ol');
        if (nested) walk(nested, depth + 1);
      }
    };
    const list = navEl?.querySelector('ol');
    if (list) walk(list, 0);
    if (entries.length) return entries;
  }

  const ncx = (pkg.ncxId && pkg.items.get(pkg.ncxId)) || [...pkg.items.values()].find((item) => item.type === 'application/x-dtbncx+xml');
  if (ncx) {
    const doc = new DOMParser().parseFromString(await zip.text(ncx.path), 'application/xml');
    const walk = (parent: Element, depth: number) => {
      for (const point of parent.children) {
        if (point.localName !== 'navPoint') continue;
        const label = byLocalName(point, 'text')[0]?.textContent ?? '';
        add(label, byLocalName(point, 'content')[0]?.getAttribute('src') ?? '', ncx.path, depth);
        walk(point, depth + 1);
      }
    };
    const map = byLocalName(doc, 'navMap')[0];
    if (map) walk(map, 0);
  }
  return entries;
}

export async function openEpub(blob: Blob): Promise<FlowSource> {
  const zip = await ZipReader.open(blob);
  const pkg = await readPackage(zip);
  const sectionOf = new Map(pkg.spine.map((path, i) => [path, i]));
  const toc = await readToc(zip, pkg, sectionOf);

  const urls = new Map<string, Promise<string>>();
  const assetUrl = (path: string) => {
    const known = urls.get(path);
    if (known) return known;
    const made = zip.bytes(path).then((bytes) => {
      const type = MEDIA_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
      return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
    }).catch(() => '');
    urls.set(path, made);
    return made;
  };

  /** Point a stylesheet's url(...)s at the book's own files. */
  const rewriteCss = async (css: string, from: string) => {
    let out = css.replace(/@import[^;]+;/gi, '');
    const refs = [...new Set([...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => m[1]))];
    for (const ref of refs) {
      if (/^(data|blob|https?):/i.test(ref)) continue;
      const url = await assetUrl(resolveZipPath(from, ref));
      out = out.split(ref).join(url);
    }
    return out;
  };

  const loadSection = async (index: number) => {
    const path = pkg.spine[index];
    const doc = parseChapter(await zip.text(path));
    const styles: string[] = [];
    for (const el of doc.querySelectorAll('link, style')) {
      if (el.localName === 'style') {
        styles.push(await rewriteCss(el.textContent ?? '', path));
      } else if (/stylesheet/i.test(el.getAttribute('rel') ?? '') && el.getAttribute('href')) {
        const sheet = resolveZipPath(path, el.getAttribute('href')!);
        const text = await zip.text(sheet).catch(() => '');
        if (text) styles.push(await rewriteCss(text, sheet));
      }
    }
    doc.querySelectorAll('style').forEach((el) => el.remove());

    const XLINK = 'http://www.w3.org/1999/xlink';
    for (const el of doc.querySelectorAll('img, image, source, audio, video')) {
      for (const attr of ['src', 'href', 'poster']) {
        const value = el.getAttribute(attr);
        if (value && !/^(data|blob):/i.test(value)) el.setAttribute(attr, await assetUrl(resolveZipPath(path, value)));
      }
      const xlink = el.getAttributeNS(XLINK, 'href');
      if (xlink && !/^(data|blob):/i.test(xlink)) el.setAttributeNS(XLINK, 'xlink:href', await assetUrl(resolveZipPath(path, xlink)));
    }
    for (const el of doc.querySelectorAll('[style]')) {
      if (/url\(/i.test(el.getAttribute('style') ?? '')) el.setAttribute('style', await rewriteCss(el.getAttribute('style') ?? '', path));
    }
    return toSafePage(doc, styles);
  };

  const sections = await Promise.all(pkg.spine.map(async (path, index) => ({
    length: markupLength(await zip.text(path).catch(() => '')),
    load: () => loadSection(index),
  })));

  return {
    toc,
    sections,
    resolve: (from, href) => {
      const [file, fragment] = href.split('#');
      if (!file) return { section: from, fragment };
      const section = sectionOf.get(resolveZipPath(pkg.spine[from], href));
      return section === undefined ? null : { section, fragment };
    },
    destroy: () => {
      for (const made of urls.values()) void made.then((url) => { if (url) URL.revokeObjectURL(url); });
    },
  };
}
