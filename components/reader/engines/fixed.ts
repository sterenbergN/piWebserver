import type { Anchor } from '@/lib/reader/items';
import { isImageName, naturalSort, ZipReader } from '@/lib/reader/zip';
import type { Engine, FixedSource, InkOrigin, ReaderSettings, TocEntry } from '../source';

// Real pages (PDFs and comics): one canvas, fitted to the screen, that pinches and pans.
// While a pinch is going the canvas is only stretched, and it's drawn again sharply
// once the fingers lift. The pages either side are drawn ahead, so turning is instant.

/** Bigger canvases than this fail outright on iPhones. */
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_ZOOM = 6;
const KEEP_DRAWN = 4;

type Drawn = { canvas: HTMLCanvasElement; zoom: number };

export class FixedEngine implements Engine {
  readonly kind = 'fixed';
  readonly toc: TocEntry[];
  readonly totalPages: number;
  private host: HTMLDivElement;
  private index = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private base = { width: 1, height: 1 };
  private shown: Drawn | null = null;
  /** Finished pages at fit-to-screen size, most recent last. */
  private drawn = new Map<number, Promise<HTMLCanvasElement>>();
  private cancels = new Map<number, () => void>();
  private sharp: { cancel: () => void } | null = null;
  private generation = 0;

  constructor(stage: HTMLElement, private source: FixedSource, private settings: ReaderSettings, private onChange: () => void) {
    this.toc = source.toc;
    this.totalPages = source.pageCount;
    this.host = document.createElement('div');
    this.host.className = 'rd-fixed';
    stage.appendChild(this.host);
    this.applyTheme();
  }

  private applyTheme() {
    this.host.dataset.theme = this.settings.theme;
    this.host.dataset.invert = String(this.source.invertable);
  }

  private async fit(index: number) {
    const size = await this.source.size(index);
    const scale = Math.min(this.host.clientWidth / size.width, this.host.clientHeight / size.height);
    return { width: size.width * scale, height: size.height * scale };
  }

  /** Pixels wide to draw a page, as sharp as the screen, within what a canvas can hold. */
  private pixelWidth(fit: { width: number; height: number }, zoom: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = fit.width * zoom * dpr;
    const height = fit.height * zoom * dpr;
    const shrink = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    return Math.floor(width * shrink);
  }

  private draw(index: number) {
    const held = this.drawn.get(index);
    if (held) {
      this.drawn.delete(index);
      this.drawn.set(index, held);
      return held;
    }
    const made = this.fit(index).then((fit) => {
      const canvas = document.createElement('canvas');
      const task = this.source.render(index, canvas, this.pixelWidth(fit, 1));
      this.cancels.set(index, task.cancel);
      return task.promise.then(() => canvas);
    });
    made.catch(() => this.drawn.delete(index)).finally(() => this.cancels.delete(index));
    this.drawn.set(index, made);
    while (this.drawn.size > KEEP_DRAWN) {
      const oldest = this.drawn.keys().next().value as number;
      if (oldest === this.index) break;
      this.cancels.get(oldest)?.();
      this.drawn.delete(oldest);
    }
    return made;
  }

  private async show(index: number) {
    const generation = ++this.generation;
    const clamped = Math.max(0, Math.min(this.source.pageCount - 1, index));
    this.index = clamped;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.sharp?.cancel();
    this.sharp = null;
    this.onChange();
    // A page cancelled by turning past it, or by a new layout, is no one's problem.
    const drawn = await Promise.all([this.fit(clamped), this.draw(clamped)]).catch((error) => {
      if (generation === this.generation) throw error;
      return null;
    });
    if (!drawn || generation !== this.generation) return;
    const [fit, canvas] = drawn;
    this.base = fit;
    // A canvas can only sit in one place, and this one may be shown again later.
    this.host.replaceChildren(canvas);
    this.shown = { canvas, zoom: 1 };
    this.placeCanvas();
    this.onChange();
    if (clamped + 1 < this.source.pageCount) this.draw(clamped + 1).catch(() => {});
    if (clamped > 0) this.draw(clamped - 1).catch(() => {});
  }

  private rect() {
    const width = this.base.width * this.zoom;
    const height = this.base.height * this.zoom;
    return {
      x: (this.host.clientWidth - width) / 2 + this.panX + this.host.offsetLeft,
      y: (this.host.clientHeight - height) / 2 + this.panY + this.host.offsetTop,
      width,
      height,
    };
  }

  private placeCanvas() {
    if (!this.shown) return;
    const { canvas, zoom } = this.shown;
    const { x, y } = this.rect();
    canvas.style.width = `${this.base.width * zoom}px`;
    canvas.style.height = `${this.base.height * zoom}px`;
    canvas.style.transform = `translate3d(${x - this.host.offsetLeft}px, ${y - this.host.offsetTop}px, 0) scale(${this.zoom / zoom})`;
  }

  async open(at: Anchor | null) {
    await this.show((at?.page ?? 1) - 1);
  }

  next() {
    return this.index + 1 < this.source.pageCount ? this.show(this.index + 1) : Promise.resolve();
  }

