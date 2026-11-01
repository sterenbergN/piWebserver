import { flowPage, type Anchor } from '@/lib/reader/items';
import { THEME_COLORS, type Engine, type FlowSource, type InkOrigin, type ReaderSettings, type TocEntry } from '../source';

// Flowing text, one screen at a time. Each chapter sits in its own iframe, laid out in
// columns exactly one screen wide, and turning a page slides the frame along. The frame
// has no scripts and takes no touches: taps, swipes and pen strokes land on the layer
// above, and this code answers questions about what's underneath them.

type Frame = {
  section: number;
  el: HTMLIFrameElement;
  doc: Document;
  nodes: Text[];
  /** Offset of each text node's first character. */
  starts: number[];
  chars: number;
  pages: number;
  firstOnPage: Map<number, number>;
  rects: Map<number, DOMRect | null>;
};

const FONT_STACKS = {
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const WIDEST_LINE = 720;

export function pagePadding(width: number) {
  return Math.round(Math.max(width < 500 ? 22 : 44, (width - WIDEST_LINE) / 2));
}

function frameCss(width: number, height: number, settings: ReaderSettings) {
  const { bg, fg, link } = THEME_COLORS[settings.theme];
  const pad = pagePadding(width);
  const family = settings.font === 'book' ? '' : `font-family: ${FONT_STACKS[settings.font]} !important;`;
  return `
    html {
      margin: 0 !important; padding: 0 ${pad}px !important; box-sizing: border-box !important;
      width: ${width}px !important; height: ${height}px !important; max-width: none !important;
      column-width: ${width - 2 * pad}px !important; column-gap: ${2 * pad}px !important; column-fill: auto !important;
      overflow: hidden !important; background: ${bg} !important; color: ${fg} !important;
      -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important; overflow-wrap: break-word;
    }
    body {
      margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important; max-width: none !important; min-height: 0 !important;
      background: transparent !important; color: inherit !important;
      font-size: ${settings.fontSize}px !important; line-height: ${settings.lineHeight} !important; ${family}
    }
    * { color: inherit !important; background-color: transparent !important; border-color: currentColor; }
    ${family ? `p, li, div, span, blockquote, dd, dt, td, th, em, i, b, strong, h1, h2, h3, h4, h5, h6 { ${family} }` : ''}
    p, li, blockquote, dd { line-height: inherit !important; }
    a, a * { color: ${link} !important; }
    img, svg, video { max-width: 100% !important; max-height: ${height - 8}px !important; height: auto; object-fit: contain; break-inside: avoid; }
    pre { white-space: pre-wrap !important; }
    table { max-width: 100%; }
    h1, h2, h3, h4 { break-after: avoid; line-height: 1.25 !important; }
  `;
}

/** A chapter laid out for a screen or font that's since changed. Whoever asked no longer matters. */
class StaleLayout extends Error {}

const ignoreStale = (error: unknown) => {
  if (!(error instanceof StaleLayout)) throw error;
};

export class FlowEngine implements Engine {
  readonly kind = 'flow';
  readonly toc: TocEntry[];
  readonly totalPages: number;
  private host: HTMLDivElement;
  private starts: number[] = [];
  private total = 0;
  private frames = new Map<number, Frame>();
  private loading = new Map<number, Promise<Frame>>();
  private cur: Frame | null = null;
  private page = 0;
  private width = 0;
  private height = 0;
  private generation = 0;
  private destroyed = false;
  /** Where you were, while a new layout is being worked out. */
  private holding: Anchor | null = null;

  constructor(stage: HTMLElement, private source: FlowSource, private settings: ReaderSettings, private onChange: () => void) {
    this.toc = source.toc;
    this.host = document.createElement('div');
    this.host.className = 'rd-flow';
    stage.appendChild(this.host);
    let at = 0;
    for (const section of source.sections) {
      this.starts.push(at);
      at += section.length;
    }
    this.total = Math.max(1, at);
    this.totalPages = flowPage(this.total - 1);
  }

  private measure() {
    this.width = Math.floor(this.host.clientWidth);
    this.height = Math.floor(this.host.clientHeight);
  }

  private async frame(section: number): Promise<Frame> {
    const held = this.frames.get(section);
    if (held) return held;
    const pending = this.loading.get(section);
    if (pending) return pending;
    const generation = this.generation;
    const made = this.build(section, generation).finally(() => {
      if (this.loading.get(section) === made) this.loading.delete(section);
    });
    this.loading.set(section, made);
    return made;
  }

  private async build(section: number, generation: number): Promise<Frame> {
    const html = await this.source.sections[section].load();
    const el = document.createElement('iframe');
    // No allow-scripts: nothing in a book can run. Same origin only so this code can measure it.
    el.setAttribute('sandbox', 'allow-same-origin');
    el.setAttribute('scrolling', 'no');
    el.setAttribute('tabindex', '-1');
    el.title = 'Book page';
    el.className = 'rd-frame';
    el.style.width = `${this.width}px`;
    el.style.height = `${this.height}px`;
    el.style.visibility = 'hidden';
    const css = frameCss(this.width, this.height, this.settings);
    const at = html.indexOf('</head>');
    const withStyle = `${html.slice(0, at)}<style>${css}</style>${html.slice(at)}`;
    const loaded = new Promise<void>((resolve) => el.addEventListener('load', () => resolve(), { once: true }));
    el.srcdoc = withStyle;
    this.host.appendChild(el);
    await loaded;
    const doc = el.contentDocument;
    if (!doc) throw new Error('This chapter wouldn’t open.');

    // Fonts and pictures change where the columns fall, so wait for them, within reason.
    const pictures = [...doc.images].filter((img) => !img.complete).map((img) => new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }));
    await Promise.race([Promise.all([doc.fonts?.ready, ...pictures]), new Promise((resolve) => setTimeout(resolve, 2000))]);

    const nodes: Text[] = [];
    const starts: number[] = [];
    let chars = 0;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.length) continue;
      nodes.push(node);
      starts.push(chars);
      chars += node.length;
    }
    const pages = Math.max(1, Math.ceil((doc.documentElement.scrollWidth - 2) / this.width));
    // The frame is as wide as all its columns, and the host clips it to one screen.
    el.style.width = `${pages * this.width}px`;

    const frame: Frame = { section, el, doc, nodes, starts, chars, pages, firstOnPage: new Map([[0, 0]]), rects: new Map() };
    if (generation !== this.generation || this.destroyed) {
      el.remove();
      throw new StaleLayout();
    }
    this.frames.set(section, frame);
    return frame;
  }

  private rectOf(frame: Frame, offset: number): DOMRect | null {
    const known = frame.rects.get(offset);
    if (known !== undefined) return known;
    let found: DOMRect | null = null;
    if (frame.nodes.length) {
      const clamped = Math.max(0, Math.min(frame.chars - 1, offset));
      const range = frame.doc.createRange();
      // Collapsed whitespace has no box, so look at the next characters until one does.
      let index = this.nodeAt(frame, clamped);
      let local = clamped - frame.starts[index];
      for (let tries = 0; tries < 400 && index < frame.nodes.length; tries++) {
        const node = frame.nodes[index];
        if (local >= node.length) { index++; local = 0; continue; }
        range.setStart(node, local);
        range.setEnd(node, local + 1);
        const rect = [...range.getClientRects()].find((r) => r.width > 0 || r.height > 0);
        if (rect) { found = rect; break; }
        local++;
      }
    }
    frame.rects.set(offset, found);
    return found;
  }

  private nodeAt(frame: Frame, offset: number) {
    let lo = 0;
    let hi = frame.starts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (frame.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private pageOf(frame: Frame, offset: number) {
    const rect = this.rectOf(frame, offset);
    return rect ? Math.max(0, Math.min(frame.pages - 1, Math.floor((rect.left + 1) / this.width))) : 0;
  }

  /** The first character on a page: found by bisecting, since there's no way to ask directly. */
  private firstOn(frame: Frame, page: number) {
    const known = frame.firstOnPage.get(page);
    if (known !== undefined) return known;
    let lo = 0;
    let hi = frame.chars;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.pageOf(frame, mid) >= page) hi = mid;
      else lo = mid + 1;
    }
    frame.firstOnPage.set(page, lo);
    return lo;
  }

  private place(frame: Frame, page: number, animate: boolean) {
    const previous = this.cur;
    if (previous && previous !== frame) previous.el.style.visibility = 'hidden';
    frame.el.style.transition = animate && previous === frame ? 'transform 0.2s ease-out' : 'none';
    frame.el.style.transform = `translate3d(${-page * this.width}px, 0, 0)`;
    frame.el.style.visibility = 'visible';
    this.cur = frame;
    this.page = page;
    this.onChange();
    this.tidyAndPreload();
  }

  /** Keep this chapter and its neighbours laid out, so turning into them is instant. */
  private tidyAndPreload() {
    const at = this.cur?.section ?? 0;
    for (const [section, frame] of this.frames) {
      if (Math.abs(section - at) > 1) {
        frame.el.remove();
        this.frames.delete(section);
      }
    }
    const generation = this.generation;
    const later = () => {
      if (generation !== this.generation || this.destroyed) return;
      if (at + 1 < this.source.sections.length) this.frame(at + 1).catch(() => {});
      if (at > 0) this.frame(at - 1).catch(() => {});
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(later, { timeout: 800 });
    else setTimeout(later, 250);
  }

  async open(at: Anchor | null) {
    this.measure();
    await this.goTo(at ?? { page: 1, s: 0, o: 0 });
  }

  async goTo(anchor: Anchor) {
    const section = Math.max(0, Math.min(this.source.sections.length - 1, anchor.s ?? this.sectionForPage(anchor.page)));
    try {
      const frame = await this.frame(section);
      const page = anchor.col != null ? Math.min(anchor.col, frame.pages - 1) : this.pageOf(frame, anchor.o ?? 0);
      this.place(frame, page, false);
    } catch (error) {
      ignoreStale(error);
    }
  }

  private sectionForPage(page: number) {
    const chars = (page - 1) * 1500;
    let section = 0;
    while (section + 1 < this.starts.length && this.starts[section + 1] <= chars) section++;
    return section;
  }

  async goToToc(entry: TocEntry) {
    await this.goToFragment(entry.section, entry.fragment);
  }

  private async goToFragment(section: number, fragment?: string) {
    const frame = await this.frame(section).catch((error) => { ignoreStale(error); return null; });
    if (!frame) return;
    const target = fragment ? frame.doc.getElementById(fragment) ?? frame.doc.getElementsByName(fragment)[0] : null;
    const left = target?.getBoundingClientRect().left ?? 0;
    this.place(frame, Math.max(0, Math.min(frame.pages - 1, Math.floor((left + 1) / this.width))), false);
  }

  async goToFraction(fraction: number) {
    const chars = Math.max(0, Math.min(this.total - 1, fraction * this.total));
    let section = 0;
    while (section + 1 < this.starts.length && this.starts[section + 1] <= chars) section++;
    await this.goTo({ page: flowPage(chars), s: section, o: Math.round(chars - this.starts[section]) });
  }

  async next() {
    const frame = this.cur;
    if (!frame) return;
    if (this.page + 1 < frame.pages) return this.place(frame, this.page + 1, true);
    if (frame.section + 1 < this.source.sections.length) {
      const after = await this.frame(frame.section + 1).catch((error) => { ignoreStale(error); return null; });
      if (after) this.place(after, 0, false);
    }
  }

  async prev() {
    const frame = this.cur;
    if (!frame) return;
    if (this.page > 0) return this.place(frame, this.page - 1, true);
    if (frame.section > 0) {
      const before = await this.frame(frame.section - 1).catch((error) => { ignoreStale(error); return null; });
      if (before) this.place(before, before.pages - 1, false);
    }
  }

  private chapterOf(section: number) {
    let label: string | undefined;
    for (const entry of this.toc) {
      if (entry.section <= section) label = entry.label;
      else break;
    }
    return label;
  }

  here(): Anchor {
    const frame = this.cur;
    if (!frame) return this.holding ?? { page: 1, s: 0, o: 0 };
    const o = this.firstOn(frame, this.page);
    const anchor: Anchor = { page: flowPage(this.starts[frame.section] + o), s: frame.section, o };
    const chapter = this.chapterOf(frame.section);
    if (chapter) anchor.chapter = chapter;
    // A page of nothing but a picture: nothing to hold on to but its place in the chapter.
    if (this.page > 0 && (o >= frame.chars || this.pageOf(frame, o) !== this.page)) anchor.col = this.page;
    return anchor;
  }

  fraction() {
    const frame = this.cur;
    if (!frame) return 0;
    return Math.min(1, (this.starts[frame.section] + this.firstOn(frame, this.page)) / this.total);
  }

  atEnd() {
    const frame = this.cur;
    return !!frame && frame.section === this.source.sections.length - 1 && this.page === frame.pages - 1;
  }

  async layout(settings: ReaderSettings) {
    const at = this.here();
    this.holding = at;
    this.settings = settings;
    this.generation += 1;
    for (const frame of this.frames.values()) frame.el.remove();
    this.frames.clear();
    this.loading.clear();
    this.cur = null;
    this.measure();
    await this.goTo(at);
  }

  onScreen(anchor: Anchor) {
    const frame = this.cur;
    if (!frame || anchor.s !== frame.section) return false;
    if (anchor.col != null) return anchor.col === this.page;
    return this.pageOf(frame, anchor.o ?? 0) === this.page;
  }

  private hostOrigin() {
    return { x: this.host.offsetLeft, y: this.host.offsetTop };
  }

  project(anchor: Anchor): InkOrigin | null {
    const frame = this.cur;
    if (!frame || !this.onScreen(anchor)) return null;
    const host = this.hostOrigin();
    const scale = this.settings.fontSize;
    if (anchor.col != null) return { ox: host.x, oy: host.y, scale };
    const rect = this.rectOf(frame, anchor.o ?? 0);
    if (!rect) return { ox: host.x, oy: host.y, scale };
    return { ox: rect.left - this.page * this.width + host.x, oy: rect.top + host.y, scale };
  }

  anchorAt(x: number, y: number) {
    const here = this.here();
    const frame = this.cur;
    const host = this.hostOrigin();
    const scale = this.settings.fontSize;
    const plain = { anchor: here, origin: { ox: host.x, oy: host.y, scale } };
    if (!frame || !frame.chars) return { ...plain, anchor: { ...here, col: this.page } };
    const first = this.firstOn(frame, this.page);
    const last = this.page + 1 < frame.pages ? this.firstOn(frame, this.page + 1) : frame.chars;
    if (first >= last) return { ...plain, anchor: { ...here, col: this.page } };

    const px = x - host.x + this.page * this.width;
    const py = y - host.y;
    const distance = (offset: number) => {
      const r = this.rectOf(frame, offset);
      if (!r) return Infinity;
      const dx = Math.max(r.left - px, 0, px - r.right);
      const dy = Math.max(r.top - py, 0, py - r.bottom);
      return dx * dx + dy * dy;
    };
    // A rough pass over the page, then a close look around the best spot.
    const step = Math.max(6, Math.ceil((last - first) / 800));
    let best = first;
    let bestDistance = distance(first);
    for (let o = first; o < last; o += step) {
      const d = distance(o);
      if (d < bestDistance) { best = o; bestDistance = d; }
    }
    for (let o = Math.max(first, best - step); o < Math.min(last, best + step); o++) {
      const d = distance(o);
      if (d < bestDistance) { best = o; bestDistance = d; }
    }
    const anchor: Anchor = { ...here, page: flowPage(this.starts[frame.section] + best), o: best };
    delete anchor.col;
    const rect = this.rectOf(frame, best);
    if (!rect || Math.floor((rect.left + 1) / this.width) !== this.page) return { ...plain, anchor: { ...here, col: this.page } };
    return { anchor, origin: { ox: rect.left - this.page * this.width + host.x, oy: rect.top + host.y, scale } };
  }

  tap(x: number, y: number) {
    const frame = this.cur;
    if (!frame) return false;
    const host = this.hostOrigin();
    const el = frame.doc.elementFromPoint(x - host.x + this.page * this.width, y - host.y);
    const href = el?.closest('a[href]')?.getAttribute('href');
    if (!href) return false;
    if (/^https?:/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return true;
    }
    const target = this.source.resolve(frame.section, href);
    if (!target) return false;
    void this.goToFragment(target.section, target.fragment);
    return true;
  }

  zoomed() { return false; }
  zoomBy() {}
  panBy() {}
  settle() {}

  destroy() {
    this.destroyed = true;
    this.generation += 1;
    this.host.remove();
    this.frames.clear();
    this.source.destroy();
  }
}