  prev() {
    return this.index > 0 ? this.show(this.index - 1) : Promise.resolve();
  }

  goTo(anchor: Anchor) {
    return this.show(anchor.page - 1);
  }

  goToToc(entry: TocEntry) {
    return this.show((entry.page ?? 1) - 1);
  }

  goToFraction(fraction: number) {
    return this.show(Math.round(fraction * (this.source.pageCount - 1)));
  }

  private chapterOf(page: number) {
    let label: string | undefined;
    for (const entry of this.toc) {
      if ((entry.page ?? 1) <= page) label = entry.label;
      else break;
    }
    return label;
  }

  here(): Anchor {
    const page = this.index + 1;
    const chapter = this.chapterOf(page);
    return chapter ? { page, chapter } : { page };
  }

  fraction() {
    return this.source.pageCount > 1 ? this.index / (this.source.pageCount - 1) : 1;
  }

  async layout(settings: ReaderSettings) {
    this.settings = settings;
    this.applyTheme();
    for (const cancel of this.cancels.values()) cancel();
    this.drawn.clear();
    await this.show(this.index);
  }

  onScreen(anchor: Anchor) {
    return anchor.page === this.index + 1;
  }

  project(anchor: Anchor): InkOrigin | null {
    if (!this.onScreen(anchor)) return null;
    const { x, y, width } = this.rect();
    return { ox: x, oy: y, scale: width };
  }

  anchorAt() {
    const { x, y, width } = this.rect();
    return { anchor: this.here(), origin: { ox: x, oy: y, scale: width } };
  }

  tap() {
    return false;
  }

  zoomed() {
    return this.zoom > 1.01;
  }

  private clampPan() {
    const spareX = Math.max(0, (this.base.width * this.zoom - this.host.clientWidth) / 2);
    const spareY = Math.max(0, (this.base.height * this.zoom - this.host.clientHeight) / 2);
    this.panX = Math.max(-spareX, Math.min(spareX, this.panX));
    this.panY = Math.max(-spareY, Math.min(spareY, this.panY));
  }

  zoomBy(factor: number, cx: number, cy: number) {
    const next = Math.max(1, Math.min(MAX_ZOOM, this.zoom * factor));
    const before = this.rect();
    const applied = next / this.zoom;
    // Keep the point between the fingers where it is.
    const middleX = before.x + before.width / 2;
    const middleY = before.y + before.height / 2;
    this.panX += (middleX - cx) * (applied - 1);
    this.panY += (middleY - cy) * (applied - 1);
    this.zoom = next;
    this.clampPan();
    this.placeCanvas();
    this.onChange();
  }

  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.placeCanvas();
    this.onChange();
  }

  settle() {
    const generation = this.generation;
    const index = this.index;
    const zoom = this.zoom;
    if (Math.abs(zoom - (this.shown?.zoom ?? 1)) < 0.05) return;
    this.sharp?.cancel();
    if (zoom <= 1.01) {
      void this.draw(index).then((canvas) => {
        if (generation !== this.generation || index !== this.index) return;
        this.host.replaceChildren(canvas);
        this.shown = { canvas, zoom: 1 };
        this.placeCanvas();
      });
      return;
    }
    const canvas = document.createElement('canvas');
    const task = this.source.render(index, canvas, this.pixelWidth(this.base, zoom));
    this.sharp = task;
    task.promise.then(() => {
      if (generation !== this.generation || index !== this.index) return;
      this.host.replaceChildren(canvas);
      this.shown = { canvas, zoom };
      this.placeCanvas();
    }).catch(() => {});
  }

  destroy() {
    this.generation += 1;
    this.sharp?.cancel();
    for (const cancel of this.cancels.values()) cancel();
    this.host.remove();
    this.source.destroy();
  }
}

/** A comic: a zip of pictures, each one a page. */
export async function openComic(blob: Blob): Promise<FixedSource> {
  const zip = await ZipReader.open(blob);
  const names = naturalSort(zip.names().filter((name) => isImageName(name) && !name.startsWith('__MACOSX')));
  if (!names.length) throw new Error('There are no pictures in this file.');
  const load = async (index: number) => createImageBitmap(new Blob([new Uint8Array(await zip.bytes(names[index]))]));
  const sizes = new Map<number, Promise<{ width: number; height: number }>>();
  return {
    pageCount: names.length,
    toc: [],
    invertable: false,
    size: (index) => {
      let size = sizes.get(index);
      if (!size) {
        size = load(index).then((bitmap) => {
          const measured = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return measured;
        });
        sizes.set(index, size);
      }
      return size;
    },
    render: (index, canvas, pixelWidth) => {
      let cancelled = false;
      return {
        cancel: () => { cancelled = true; },
        promise: load(index).then((bitmap) => {
          if (!cancelled) {
            canvas.width = pixelWidth;
            canvas.height = Math.round(pixelWidth * bitmap.height / bitmap.width);
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          }
          bitmap.close();
        }),
      };
    },
    destroy: () => {},
  };
}
