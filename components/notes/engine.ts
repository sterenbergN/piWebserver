'use client';

import {
  boundsOf, boxesTouch, eraseFromStroke, lassoCatchesBox, lassoCatchesStroke, moveBox, movePoint, movePoints, NO_MOVE, packPoints, pointInBox, recognizeShape, shapeFromDrag, strokeTouches, unionBoxes,
  type Box, type Move, type ShapeKind,
} from '@/lib/notes/geometry';
import { isDark, MAX_STROKE_POINTS, type ImageElement, type MarkElement, type MarkRole, type MarkTarget, type PageElement, type PageRecord, type StrokeElement, type StrokeStyle, type TextElement, type TextFont } from '@/lib/notes/items';
import { newId, tombstone, type NotebookDoc, type Step } from './doc';
import { drawStroke, drawWet, elementBox, markBox, FONT_STACKS, strokeBox, strokePoints, TEXT_LINE_HEIGHT, textFont, textHeight } from './ink';
import { Assets, drawElement, drawElements, drawPaper, sortForDrawing } from './paper';

// The notebook on screen. Everything is drawn in screen space on two canvases the size of the
// window, so the memory it takes is the same however big the notebook is and however far in
// you've zoomed. Each page is also kept as a flat picture. While you're moving those pictures
// are all that's drawn, which is what keeps a pan smooth, and when you stop, anything zoomed
// past what the picture can show is drawn again sharply. The line being written is on its own
// canvas on top, so writing never has to redraw the page.
//
// The same layer takes every touch and decides what it means. A pencil writes; a finger moves
// the page, or writes if no pencil has ever been seen here; two fingers pinch and pan. Touches
// that land while the pencil is down or just after it lifts are a palm, and are ignored.

export type ToolName = 'pen' | 'marker' | 'eraser' | 'lasso' | 'shape' | 'text' | 'tape' | 'hand';
export type EraserMode = 'partial' | 'stroke' | 'marker';
export type TextStyle = { size: number; color: string; font: TextFont; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right' };

export type Tools = {
  tool: ToolName;
  penStyle: 'ball' | 'fountain' | 'brush';
  penColor: string;
  penWidth: number;
  markerColor: string;
  markerWidth: number;
  eraserMode: EraserMode;
  eraserWidth: number;
  shapeKind: 'auto' | ShapeKind;
  shapeColor: string;
  shapeWidth: number;
  tapeColor: string;
  tapeWidth: number;
  text: TextStyle;
};

export type EngineSettings = {
  direction: 'vertical' | 'horizontal';
  fingerDraws: 'auto' | 'on' | 'off';
  twoFingerTap: 'eraser' | 'undo';
  snapShapes: boolean;
};

export type SelectionInfo = { count: number; rect: Box; hasImage: boolean; hasText: boolean; hasStroke: boolean; mark: MarkElement | null };

export type EngineEvents = {
  onPage: (index: number) => void;
  onSelection: (info: SelectionInfo | null) => void;
  onZoom: (percent: number) => void;
  onEnd: (atEnd: boolean) => void;
  onTool: (tool: ToolName) => void;
  onSay: (text: string) => void;
  onEditing: (style: TextStyle | null) => void;
  onInkTap: (stroke: StrokeElement) => void;
  onFollow: (mark: MarkElement) => void;
  onUndoState: () => void;
};

/** What's been cut or copied, kept across notebooks until something replaces it. */
export const noteClipboard: { elements: PageElement[]; notebook: string } = { elements: [], notebook: '' };

const MAX_CACHE_PIXELS = 6_000_000;
const KEEP_CACHED = 5;
const PAGE_GAP = 16;
const SIDE_PAD = 12;
const END_PAD = 90;
const MAX_ZOOM_FACTOR = 8;
const MIN_ZOOM_FACTOR = 0.35;
const TAP_PIXELS = 10;
const TAP_MS = 350;
const QUICK_TAP_MOVE_PIXELS = 18;
const PEN_QUIET_MS = 450;
const SETTLE_MS = 140;
const HOLD_MS = 550;
const HOLD_STILL_PIXELS = 3;
const MIN_POINT_PIXELS = 0.6;
const HANDLE_PIXELS = 26;
const SELECT_PAD = 5;
const ERASER_MIN_PIXELS = 4;
const PEN_SEEN_KEY = 'notes-pen-seen';

type PageRect = { page: PageRecord; x: number; y: number };
type Cached = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; version: number; token: string; scale: number; hasPdf: boolean };

type Wet = {
  pointer: number;
  page: PageRecord;
  /** Points in page space. */
  pts: number[];
  style: StrokeStyle;
  color: string;
  width: number;
  /** A clean shape it's been snapped to, by holding still or with the shape tool. */
  snapped: number[] | null;
  snappedKind: ShapeKind | null;
  startedAt: number;
  anchorX: number;
  anchorY: number;
  isFinger: boolean;
  /** Where the browser expects the pencil to be next: drawn, so the line keeps up, but never saved. */
  predicted: number[];
};

type Selection = {
  page: string;
  ids: Set<string>;
  box: Box;
  move: Move;
  drag: { pointer: number; kind: 'move' | 'scale' | 'rotate'; startX: number; startY: number; start: Move; startAngle: number; startDistance: number; moved: boolean } | null;
};

type Editing = { page: string; element: TextElement; isNew: boolean; box: HTMLTextAreaElement; grip: HTMLDivElement };

const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? Math.min(1, Math.pow(e.pressure, 0.6)) : 0.5);

export class NoteCanvas {
  private view: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private assets: Assets;
  private rects: PageRect[] = [];
  private contentW = 612;
  private contentH = 792;
  private fitZ = 1;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private camX = 0;
  private camY = 0;
  private z = 1;
  private caches = new Map<string, Cached>();
  private frame = 0;
  private moving = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private momentum = 0;
  private velocity = { x: 0, y: 0 };
  private samples: { x: number; y: number; at: number }[] = [];
  private currentIndex = -1;
  private atEnd = false;
  private lastZoomSaid = 100;
  private region: { key: string; canvas: HTMLCanvasElement; x: number; y: number } | null = null;
  private regionWanted = '';
  private unsubscribe: () => void;
  private observer: ResizeObserver;

  private tools: Tools;
  private settings: EngineSettings;
  private penSeen = false;
  private lastPenAt = 0;
  private touches = new Map<number, { x: number; y: number; startX: number; startY: number; at: number }>();
  private palms = new Set<number>();
  private pinch: { distance: number; midX: number; midY: number; moved: boolean; at: number; fingers: number } | null = null;
  private pinchFrame = 0;
  private wet: Wet | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private erasing: { pointer: number; page: PageRecord; lastX: number; lastY: number; steps: Step[] } | null = null;
  private lasso: { pointer: number; page: PageRecord; points: number[] } | null = null;
  private tapPointer: { pointer: number; x: number; y: number; at: number } | null = null;
  private selection: Selection | null = null;
  private editing: Editing | null = null;
  private revealed = new Set<string>();
  private playback: { startedAt: number; at: number } | null = null;
  private lastTap = { at: 0, x: 0, y: 0 };
  private wheelTimer = 0;

  constructor(private host: HTMLElement, private doc: NotebookDoc, tools: Tools, settings: EngineSettings, private events: EngineEvents) {
    this.tools = tools;
    this.settings = settings;
    this.view = document.createElement('canvas');
    this.live = document.createElement('canvas');
    this.view.className = 'nt-view';
    this.live.className = 'nt-live';
    host.append(this.view, this.live);
    this.viewCtx = this.view.getContext('2d', { alpha: false })!;
    this.liveCtx = this.live.getContext('2d')!;
    this.assets = new Assets(doc.notebook, () => this.invalidateAll());
    try { this.penSeen = localStorage.getItem(PEN_SEEN_KEY) === 'yes'; } catch { /* Private browsing: it'll notice again. */ }

    this.unsubscribe = doc.subscribe((page) => this.docChanged(page));
    this.observer = new ResizeObserver(() => this.fitToHost());
    this.observer.observe(host);
    host.addEventListener('pointerdown', this.onDown);
    host.addEventListener('pointermove', this.onMove);
    host.addEventListener('pointerup', this.onUp);
    host.addEventListener('pointercancel', this.onUp);
    host.addEventListener('wheel', this.onWheel, { passive: false });
    host.addEventListener('touchstart', this.stopScroll, { passive: false });
    host.addEventListener('touchmove', this.stopScroll, { passive: false });
    window.addEventListener('keydown', this.onKey);
    document.fonts?.ready.then(() => this.invalidateAll()).catch(() => {});
    this.fitToHost(true);
  }

  destroy() {
    this.commitSelection();
    this.finishEditing();
    this.unsubscribe();
    this.observer.disconnect();
    const host = this.host;
    host.removeEventListener('pointerdown', this.onDown);
    host.removeEventListener('pointermove', this.onMove);
    host.removeEventListener('pointerup', this.onUp);
    host.removeEventListener('pointercancel', this.onUp);
    host.removeEventListener('wheel', this.onWheel);
    host.removeEventListener('touchstart', this.stopScroll);
    host.removeEventListener('touchmove', this.stopScroll);
    window.removeEventListener('keydown', this.onKey);
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.momentum) cancelAnimationFrame(this.momentum);
    if (this.pinchFrame) cancelAnimationFrame(this.pinchFrame);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.view.remove();
    this.live.remove();
    this.assets.destroy();
    this.caches.clear();
  }

  // ── Where everything is ──────────────────────────────────────────────────────

  private layout() {
    const pages = this.doc.pages;
    const vertical = this.settings.direction === 'vertical';
    const across = Math.max(1, ...pages.map((page) => (vertical ? page.w : page.h)));
    const gap = PAGE_GAP / Math.max(0.3, this.fitZ);
    let along = 0;
    this.rects = pages.map((page) => {
      const rect = vertical
        ? { page, x: (across - page.w) / 2, y: along }
        : { page, x: along, y: (across - page.h) / 2 };
      along += (vertical ? page.h : page.w) + gap;
      return rect;
    });
    const length = Math.max(1, along - gap);
    this.contentW = vertical ? across : length;
    this.contentH = vertical ? length : across;
  }

  private fitToHost(first = false) {
    this.measure();
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    if (!first && width === this.width && height === this.height) return;
    const anchor = first ? null : this.centerAnchor();
    const relativeZoom = this.z / this.fitZ;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const canvas of [this.view, this.live]) {
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    this.layoutAndFit();
    this.z = first ? this.fitZ : relativeZoom * this.fitZ;
    this.caches.clear();
    this.layout();
    if (anchor) this.showAnchor(anchor);
    else this.showPageTop(0);
    this.requestPaint();
  }

  private layoutAndFit() {
    const vertical = this.settings.direction === 'vertical';
    const widest = Math.max(1, ...this.doc.pages.map((page) => (vertical ? page.w : page.h)));
    this.fitZ = (vertical ? this.width - SIDE_PAD * 2 : this.height - this.topInset - SIDE_PAD * 2) / widest;
    this.layout();
  }

  private pageAt(x: number, y: number, slop = 0) {
    const wx = (x - this.camX) / this.z;
    const wy = (y - this.camY) / this.z;
    return this.rects.find((r) => wx >= r.x - slop && wx <= r.x + r.page.w + slop && wy >= r.y - slop && wy <= r.y + r.page.h + slop) ?? null;
  }

  private rectOf(page: string) {
    return this.rects.find((r) => r.page.id === page) ?? null;
  }

  private toPage(rect: PageRect, x: number, y: number): [number, number] {
    return [(x - this.camX) / this.z - rect.x, (y - this.camY) / this.z - rect.y];
  }

  /**
   * Where the canvas sits in the window. Measured when a touch starts and when the window
   * changes, not on every pencil event: measuring right after the screen has changed makes the
   * browser lay the page out again there and then, in the middle of a stroke.
   */
  private origin = { left: 0, top: 0 };

  private measure() {
    const box = this.host.getBoundingClientRect();
    this.origin = { left: box.left, top: box.top };
  }

  private position(e: PointerEvent) {
    return { x: e.clientX - this.origin.left, y: e.clientY - this.origin.top };
  }

  private visibleRects() {
    const left = -this.camX / this.z;
    const top = -this.camY / this.z;
    const right = left + this.width / this.z;
    const bottom = top + this.height / this.z;
    return this.rects.filter((r) => r.x < right && r.x + r.page.w > left && r.y < bottom && r.y + r.page.h > top);
  }

  private clampCamera() {
    const fit = (cam: number, content: number, view: number, start: number, end: number) => {
      const size = content * this.z;
      if (size + start + end <= view) return start + (view - start - end - size) / 2;
      return Math.max(view - size - end, Math.min(start, cam));
    };
    const vertical = this.settings.direction === 'vertical';
    const top = this.topInset + SIDE_PAD;
    this.camX = fit(this.camX, this.contentW, this.width, vertical ? SIDE_PAD : END_PAD, vertical ? SIDE_PAD : END_PAD);
    this.camY = vertical ? fit(this.camY, this.contentH, this.height, top, END_PAD) : fit(this.camY, this.contentH, this.height, top, SIDE_PAD);
  }

  /** How much of the top of the window the toolbar covers, so pages can scroll clear of it. */
  setTopInset(inset: number) {
    if (inset === this.topInset) return;
    const anchor = this.rects.length ? this.centerAnchor() : null;
    this.topInset = inset;
    if (this.settings.direction === 'horizontal') {
      this.layoutAndFit();
      this.z = this.fitZ;
      this.caches.clear();
    }
    if (anchor) this.showAnchor(anchor);
    this.settle();
  }

  private topInset = 0;

  /** Whichever page the middle of the window is over, and where. */
  private centerAnchor() {
    const wx = (this.width / 2 - this.camX) / this.z;
    const wy = (this.height / 2 - this.camY) / this.z;
    let best = this.rects[0];
    let bestDistance = Infinity;
    for (const rect of this.rects) {
      const dx = Math.max(rect.x - wx, 0, wx - rect.x - rect.page.w);
      const dy = Math.max(rect.y - wy, 0, wy - rect.y - rect.page.h);
      const distance = dx + dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = rect;
      }
    }
    return best ? { page: best.page.id, fx: (wx - best.x) / best.page.w, fy: (wy - best.y) / best.page.h } : null;
  }

  private showAnchor(anchor: { page: string; fx: number; fy: number }) {
    const rect = this.rectOf(anchor.page);
    if (!rect) return;
    this.camX = this.width / 2 - (rect.x + anchor.fx * rect.page.w) * this.z;
    this.camY = this.height / 2 - (rect.y + anchor.fy * rect.page.h) * this.z;
    this.cameraMoved();
  }

  private showPageTop(index: number) {
    const rect = this.rects[Math.max(0, Math.min(this.rects.length - 1, index))];
    if (!rect) return;
    if (this.settings.direction === 'vertical') this.camY = this.topInset + SIDE_PAD - rect.y * this.z;
    else this.camX = END_PAD - rect.x * this.z;
    this.cameraMoved();
  }

  goToPage(index: number) {
    this.stopMomentum();
    this.commitSelection();
    this.showPageTop(index);
    this.settle();
  }

  goToPageId(page: string) {
    this.goToPage(this.rects.findIndex((r) => r.page.id === page));
  }

  /** Where the middle of the window is, to come back to next time. */
  place() {
    return this.centerAnchor();
  }

  restorePlace(place: { page: string; fx: number; fy: number } | null | undefined) {
    if (place && this.rectOf(place.page)) {
      const rect = this.rectOf(place.page)!;
      if (this.settings.direction === 'vertical') this.camY = this.height / 2 - (rect.y + place.fy * rect.page.h) * this.z;
      else this.camX = this.width / 2 - (rect.x + place.fx * rect.page.w) * this.z;
      this.cameraMoved();
      this.settle();
    }
  }

  get currentPage() {
    return this.rects[Math.max(0, this.currentIndex)]?.page ?? this.doc.pages[0];
  }

  private cameraMoved() {
    this.clampCamera();
    this.region = null;
    this.moving = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), SETTLE_MS);
    const anchor = this.centerAnchor();
    const index = anchor ? this.rects.findIndex((r) => r.page.id === anchor.page) : 0;
    if (index !== this.currentIndex) {
      this.currentIndex = index;
      this.events.onPage(index);
    }
    const end = this.settings.direction === 'vertical'
      ? this.camY + this.contentH * this.z < this.height + 40
      : this.camX + this.contentW * this.z < this.width + 40;
    if (end !== this.atEnd) {
      this.atEnd = end;
      this.events.onEnd(end);
    }
    this.positionEditor();
    this.emitSelection();
    this.requestPaint();
  }

  private settle() {
    this.moving = false;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.requestPaint();
    const keep = new Set<string>();
    const index = Math.max(0, this.currentIndex);
    for (let i = Math.max(0, index - 6); i < Math.min(this.rects.length, index + 7); i++) keep.add(this.rects[i].page.id);
    this.doc.release(keep);
  }

  setSettings(settings: EngineSettings) {
    const turned = settings.direction !== this.settings.direction;
    const anchor = turned ? this.centerAnchor() : null;
    this.settings = settings;
    if (turned) {
      this.layoutAndFit();
      this.z = this.fitZ;
      this.caches.clear();
      this.camX = 0;
      this.camY = 0;
      if (anchor) this.showAnchor(anchor);
      this.settle();
    }
  }

  setTools(tools: Tools) {
    const before = this.tools.tool;
    this.tools = tools;
    if (before !== tools.tool) {
      if (before === 'lasso') this.commitSelection();
      if (before === 'text') this.finishEditing();
    }
  }

  /** Canvases are inverted by CSS for night view. Only the desk colour needs to know. */
  setNight(night: boolean) {
    this.host.classList.toggle('is-night', night);
    this.desk = '';
    this.sharpKey = '';
    this.requestPaint();
  }

  setPlayback(playback: { startedAt: number; at: number } | null) {
    this.playback = playback;
    this.paintLive();
  }

  fit() {
    const anchor = this.centerAnchor();
    this.z = this.fitZ;
    if (anchor) this.showAnchor(anchor);
    this.sayZoom(true);
    this.settle();
  }

  private sayZoom(force = false) {
    const percent = Math.round((this.z / this.fitZ) * 100);
    if (force || percent !== this.lastZoomSaid) {
      this.lastZoomSaid = percent;
      this.events.onZoom(percent);
    }
  }

  // ── Painting ─────────────────────────────────────────────────────────────────

  private docChanged(page: string | null) {
    const pagesNow = this.doc.pages.map((p) => `${p.id}:${p.order}:${p.w}:${p.h}:${p.updatedAt}`).join();
    if (page === null && pagesNow !== this.layoutToken) {
      this.layoutToken = pagesNow;
      const anchor = this.rects.length ? this.centerAnchor() : null;
      this.layoutAndFit();
      if (!this.rects.length) return;
      if (anchor && this.rectOf(anchor.page)) this.showAnchor(anchor);
      else this.cameraMoved();
      if (this.moving) this.settle();
      for (const rect of this.rects) {
        const cached = this.caches.get(rect.page.id);
        if (cached) cached.version = -1;
      }
    }
    if (this.selection) {
      // Undo or another device may have taken selected things away.
      const held = [...this.selection.ids].filter((id) => this.doc.element(this.selection!.page, id));
      if (held.length !== this.selection.ids.size) {
        this.selection.ids = new Set(held);
        if (!held.length) this.clearSelection();
      }
    }
    this.events.onUndoState();
    this.requestPaint();
  }

  private layoutToken = '';

  /** Ready to show: the pages are loaded, and the first look at them is about to happen. */
  start() {
    this.layoutToken = this.doc.pages.map((p) => `${p.id}:${p.order}:${p.w}:${p.h}:${p.updatedAt}`).join();
    this.layoutAndFit();
    this.z = this.fitZ;
    this.camX = 0;
    this.camY = 0;
    this.currentIndex = -1;
    this.showPageTop(0);
    this.settle();
    this.sayZoom(true);
  }

  invalidateAll() {
    this.sharpKey = '';
    for (const cached of this.caches.values()) cached.version = -1;
    this.region = null;
    this.requestPaint();
  }

  requestPaint() {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  private cacheScale(page: PageRecord) {
    return Math.min(this.dpr * this.fitZ, Math.sqrt(MAX_CACHE_PIXELS / (page.w * page.h)));
  }

  private cacheToken() {
    return `${this.selection ? [...this.selection.ids].join() : ''}|${this.editing?.element.id ?? ''}|${[...this.revealed].join()}`;
  }

  /** What's lifted off the page for now: a selection being moved, or the text box being typed in. */
  private hiddenFor(page: string) {
    const hidden = new Set(this.selection?.page === page ? this.selection.ids : []);
    if (this.editing?.page === page) hidden.add(this.editing.element.id);
    return hidden;
  }

  /** Changes whenever what's on a page does. A loaded page never matches one that was drawn before it had loaded. */
  private pageStamp(page: string) {
    return this.doc.version(page) + (this.doc.isLoaded(page) ? 0.5 : 0);
  }

  /** A page as a flat picture, redrawn if it's out of date. Only one per frame, so scrolling fast doesn't stall. */
  private cacheFor(rect: PageRect, budget: { left: number }) {
    const { page } = rect;
    const scale = this.cacheScale(page);
    const token = this.cacheToken();
    const version = this.pageStamp(page.id);
    let cached = this.caches.get(page.id);
    if (!this.doc.isLoaded(page.id)) {
      void this.doc.ensure(page.id).then(() => this.requestPaint());
      // Let go of to save memory, and on its way back: the old picture is still right until it arrives.
      if (cached && cached.scale === scale) return cached;
    }
    const current = cached && cached.scale === scale && cached.version === version && cached.token === token;
    if (current) {
      this.caches.delete(page.id);
      this.caches.set(page.id, cached!);
      return cached!;
    }
    if (budget.left <= 0) return cached ?? null;
    budget.left -= 1;
    if (!cached || cached.scale !== scale) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(page.w * scale));
      canvas.height = Math.max(1, Math.round(page.h * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;
      cached = { canvas, ctx, version: -1, token: '', scale, hasPdf: false };
    }
    const { ctx } = cached;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawPaper(ctx, page);
    cached.hasPdf = false;
    if (page.pdf) {
      const sheet = this.assets.pdfPage(page.pdf, scale);
      if (sheet) {
        ctx.drawImage(sheet.canvas, 0, 0, page.w, page.h);
        cached.hasPdf = true;
      }
    }
    drawElements(ctx, this.doc.elementsOf(page.id), page, this.assets, { hidden: this.hiddenFor(page.id), revealed: this.revealed });
    cached.version = version;
    cached.token = token;
    this.caches.delete(page.id);
    this.caches.set(page.id, cached);
    return cached;
  }

  private trimCaches(visible: PageRect[]) {
    const onScreen = new Set(visible.map((r) => r.page.id));
    for (const id of this.caches.keys()) {
      if (this.caches.size <= KEEP_CACHED) break;
      if (!onScreen.has(id)) this.caches.delete(id);
    }
  }

  /** Whether the flat picture is as sharp as this zoom can show. */
  private isSharpAtThisZoom(page: PageRecord) {
    return Math.abs((this.z * this.dpr) / this.cacheScale(page) - 1) < 0.04;
  }

  private paint() {
    // Zoomed in and still, with nothing changed since the last sharp frame: it's already right.
    if (!this.moving && this.sharpKey && this.sharpKey === this.sharpFrameKey()) {
      this.paintLive();
      return;
    }
    this.sharpKey = '';
    const ctx = this.viewCtx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.deskColor();
    ctx.fillRect(0, 0, this.width, this.height);
    const visible = this.visibleRects();
    const budget = { left: 1 };
    let needsMore = false;
    for (const rect of visible) {
      const x = rect.x * this.z + this.camX;
      const y = rect.y * this.z + this.camY;
      const w = rect.page.w * this.z;
      const h = rect.page.h * this.z;
      const sharp = !this.moving && !this.isSharpAtThisZoom(rect.page);
      if (sharp) {
        this.paintSharp(ctx, rect, x, y);
      } else {
        const cached = this.cacheFor(rect, budget);
        if (cached) {
          // Exactly one screen pixel to one picture pixel is what looks crisp, so land on whole pixels.
          const px = (v: number) => Math.round(v * dpr) / dpr;
          ctx.drawImage(cached.canvas, px(x), px(y), px(w), px(h));
        } else {
          ctx.fillStyle = rect.page.paper;
          ctx.fillRect(x, y, w, h);
        }
        const now = this.caches.get(rect.page.id);
        if (!now || now.token !== this.cacheToken() || now.version !== this.pageStamp(rect.page.id)) needsMore = this.doc.isLoaded(rect.page.id) || needsMore;
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    }
    this.trimCaches(visible);
    // Every page here drawn sharp and complete: remember it, so the next paint can be skipped.
    if (!this.moving && !needsMore && visible.length && visible.every((r) => !this.isSharpAtThisZoom(r.page) && this.doc.isLoaded(r.page.id))) {
      this.sharpKey = this.sharpFrameKey();
    }
    this.paintLive();
    if (needsMore) this.requestPaint();
    if (!this.moving && visible.length) this.loadAround();
  }

  /** Read from the stylesheet, so it follows the app's theme. Night view inverts it along with the pages. */
  private deskColor() {
    if (!this.desk) this.desk = getComputedStyle(this.host).getPropertyValue('--nt-desk').trim() || '#3a3d46';
    return this.desk;
  }

  private desk = '';

  /** Pages either side of what's on screen, ready before they're needed. */
  private loadAround() {
    const index = this.currentIndex;
    for (const i of [index - 1, index + 1, index + 2]) {
      const rect = this.rects[i];
      if (rect && !this.doc.isLoaded(rect.page.id)) void this.doc.ensure(rect.page.id);
    }
  }

  /** A page drawn straight to the screen at this exact zoom, clipped to what shows. */
  private paintSharp(ctx: CanvasRenderingContext2D, rect: PageRect, x: number, y: number) {
    const { page } = rect;
    if (!this.doc.isLoaded(page.id)) void this.doc.ensure(page.id).then(() => this.requestPaint());
    const dpr = this.dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, page.w * this.z, page.h * this.z);
    ctx.clip();
    ctx.setTransform(dpr * this.z, 0, 0, dpr * this.z, dpr * x, dpr * y);
    drawPaper(ctx, page);
    if (page.pdf) {
      const sheet = this.assets.pdfPage(page.pdf, this.cacheScale(page));
      if (sheet) ctx.drawImage(sheet.canvas, 0, 0, page.w, page.h);
      const region = this.pdfRegionFor(page, x, y);
      if (region) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(region.canvas, region.x, region.y);
        ctx.setTransform(dpr * this.z, 0, 0, dpr * this.z, dpr * x, dpr * y);
      }
    }
    drawElements(ctx, this.doc.elementsOf(page.id), page, this.assets, { hidden: this.hiddenFor(page.id), revealed: this.revealed });
    ctx.restore();
  }

  /** The part of a PDF page on screen, drawn at this zoom. It takes a moment, so it arrives on a later paint. */
  private pdfRegionFor(page: PageRecord, x: number, y: number) {
    const left = Math.max(0, Math.floor(x * this.dpr));
    const top = Math.max(0, Math.floor(y * this.dpr));
    const right = Math.min(this.view.width, Math.ceil((x + page.w * this.z) * this.dpr));
    const bottom = Math.min(this.view.height, Math.ceil((y + page.h * this.z) * this.dpr));
    if (right <= left || bottom <= top) return null;
    const key = `${page.id}/${left}/${top}/${right}/${bottom}/${this.z}/${x}/${y}`;
    if (this.region?.key === key) return this.region;
    if (this.regionWanted !== key && page.pdf) {
      this.regionWanted = key;
      const canvas = document.createElement('canvas');
      canvas.width = right - left;
      canvas.height = bottom - top;
      const scale = this.z * this.dpr;
      void this.assets.pdfRegion(page.pdf, canvas, scale, x * this.dpr - left, y * this.dpr - top).then((drew) => {
        if (!drew || this.regionWanted !== key) return;
        this.region = { key, canvas, x: left, y: top };
        this.requestPaint();
      });
    }
    return null;
  }

  private pageTransform(ctx: CanvasRenderingContext2D, rect: PageRect) {
    const dpr = this.dpr;
    ctx.setTransform(dpr * this.z, 0, 0, dpr * this.z, dpr * (rect.x * this.z + this.camX), dpr * (rect.y * this.z + this.camY));
  }

  private blend = 'normal';
  /** The part of the live layer the last wet line covered, so only that needs clearing next frame. */
  private wetArea: { x: number; y: number; w: number; h: number } | null = null;

  /** Just the wet line, drawn over only the part it covers. The common case while writing, so it's kept cheap. */
  private paintWetOnly() {
    const wet = this.wet!;
    const rect = this.rectOf(wet.page.id);
    const ctx = this.liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pts = wet.snapped ?? (wet.predicted.length ? wet.pts.concat(wet.predicted) : wet.pts);
    const box = boundsOf(pts, wet.width * 2);
    const dpr = this.dpr;
    const area = rect ? {
      x: Math.floor(((rect.x + box.x) * this.z + this.camX) * dpr) - 2,
      y: Math.floor(((rect.y + box.y) * this.z + this.camY) * dpr) - 2,
      w: Math.ceil(box.w * this.z * dpr) + 4,
      h: Math.ceil(box.h * this.z * dpr) + 4,
    } : null;
    if (this.wetArea) ctx.clearRect(this.wetArea.x, this.wetArea.y, this.wetArea.w, this.wetArea.h);
    if (area) ctx.clearRect(area.x, area.y, area.w, area.h);
    this.wetArea = area;
    if (!rect) return;
    this.pageTransform(ctx, rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.page.w, rect.page.h);
    ctx.clip();
    if (wet.style === 'marker' && isDark(rect.page.paper)) ctx.globalAlpha = 0.42;
    drawWet(ctx, pts, wet.style, wet.color, wet.width, !!wet.snapped);
    ctx.restore();
  }

  private paintLive() {
    const ctx = this.liveCtx;
    if (this.wet && !this.lasso && !this.selection && !this.playback && !this.flashing) {
      const blend = this.wet.style === 'marker' && !isDark(this.wet.page.paper) ? 'multiply' : 'normal';
      if (blend !== this.blend) {
        this.blend = blend;
        this.live.style.mixBlendMode = blend;
      }
      this.paintWetOnly();
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    this.wetArea = null;
    const blend = this.wet?.style === 'marker' && !isDark(this.wet.page.paper) ? 'multiply' : 'normal';
    if (blend !== this.blend) {
      this.blend = blend;
      this.live.style.mixBlendMode = blend;
    }

    if (this.wet) {
      const rect = this.rectOf(this.wet.page.id);
      if (rect) {
        this.pageTransform(ctx, rect);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, rect.page.w, rect.page.h);
        ctx.clip();
        const alpha = this.wet.style === 'marker' && isDark(rect.page.paper);
        if (alpha) ctx.globalAlpha = 0.42;
        drawWet(ctx, this.wet.snapped ?? this.wet.pts.concat(this.wet.predicted), this.wet.style, this.wet.color, this.wet.width, !!this.wet.snapped);
        ctx.restore();
      }
    }

    if (this.lasso) {
      const rect = this.rectOf(this.lasso.page.id);
      if (rect && this.lasso.points.length >= 4) {
        this.pageTransform(ctx, rect);
        ctx.lineWidth = 1.2 / this.z;
        ctx.setLineDash([5 / this.z, 4 / this.z]);
        ctx.strokeStyle = '#2f6fed';
        ctx.fillStyle = 'rgba(47,111,237,0.08)';
        ctx.beginPath();
        ctx.moveTo(this.lasso.points[0], this.lasso.points[1]);
        for (let i = 2; i < this.lasso.points.length; i += 2) ctx.lineTo(this.lasso.points[i], this.lasso.points[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (this.selection) this.paintSelection(ctx);
    if (this.playback) this.paintPlayback(ctx);
    if (this.flashing) this.paintFlash(ctx);
  }

  private flashing: { page: string; box: Box; until: number } | null = null;

  /** Draw the eye to part of a page, like a line search found, for a couple of seconds. */
  flash(page: string, box: Box) {
    this.flashing = { page, box, until: performance.now() + 2200 };
    const tick = () => {
      if (!this.flashing) return;
      if (performance.now() > this.flashing.until) this.flashing = null;
      this.paintLive();
      if (this.flashing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private paintFlash(ctx: CanvasRenderingContext2D) {
    const flash = this.flashing!;
    const rect = this.rectOf(flash.page);
    if (!rect) return;
    const left = (flash.until - performance.now()) / 2200;
    this.pageTransform(ctx, rect);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, left * 1.6)) * (0.55 + 0.45 * Math.sin(performance.now() / 120) ** 2);
    ctx.fillStyle = 'rgba(255, 200, 40, 0.35)';
    ctx.strokeStyle = '#f0a020';
    ctx.lineWidth = 2 / this.z;
    const pad = 4;
    ctx.beginPath();
    ctx.rect(flash.box.x - pad, flash.box.y - pad, flash.box.w + pad * 2, flash.box.h + pad * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private paintPlayback(ctx: CanvasRenderingContext2D) {
    const now = this.playback!.startedAt + this.playback!.at;
    for (const rect of this.visibleRects()) {
      this.pageTransform(ctx, rect);
      for (const element of this.doc.elementsOf(rect.page.id)) {
        if (element.kind !== 'stroke' || element.createdAt > now || element.createdAt < now - 2500) continue;
        ctx.save();
        ctx.globalAlpha = 0.9;
        drawStroke(ctx, { ...element, color: '#f0532b', style: element.style === 'marker' ? 'ball' : element.style } as StrokeElement, false);
        ctx.restore();
      }
    }
  }

  private selectedElements() {
    if (!this.selection) return [];
    const { page, ids } = this.selection;
    return [...ids].map((id) => this.doc.element(page, id)).filter((element): element is PageElement => !!element);
  }

  private paintSelection(ctx: CanvasRenderingContext2D) {
    const selection = this.selection!;
    const rect = this.rectOf(selection.page);
    if (!rect) return;
    const { move } = selection;
    this.pageTransform(ctx, rect);
    const dark = isDark(rect.page.paper);
    const cos = Math.cos(move.rot);
    const sin = Math.sin(move.rot);
    const toScreen = ctx.getTransform();
    // Lifted off the page: everything drawn through the selection's move.
    ctx.save();
    ctx.translate(move.cx + move.dx, move.cy + move.dy);
    ctx.transform(cos * move.scale, sin * move.scale, -sin * move.scale, cos * move.scale, 0, 0);
    ctx.translate(-move.cx, -move.cy);
    for (const element of sortForDrawing(this.selectedElements())) drawElement(ctx, element, dark, this.assets, this.revealed);
    ctx.restore();

    ctx.setTransform(toScreen);
    const corners = this.selectionCorners();
    ctx.lineWidth = 1.4 / this.z;
    ctx.setLineDash([6 / this.z, 4 / this.z]);
    ctx.strokeStyle = '#2f6fed';
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    const handle = 6 / this.z;
    for (const [x, y] of corners) {
      ctx.beginPath();
      ctx.arc(x, y, handle, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const [rx, ry, tx, ty] = this.rotateHandle();
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, ry, handle, 0, Math.PI * 2);
    ctx.fillStyle = '#2f6fed';
    ctx.fill();
  }

  private selectionCorners(): [number, number][] {
    const { box, move } = this.selection!;
    return ([[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]] as const)
      .map(([x, y]) => movePoint(x, y, move));
  }

  /** Where the turning handle sits, and the middle of the top edge it's joined to. */
  private rotateHandle() {
    const { box, move } = this.selection!;
    const top = movePoint(box.x + box.w / 2, box.y, move);
    const reach = movePoint(box.x + box.w / 2, box.y - 28 / (this.z * move.scale), move);
    return [reach[0], reach[1], top[0], top[1]] as const;
  }

  private emitSelection() {
    if (!this.selection) return;
    const rect = this.rectOf(this.selection.page);
    if (!rect) return;
    const corners = this.selectionCorners();
    const xs = corners.map(([x]) => (x + rect.x) * this.z + this.camX);
    const ys = corners.map(([, y]) => (y + rect.y) * this.z + this.camY);
    const elements = this.selectedElements();
    this.events.onSelection({
      count: elements.length,
      rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      hasImage: elements.some((e) => e.kind === 'image'),
      hasText: elements.some((e) => e.kind === 'text'),
      hasStroke: elements.some((e) => e.kind === 'stroke'),
      mark: elements.length === 1 && elements[0].kind === 'mark' ? elements[0] : null,
    });
  }

  // ── Touch, pencil, mouse ─────────────────────────────────────────────────────

  private stopScroll = (e: TouchEvent) => {
    if ((e.target as Element | null)?.closest?.('.nt-text-edit, .nt-text-grip')) return;
    if (e.cancelable) e.preventDefault();
  };

  private fingerWrites() {
    if (this.settings.fingerDraws === 'on') return true;
    if (this.settings.fingerDraws === 'off') return false;
    return !this.penSeen;
  }

  private notePen() {
    this.lastPenAt = Date.now();
    if (!this.penSeen) {
      this.penSeen = true;
      try { localStorage.setItem(PEN_SEEN_KEY, 'yes'); } catch { /* It'll notice again next time. */ }
    }
  }

  private onDown = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.('.nt-text-edit, .nt-text-grip')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (!this.wet && !this.erasing && !this.lasso && !this.touches.size) this.measure();
    // It throws for a pointer that's already gone, and that mustn't cost a stroke.
    try { this.host.setPointerCapture?.(e.pointerId); } catch { /* Then it just isn't captured. */ }
    const { x, y } = this.position(e);
    this.stopMomentum();

    if (e.pointerType === 'pen') {
      // The pencil always writes, and a palm that landed first stops counting.
      this.notePen();
      for (const id of this.touches.keys()) this.palms.add(id);
      this.touches.clear();
      this.pinch = null;
      if (this.wet?.isFinger || (this.erasing && !this.penDown) || (this.lasso && !this.penDown)) this.cancelMark();
      this.startMark(e, x, y);
      return;
    }

    if (e.pointerType === 'mouse') {
      if (e.button === 1) {
        this.touches.set(e.pointerId, { x, y, startX: x, startY: y, at: Date.now() });
        return;
      }
      this.startMark(e, x, y);
      return;
    }

    // A finger. Anything that lands while the pencil's busy, or just after, is the hand holding it.
    if (this.isMarking(true) || Date.now() - this.lastPenAt < PEN_QUIET_MS) {
      this.palms.add(e.pointerId);
      return;
    }

    this.touches.set(e.pointerId, { x, y, startX: x, startY: y, at: Date.now() });
    if (this.touches.size >= 2) {
      // A second finger means a pinch, so the first one's mark was a false start.
      if (this.wet?.isFinger || this.erasing || this.lasso) this.cancelMark();
      if (this.selection?.drag) this.endSelectionDrag();
      const [a, b] = [...this.touches.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, moved: false, at: this.pinch?.at ?? Date.now(), fingers: Math.max(this.touches.size, this.pinch?.fingers ?? 0) };
      this.samples = [];
      return;
    }

    // Fingers can always drag a selection, and tap it away.
    if (this.selection && this.tool() === 'lasso' && this.startSelectionDrag(e, x, y)) return;
    if (this.fingerWrites() && this.tool() !== 'hand' && this.tool() !== 'text') {
      this.startMark(e, x, y);
      return;
    }
    this.samples = [{ x, y, at: performance.now() }];
  };

  private tool() {
    return this.tools.tool;
  }

  private isMarking(penOnly = false) {
    if (penOnly) return (!!this.wet && !this.wet.isFinger) || (!!this.erasing && this.penDown) || (!!this.lasso && this.penDown) || (!!this.selection?.drag && this.penDown);
    return !!this.wet || !!this.erasing || !!this.lasso || !!this.selection?.drag;
  }

  private penDown = false;

  private startMark(e: PointerEvent, x: number, y: number) {
    this.penDown = e.pointerType !== 'touch';
    // The eraser end of a stylus that has one.
    const erasingEnd = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    const tool = erasingEnd ? 'eraser' : this.tool();

    if (tool === 'hand') {
      this.touches.set(e.pointerId, { x, y, startX: x, startY: y, at: Date.now() });
      this.samples = [{ x, y, at: performance.now() }];
      return;
    }
    if (this.editing) {
      this.finishEditing();
      this.penDown = false;
      return;
    }
    if (tool === 'text') {
      this.tapPointer = { pointer: e.pointerId, x, y, at: Date.now() };
      return;
    }
    if (tool === 'lasso') {
      if (this.selection && this.startSelectionDrag(e, x, y)) return;
      this.commitSelection();
      const rect = this.pageAt(x, y);
      if (!rect) return;
      const [px, py] = this.toPage(rect, x, y);
      this.lasso = { pointer: e.pointerId, page: rect.page, points: [px, py] };
      return;
    }
    const rect = this.pageAt(x, y);
    if (!rect) return;
    if (tool === 'eraser') {
      const [px, py] = this.toPage(rect, x, y);
      this.erasing = { pointer: e.pointerId, page: rect.page, lastX: px, lastY: py, steps: [] };
      this.eraseTo(px, py);
      return;
    }
    this.beginStroke(e, tool, rect, x, y);
  }

  private beginStroke(e: PointerEvent, tool: ToolName, rect: PageRect, x: number, y: number) {
    const t = this.tools;
    const [px, py] = this.toPage(rect, x, y);
    const look: { style: StrokeStyle; color: string; width: number } =
      tool === 'marker' ? { style: 'marker', color: t.markerColor, width: t.markerWidth }
        : tool === 'tape' ? { style: 'tape', color: t.tapeColor, width: t.tapeWidth }
          : tool === 'shape' ? { style: t.shapeKind === 'auto' ? 'ball' : 'shape', color: t.shapeColor, width: t.shapeWidth }
            : { style: t.penStyle, color: t.penColor, width: t.penWidth };
    this.wet = {
      pointer: e.pointerId, page: rect.page, pts: [px, py, pressureOf(e)], ...look,
      snapped: null, snappedKind: null, startedAt: Date.now(), anchorX: x, anchorY: y, isFinger: e.pointerType === 'touch', predicted: [],
    };
    if (tool === 'shape' && t.shapeKind !== 'auto') {
      this.wet.snapped = shapeFromDrag(t.shapeKind, px, py, px, py, t.shapeWidth);
      this.wet.snappedKind = t.shapeKind;
    }
    if (tool === 'pen' || tool === 'marker' || tool === 'tape') this.armHold();
    this.requestLive();
  }

  private liveFrame = 0;
  private requestLive() {
    if (!this.liveFrame) this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      this.paintLive();
    });
  }

  /** Hold the pencil still at the end of a line and it snaps to the shape you were drawing. */
  private armHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (!this.settings.snapShapes) return;
    this.holdTimer = setTimeout(() => {
      const wet = this.wet;
      if (!wet || wet.snapped) return;
      const shape = recognizeShape(wet.pts);
      if (!shape) return;
      // A highlighter or tape only ever goes straight.
      if (wet.style !== 'ball' && wet.style !== 'fountain' && wet.style !== 'brush' && shape.kind !== 'line') return;
      wet.snapped = shape.pts;
      wet.snappedKind = shape.kind;
      this.events.onSay(shape.kind === 'ellipse' ? 'Circle' : shape.kind === 'rect' ? 'Rectangle' : shape.kind === 'triangle' ? 'Triangle' : 'Straight line');
      this.requestLive();
    }, HOLD_MS);
  }

  private extendStroke(e: PointerEvent) {
    const wet = this.wet!;
    const rect = this.rectOf(wet.page.id);
    if (!rect) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const event of events.length ? events : [e]) {
      const { x, y } = this.position(event);
      const [px, py] = this.toPage(rect, x, y);
      if (wet.snapped) {
        // Once it's a clean shape, moving only stretches a line, or a dragged-out shape.
        if (wet.snappedKind && this.tool() === 'shape' && this.tools.shapeKind !== 'auto') {
          wet.snapped = shapeFromDrag(wet.snappedKind, wet.pts[0], wet.pts[1], px, py, wet.width);
        } else if (wet.snappedKind === 'line') {
          wet.snapped = shapeFromDrag('line', wet.snapped[0], wet.snapped[1], px, py);
        }
        continue;
      }
      const lastX = wet.pts[wet.pts.length - 3];
      const lastY = wet.pts[wet.pts.length - 2];
      if (Math.hypot(px - lastX, py - lastY) * this.z < MIN_POINT_PIXELS) continue;
      wet.pts.push(px, py, pressureOf(event));
      if (Math.hypot(x - wet.anchorX, y - wet.anchorY) > HOLD_STILL_PIXELS) {
        wet.anchorX = x;
        wet.anchorY = y;
        this.armHold();
      }
      // A very long stroke is carried on as a new one, so no single record gets too big.
      if (wet.pts.length >= MAX_STROKE_POINTS * 3) {
        const carry = wet.pts.slice(-3);
        this.commitWet(false);
        wet.pts = carry;
      }
    }
    wet.predicted = [];
    if (!wet.snapped) {
      for (const event of e.getPredictedEvents?.() ?? []) {
        const { x, y } = this.position(event);
        wet.predicted.push(...this.toPage(rect, x, y), pressureOf(event));
      }
    }
    this.requestLive();
  }

  private commitWet(clear = true) {
    const wet = this.wet;
    if (!wet) return;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (clear) this.wet = null;
    let pts: number[] = wet.snapped ?? wet.pts;
    let style = wet.style;
    if (wet.snapped && (style === 'ball' || style === 'fountain' || style === 'brush')) style = 'shape';

    // With the shape tool, what you drew becomes the shape if it looks like one.
    if (!wet.snapped && this.tool() === 'shape' && this.tools.shapeKind === 'auto') {
      const shape = recognizeShape(wet.pts);
      if (shape) {
        pts = shape.pts;
        style = 'shape';
      }
    }
    // Tapping with a shape drag that never moved leaves nothing behind.
    if (wet.snapped && boundsOf(pts).w < 0.5 && boundsOf(pts).h < 0.5) {
      this.requestPaint();
      return;
    }
    const now = Date.now();
    const element: StrokeElement = { id: newId(), kind: 'stroke', style, color: wet.color, width: wet.width, p: packPoints(pts), createdAt: wet.startedAt, updatedAt: now };
    this.addToCache(wet.page.id, element);
    const drawnOnView = this.addToView(wet.page.id, element);
    this.doc.apply([{ type: 'element', page: wet.page.id, before: null, after: element }]);
    if (drawnOnView) this.sharpKey = this.sharpFrameKey();
    this.events.onUndoState();
    this.requestPaint();
  }

  /**
   * Zoomed in, the page on screen is drawn sharp, straight from its strokes, which takes a while
   * on a full page. A new pen stroke goes on top of what's there instead of drawing it all again.
   */
  private addToView(page: string, element: StrokeElement) {
    const rect = this.rectOf(page);
    if (!rect || this.moving || this.isSharpAtThisZoom(rect.page) || element.style === 'marker' || element.style === 'tape') return false;
    if (this.sharpKey !== this.sharpFrameKey()) return false;
    const ctx = this.viewCtx;
    const x = rect.x * this.z + this.camX;
    const y = rect.y * this.z + this.camY;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(x, y, rect.page.w * this.z, rect.page.h * this.z);
    ctx.clip();
    this.pageTransform(ctx, rect);
    drawStroke(ctx, element, isDark(rect.page.paper));
    ctx.restore();
    return true;
  }

  /** What a sharp frame showed: if nothing in this has changed, it can stay as it is. */
  private sharpKey = '';

  private sharpFrameKey() {
    const pages = this.visibleRects().map((r) => `${r.page.id}:${this.pageStamp(r.page.id)}`).join();
    return `${this.camX}/${this.camY}/${this.z}/${this.width}/${this.height}/${this.cacheToken()}/${this.region?.key ?? ''}/${pages}`;
  }

  /** Save redrawing a page for one new line: add it to the page's picture if nothing else has changed. */
  private addToCache(page: string, element: StrokeElement) {
    const cached = this.caches.get(page);
    const rect = this.rectOf(page);
    if (!cached || !rect || element.style === 'marker' || element.style === 'tape') return;
    const expected = this.pageStamp(page);
    if (cached.version !== expected || cached.token !== this.cacheToken()) return;
    cached.ctx.setTransform(cached.scale, 0, 0, cached.scale, 0, 0);
    drawStroke(cached.ctx, element, isDark(rect.page.paper));
    cached.version = expected + 1;
  }

  private cancelMark() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.wet = null;
    this.lasso = null;
    if (this.erasing) this.endErasing();
    this.requestPaint();
  }

  private eraseTo(px: number, py: number) {
    const erasing = this.erasing!;
    const mode = this.tools.eraserMode;
    const radius = Math.max(this.tools.eraserWidth, ERASER_MIN_PIXELS / this.z);
    const page = erasing.page.id;
    const reach: Box = { x: Math.min(px, erasing.lastX) - radius, y: Math.min(py, erasing.lastY) - radius, w: Math.abs(px - erasing.lastX) + radius * 2, h: Math.abs(py - erasing.lastY) + radius * 2 };
    const steps: Step[] = [];
    const now = Date.now();
    for (const element of this.doc.elementsOf(page)) {
      if (element.kind !== 'stroke' || !boxesTouch(strokeBox(element), reach)) continue;
      if (mode === 'marker' && element.style !== 'marker') continue;
      const reachWithThickness = radius + element.width / 2;
      if (mode === 'partial' && element.style !== 'shape' && element.style !== 'tape') {
        const runs = eraseFromStroke(strokePoints(element), [erasing.lastX, erasing.lastY], [px, py], reachWithThickness);
        if (!runs) continue;
        steps.push({ type: 'element', page, before: element, after: tombstone(element, now) });
        for (const run of runs) {
          if (run.length < 6) continue;
          const { seq: _seq, ...fields } = element;
          steps.push({ type: 'element', page, before: null, after: { ...fields, id: newId(), p: packPoints(run), updatedAt: now } });
        }
      } else {
        const hit = strokeTouches(strokePoints(element), px, py, reachWithThickness) || strokeTouches(strokePoints(element), erasing.lastX, erasing.lastY, reachWithThickness);
        if (hit) steps.push({ type: 'element', page, before: element, after: tombstone(element, now) });
      }
    }
    if (steps.length) {
      this.doc.apply(steps, false);
      erasing.steps.push(...steps);
    }
    erasing.lastX = px;
    erasing.lastY = py;
  }

  private endErasing() {
    if (!this.erasing) return;
    this.doc.pushUndo(this.erasing.steps);
    this.erasing = null;
    this.events.onUndoState();
  }

  private onMove = (e: PointerEvent) => {
    // Kept up to date even while this finger's writing, in case a second one turns it into a pinch.
    const touch = this.touches.get(e.pointerId);
    const { x, y } = this.position(e);
    const dx = touch ? x - touch.x : 0;
    const dy = touch ? y - touch.y : 0;
    if (touch) {
      touch.x = x;
      touch.y = y;
    }
    if (this.wet?.pointer === e.pointerId) { this.extendStroke(e); return; }
    if (this.selection?.drag?.pointer === e.pointerId) { this.dragSelection(e); return; }
    if (this.erasing?.pointer === e.pointerId) {
      const rect = this.rectOf(this.erasing.page.id);
      if (!rect) return;
      for (const event of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
        const at = this.position(event);
        const [px, py] = this.toPage(rect, at.x, at.y);
        this.eraseTo(px, py);
      }
      return;
    }
    if (this.lasso?.pointer === e.pointerId) {
      const rect = this.rectOf(this.lasso.page.id);
      if (!rect) return;
      this.lasso.points.push(...this.toPage(rect, x, y));
      this.requestLive();
      return;
    }
    if (!touch) return;
    if (this.pinch && this.touches.size >= 2) {
      if (!this.pinchFrame) this.pinchFrame = requestAnimationFrame(() => this.applyPinch());
      return;
    }
    this.camX += dx;
    this.camY += dy;
    this.samples.push({ x, y, at: performance.now() });
    if (this.samples.length > 6) this.samples.shift();
    this.cameraMoved();
  };

  // Measured once per frame: each finger's move arrives on its own, and between the two,
  // a pan would look like the fingers spreading apart.
  private applyPinch() {
    this.pinchFrame = 0;
    if (!this.pinch || this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const factor = distance / Math.max(1, this.pinch.distance);
    const next = Math.max(this.fitZ * MIN_ZOOM_FACTOR, Math.min(this.fitZ * MAX_ZOOM_FACTOR, this.z * factor));
    const applied = next / this.z;
    // Keep the point between the fingers under them, and follow them as they move together.
    this.camX = midX - (this.pinch.midX - this.camX) * applied;
    this.camY = midY - (this.pinch.midY - this.camY) * applied;
    this.z = next;
    if (Math.hypot(a.x - a.startX, a.y - a.startY) > QUICK_TAP_MOVE_PIXELS || Math.hypot(b.x - b.startX, b.y - b.startY) > QUICK_TAP_MOVE_PIXELS) this.pinch.moved = true;
    this.pinch.distance = distance;
    this.pinch.midX = midX;
    this.pinch.midY = midY;
    this.samples.push({ x: midX, y: midY, at: performance.now() });
    if (this.samples.length > 6) this.samples.shift();
    this.cameraMoved();
    this.sayZoom();
  }

  private onUp = (e: PointerEvent) => {
    this.palms.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    if (e.pointerType === 'pen') this.lastPenAt = Date.now();

    if (this.wet?.pointer === e.pointerId) {
      this.penDown = false;
      this.touches.delete(e.pointerId);
      const { x, y } = this.position(e);
      // A tap isn't always a dot: on ink while listening it jumps there, and on tape it lifts it.
      if (this.wet.pts.length <= 6 && !this.wet.snapped) {
        const hit = this.playback ? this.strokeAt(x, y) : null;
        const link = hit ? null : this.linkAt(x, y);
        const tape = hit || link ? null : this.tapeAt(x, y);
        if (hit || link || tape) {
          this.wet = null;
          if (hit) this.events.onInkTap(hit);
          else if (link) this.events.onFollow(link);
          else this.toggleTape(tape!);
          this.requestLive();
          return;
        }
      }
      // Whatever was already drawn is kept, even if the system took the pencil away.
      this.commitWet();
      return;
    }
    if (this.selection?.drag?.pointer === e.pointerId) {
      this.penDown = false;
      this.touches.delete(e.pointerId);
      this.endSelectionDrag();
      return;
    }
    if (this.erasing?.pointer === e.pointerId) {
      this.penDown = false;
      this.touches.delete(e.pointerId);
      this.endErasing();
      return;
    }
    if (this.lasso?.pointer === e.pointerId) {
      this.penDown = false;
      this.touches.delete(e.pointerId);
      const lasso = this.lasso;
      this.lasso = null;
      if (!cancelled) this.finishLasso(lasso, e);
      this.requestLive();
      return;
    }
    if (this.tapPointer?.pointer === e.pointerId) {
      const tap = this.tapPointer;
      this.tapPointer = null;
      this.penDown = false;
      const { x, y } = this.position(e);
      if (!cancelled && Math.hypot(x - tap.x, y - tap.y) < TAP_PIXELS * 2) this.placeText(x, y);
      return;
    }

    const touch = this.touches.get(e.pointerId);
    if (!touch) return;
    if (this.pinchFrame) {
      cancelAnimationFrame(this.pinchFrame);
      this.applyPinch();
    }
    this.touches.delete(e.pointerId);

    if (this.pinch) {
      const gesture = this.pinch;
      const other = [...this.touches.values()];
      if (other.length >= 2) {
        const [a, b] = other;
        gesture.distance = Math.hypot(a.x - b.x, a.y - b.y);
        gesture.midX = (a.x + b.x) / 2;
        gesture.midY = (a.y + b.y) / 2;
        return;
      }
      // Done, as soon as the first finger's up. The other one lifting too shouldn't count as anything.
      this.touches.clear();
      this.pinch = null;
      this.flingFromSamples();
      if (!gesture.moved && !cancelled && Date.now() - gesture.at < TAP_MS && Date.now() - this.lastPenAt > PEN_QUIET_MS) this.fingerTap(gesture.fingers);
      this.settle();
      return;
    }

    if (cancelled) return;
    const moved = Math.hypot(touch.x - touch.startX, touch.y - touch.startY);
    if (moved < TAP_PIXELS && Date.now() - touch.at < TAP_MS) {
      this.handleTap(touch.x, touch.y);
      return;
    }
    this.flingFromSamples();
    this.settle();
  };

  private fingerTap(fingers: number) {
    if (fingers >= 3) {
      this.undo();
      this.events.onSay('Undo');
      return;
    }
    if (this.settings.twoFingerTap === 'undo') {
      this.undo();
      this.events.onSay('Undo');
      return;
    }
    this.events.onTool(this.tool() === 'eraser' ? 'pen' : 'eraser');
  }

  private handleTap(x: number, y: number) {
    const now = Date.now();
    const again = now - this.lastTap.at < 320 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 30;
    this.lastTap = { at: now, x, y };

    if (this.editing) { this.finishEditing(); return; }
    if (this.playback) {
      const hit = this.strokeAt(x, y);
      if (hit) { this.events.onInkTap(hit); return; }
    }
    if (this.selection) { this.commitSelection(); return; }
    if (this.tool() === 'text') { this.placeText(x, y); return; }
    if (this.tool() === 'lasso') {
      const target = this.elementAt(x, y);
      if (target) { this.select(target.page, [target.element.id]); return; }
    }
    // A link goes where it says, with any tool but the lasso, which picks it up to change it.
    const link = this.linkAt(x, y);
    if (link) {
      this.events.onFollow(link);
      return;
    }
    // Tape lifts when it's tapped, and goes back when it's tapped again.
    const tape = this.tapeAt(x, y);
    if (tape) {
      this.toggleTape(tape);
      return;
    }
    if (again) this.toggleFit(x, y);
  }

  private toggleTape(tape: StrokeElement) {
    if (this.revealed.has(tape.id)) this.revealed.delete(tape.id);
    else this.revealed.add(tape.id);
    this.requestPaint();
  }

  /** Double-tap: zoom in on that spot, or back out to the whole width. */
  private toggleFit(x: number, y: number) {
    const target = Math.abs(this.z / this.fitZ - 1) < 0.05 ? this.fitZ * 2 : this.fitZ;
    const applied = target / this.z;
    this.camX = x - (x - this.camX) * applied;
    this.camY = y - (y - this.camY) * applied;
    this.z = target;
    this.cameraMoved();
    this.sayZoom();
    this.settle();
  }

  private strokeAt(x: number, y: number) {
    const rect = this.pageAt(x, y);
    if (!rect) return null;
    const [px, py] = this.toPage(rect, x, y);
    const radius = 10 / this.z;
    return this.doc.elementsOf(rect.page.id).find((element): element is StrokeElement => element.kind === 'stroke' && strokeTouches(strokePoints(element), px, py, radius + element.width / 2)) ?? null;
  }

  private linkAt(x: number, y: number) {
    const rect = this.pageAt(x, y);
    if (!rect) return null;
    const [px, py] = this.toPage(rect, x, y);
    return this.doc.elementsOf(rect.page.id).find((element): element is MarkElement => element.kind === 'mark' && element.role === 'link' && pointInBox(px, py, markBox(element), 4 / this.z)) ?? null;
  }

  private tapeAt(x: number, y: number) {
    const rect = this.pageAt(x, y);
    if (!rect) return null;
    const [px, py] = this.toPage(rect, x, y);
    return this.doc.elementsOf(rect.page.id).find((element): element is StrokeElement => element.kind === 'stroke' && element.style === 'tape' && strokeTouches(strokePoints(element), px, py, element.width / 2 + 2)) ?? null;
  }

  private elementAt(x: number, y: number) {
    const rect = this.pageAt(x, y);
    if (!rect) return null;
    const [px, py] = this.toPage(rect, x, y);
    const radius = 8 / this.z;
    const all = sortForDrawing(this.doc.elementsOf(rect.page.id)).reverse();
    for (const element of all) {
      const hit = element.kind === 'stroke' ? strokeTouches(strokePoints(element), px, py, radius + element.width / 2) : pointInBox(px, py, element);
      if (hit) return { page: rect.page.id, element };
    }
    return null;
  }

  private stopMomentum() {
    if (this.momentum) cancelAnimationFrame(this.momentum);
    this.momentum = 0;
  }

  private flingFromSamples() {
    const samples = this.samples;
    this.samples = [];
    if (samples.length < 2) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (performance.now() - last.at > 80) return;
    const dt = Math.max(1, last.at - first.at);
    this.velocity = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    if (Math.hypot(this.velocity.x, this.velocity.y) < 0.25) return;
    let lastTime = performance.now();
    const step = (time: number) => {
      const elapsed = time - lastTime;
      lastTime = time;
      const decay = Math.pow(0.996, elapsed);
      this.velocity.x *= decay;
      this.velocity.y *= decay;
      this.camX += this.velocity.x * elapsed;
      this.camY += this.velocity.y * elapsed;
      this.cameraMoved();
      if (Math.hypot(this.velocity.x, this.velocity.y) < 0.03) {
        this.momentum = 0;
        this.settle();
        return;
      }
      this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }

  private onWheel = (e: WheelEvent) => {
    if ((e.target as Element | null)?.closest?.('.nt-text-edit')) return;
    e.preventDefault();
    this.stopMomentum();
    const { x, y } = this.position(e as unknown as PointerEvent);
    if (e.ctrlKey || e.metaKey) {
      const next = Math.max(this.fitZ * MIN_ZOOM_FACTOR, Math.min(this.fitZ * MAX_ZOOM_FACTOR, this.z * Math.exp(-e.deltaY / 240)));
      const applied = next / this.z;
      this.camX = x - (x - this.camX) * applied;
      this.camY = y - (y - this.camY) * applied;
      this.z = next;
      this.sayZoom();
    } else {
      const scale = e.deltaMode === 1 ? 24 : 1;
      this.camX -= e.deltaX * scale;
      this.camY -= e.deltaY * scale;
    }
    this.cameraMoved();
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.settle(), SETTLE_MS);
  };

  private onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (e.key === 'Escape' && this.editing) this.finishEditing();
      return;
    }
    const command = e.ctrlKey || e.metaKey;
    if (command && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (command && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (command && e.key.toLowerCase() === 'c' && this.selection) { e.preventDefault(); this.copySelection(); return; }
    if (command && e.key.toLowerCase() === 'x' && this.selection) { e.preventDefault(); this.cutSelection(); return; }
    if (command && e.key.toLowerCase() === 'd' && this.selection) { e.preventDefault(); this.duplicateSelection(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) { e.preventDefault(); this.deleteSelection(); return; }
    if (e.key === 'Escape') { this.commitSelection(); return; }
    if (command) return;
    const pageKeys: Record<string, number> = { PageDown: 1, PageUp: -1, ArrowRight: 1, ArrowLeft: -1 };
    if (pageKeys[e.key]) {
      e.preventDefault();
      this.goToPage(Math.max(0, this.currentIndex) + pageKeys[e.key]);
      return;
    }
    if (e.key === ' ' && target?.tagName === 'BUTTON') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ') {
      e.preventDefault();
      this.camY += (e.key === 'ArrowUp' ? 1 : -1) * this.height * (e.key === ' ' ? 0.85 : 0.2);
      this.cameraMoved();
      return;
    }
    const keyTools: Record<string, ToolName> = { p: 'pen', h: 'marker', e: 'eraser', l: 'lasso', s: 'shape', t: 'text' };
    if (keyTools[e.key]) this.events.onTool(keyTools[e.key]);
  };

  undo() {
    this.commitSelection();
    this.finishEditing();
    const pages = this.doc.undo();
    if (pages?.length) this.revealChange(pages);
    this.events.onUndoState();
  }

  redo() {
    this.commitSelection();
    this.finishEditing();
    const pages = this.doc.redo();
    if (pages?.length) this.revealChange(pages);
    this.events.onUndoState();
  }

  /** An undo on a page you've scrolled away from takes you to it, or it'd look like nothing happened. */
  private revealChange(pages: string[]) {
    const visible = new Set(this.visibleRects().map((r) => r.page.id));
    if (!pages.some((page) => visible.has(page))) this.goToPageId(pages[0]);
  }

  // ── Lasso and selection ──────────────────────────────────────────────────────

  private finishLasso(lasso: NonNullable<NoteCanvas['lasso']>, e: PointerEvent) {
    const { x, y } = this.position(e);
    const box = boundsOf(lasso.points.flatMap((v, i) => (i % 2 ? [v, 0] : [v])));
    // A tap with the lasso picks what's under it.
    if (box.w * this.z < TAP_PIXELS && box.h * this.z < TAP_PIXELS) {
      const target = this.elementAt(x, y);
      if (target) this.select(target.page, [target.element.id]);
      return;
    }
    const ids = this.doc.elementsOf(lasso.page.id).filter((element) => (element.kind === 'stroke'
      ? lassoCatchesStroke(strokePoints(element), lasso.points)
      : lassoCatchesBox(element, lasso.points))).map((element) => element.id);
    if (ids.length) this.select(lasso.page.id, ids);
  }

  select(page: string, ids: string[]) {
    const elements = ids.map((id) => this.doc.element(page, id)).filter((element): element is PageElement => !!element);
    if (!elements.length) return;
    const box = unionBoxes(elements.map(elementBox));
    this.selection = { page, ids: new Set(elements.map((element) => element.id)), box, move: { ...NO_MOVE, cx: box.x + box.w / 2, cy: box.y + box.h / 2 }, drag: null };
    this.emitSelection();
    this.requestPaint();
  }

  private clearSelection() {
    this.selection = null;
    this.events.onSelection(null);
    this.requestPaint();
  }

  private startSelectionDrag(e: PointerEvent, x: number, y: number) {
    const selection = this.selection!;
    const rect = this.rectOf(selection.page);
    if (!rect) return false;
    const [px, py] = this.toPage(rect, x, y);
    const reach = HANDLE_PIXELS / this.z;
    const { move } = selection;
    const center = movePoint(move.cx, move.cy, move);
    const start = { pointer: e.pointerId, startX: px, startY: py, start: { ...move }, startAngle: Math.atan2(py - center[1], px - center[0]), startDistance: Math.hypot(px - center[0], py - center[1]), moved: false };
    const [rx, ry] = this.rotateHandle();
    if (Math.hypot(px - rx, py - ry) < reach) {
      selection.drag = { ...start, kind: 'rotate' };
      this.penDown = e.pointerType !== 'touch';
      return true;
    }
    if (this.selectionCorners().some(([cx, cy]) => Math.hypot(px - cx, py - cy) < reach)) {
      selection.drag = { ...start, kind: 'scale' };
      this.penDown = e.pointerType !== 'touch';
      return true;
    }
    const w = selection.box.w * move.scale;
    const h = selection.box.h * move.scale;
    const [middleX, middleY] = movePoint(selection.box.x + selection.box.w / 2, selection.box.y + selection.box.h / 2, move);
    if (pointInBox(px, py, { x: middleX - w / 2, y: middleY - h / 2, w, h, rot: move.rot }, SELECT_PAD / this.z)) {
      selection.drag = { ...start, kind: 'move' };
      this.penDown = e.pointerType !== 'touch';
      return true;
    }
    return false;
  }

  private dragSelection(e: PointerEvent) {
    const selection = this.selection!;
    const drag = selection.drag!;
    const rect = this.rectOf(selection.page);
    if (!rect) return;
    const { x, y } = this.position(e);
    const [px, py] = this.toPage(rect, x, y);
    drag.moved = true;
    const center = movePoint(drag.start.cx, drag.start.cy, drag.start);
    if (drag.kind === 'move') {
      selection.move = { ...drag.start, dx: drag.start.dx + px - drag.startX, dy: drag.start.dy + py - drag.startY };
    } else if (drag.kind === 'scale') {
      const scale = Math.max(0.05, drag.start.scale * (Math.hypot(px - center[0], py - center[1]) / Math.max(1, drag.startDistance)));
      selection.move = { ...drag.start, scale };
    } else {
      let rot = drag.start.rot + Math.atan2(py - center[1], px - center[0]) - drag.startAngle;
      // Close to square is meant to be square.
      const quarter = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rot - quarter) < 0.05) rot = quarter;
      selection.move = { ...drag.start, rot };
    }
    this.emitSelection();
    this.requestLive();
  }

  private endSelectionDrag() {
    const selection = this.selection!;
    const drag = selection.drag;
    selection.drag = null;
    if (drag && !drag.moved) {
      this.requestLive();
      return;
    }
    this.bakeSelection(true);
  }

  private isIdentity(move: Move) {
    return Math.abs(move.dx) < 0.01 && Math.abs(move.dy) < 0.01 && Math.abs(move.scale - 1) < 0.001 && Math.abs(move.rot) < 0.001;
  }

  /** Put a moved selection's new positions into the elements. It can land on another page. */
  private bakeSelection(keepSelected: boolean) {
    const selection = this.selection;
    if (!selection) return;
    const { move, page } = selection;
    if (this.isIdentity(move)) return;
    const rect = this.rectOf(page);
    if (!rect) return;
    const now = Date.now();
    const elements = this.selectedElements();
    const [centerX, centerY] = movePoint(selection.box.x + selection.box.w / 2, selection.box.y + selection.box.h / 2, move);
    const landing = this.rects.find((r) => {
      const wx = rect.x + centerX;
      const wy = rect.y + centerY;
      return wx >= r.x && wx <= r.x + r.page.w && wy >= r.y && wy <= r.y + r.page.h;
    }) ?? rect;
    const shiftX = rect.x - landing.x;
    const shiftY = rect.y - landing.y;
    const samePage = landing.page.id === page;
    const steps: Step[] = [];
    const newIds: string[] = [];
    for (const element of elements) {
      let moved: PageElement;
      if (element.kind === 'stroke') {
        const pts = movePoints(strokePoints(element), move);
        for (let i = 0; i < pts.length; i += 3) {
          pts[i] += shiftX;
          pts[i + 1] += shiftY;
        }
        moved = { ...element, p: packPoints(pts), width: element.width * move.scale, updatedAt: now };
      } else {
        const placed = moveBox(element, move);
        placed.x += shiftX;
        placed.y += shiftY;
        moved = element.kind === 'text'
          ? { ...element, ...placed, size: Math.min(300, Math.max(4, element.size * move.scale)), updatedAt: now }
          : { ...element, ...placed, updatedAt: now } as ImageElement;
      }
      if (samePage) {
        steps.push({ type: 'element', page, before: element, after: moved });
        newIds.push(moved.id);
      } else {
        // Each page keeps its own file, so moving across means gone from one and new on the other.
        steps.push({ type: 'element', page, before: element, after: tombstone(element, now) });
        const { seq: _seq, ...fields } = moved;
        const copy = { ...fields, id: newId() } as PageElement;
        steps.push({ type: 'element', page: landing.page.id, before: null, after: copy });
        newIds.push(copy.id);
      }
    }
    this.selection = null;
    this.doc.apply(steps);
    if (keepSelected) this.select(landing.page.id, newIds);
    else this.events.onSelection(null);
    this.events.onUndoState();
  }

  commitSelection() {
    if (!this.selection) return;
    this.bakeSelection(false);
    this.clearSelection();
  }

  copySelection() {
    this.bakeSelection(true);
    const held = this.selectedElements();
    if (!held.length) return;
    noteClipboard.elements = held.map((element) => ({ ...element }));
    noteClipboard.notebook = this.doc.notebook;
    this.events.onSay(held.length === 1 ? 'Copied' : `Copied ${held.length} things`);
    this.events.onUndoState();
  }

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  }

  deleteSelection() {
    const selection = this.selection;
    if (!selection) return;
    this.bakeSelection(true);
    const page = this.selection?.page ?? selection.page;
    const now = Date.now();
    const steps = this.selectedElements().map((element): Step => ({ type: 'element', page, before: element, after: tombstone(element, now) }));
    this.selection = null;
    this.doc.apply(steps);
    this.events.onSelection(null);
    this.events.onUndoState();
  }

  duplicateSelection() {
    if (!this.selection) return;
    this.bakeSelection(true);
    const page = this.selection.page;
    const placed = this.placeCopies(page, this.selectedElements(), 18, 18);
    this.select(page, placed);
    this.events.onUndoState();
  }

  /** New copies of things on a page, moved a little, written down as one step. */
  private placeCopies(page: string, elements: PageElement[], dx: number, dy: number) {
    const now = Date.now();
    const ids: string[] = [];
    const steps: Step[] = elements.map((element) => {
      const { seq: _seq, ...fields } = element;
      const id = newId();
      ids.push(id);
      let copy: PageElement;
      if (element.kind === 'stroke') {
        copy = { ...fields, id, p: packPoints(movePoints(strokePoints(element), { ...NO_MOVE, dx, dy })), createdAt: now, updatedAt: now } as PageElement;
      } else {
        copy = { ...fields, id, x: element.x + dx, y: element.y + dy, createdAt: now, updatedAt: now } as PageElement;
      }
      return { type: 'element', page, before: null, after: copy };
    });
    this.commitSelectionQuietly();
    this.doc.apply(steps);
    return ids;
  }

  private commitSelectionQuietly() {
    if (this.selection) {
      this.bakeSelection(false);
      this.selection = null;
    }
  }

  /** What's on the clipboard, in the middle of the page you're on. */
  async paste(prepare: (elements: PageElement[]) => Promise<PageElement[]>) {
    if (!noteClipboard.elements.length) return;
    const rect = this.rects[Math.max(0, this.currentIndex)];
    if (!rect) return;
    const elements = await prepare(noteClipboard.elements);
    const box = unionBoxes(elements.map(elementBox));
    const [viewX, viewY] = this.toPage(rect, this.width / 2, this.height / 2);
    const middleX = Math.max(box.w / 2, Math.min(rect.page.w - box.w / 2, viewX));
    const middleY = Math.max(box.h / 2, Math.min(rect.page.h - box.h / 2, viewY));
    const ids = this.placeCopies(rect.page.id, elements, middleX - box.x - box.w / 2, middleY - box.y - box.h / 2);
    this.events.onTool('lasso');
    this.select(rect.page.id, ids);
    this.events.onUndoState();
  }

  recolorSelection(color: string) {
    if (!this.selection) return;
    this.bakeSelection(true);
    if (!this.selection) return;
    const page = this.selection.page;
    const now = Date.now();
    const steps: Step[] = [];
    for (const element of this.selectedElements()) {
      if (element.kind === 'image' || element.kind === 'mark') continue;
      steps.push({ type: 'element', page, before: element, after: { ...element, color, updatedAt: now } });
    }
    const ids = [...this.selection.ids];
    this.selection = null;
    this.doc.apply(steps);
    this.select(page, ids);
    this.events.onUndoState();
  }

  bringForward() {
    if (!this.selection) return;
    const page = this.selection.page;
    const now = Date.now();
    const steps: Step[] = [];
    for (const element of this.selectedElements()) {
      if (element.kind === 'image') steps.push({ type: 'element', page, before: element, after: { ...element, z: now, updatedAt: now } });
    }
    const ids = [...this.selection.ids];
    this.selection = null;
    this.doc.apply(steps);
    this.select(page, ids);
  }

  /** The chosen text box, opened for typing, if one thing is selected and it's text. */
  /** The selected pen strokes, as stored, for the server to read. */
  selectionInk() {
    return this.selectedElements()
      .filter((element): element is StrokeElement => element.kind === 'stroke' && element.style !== 'marker' && element.style !== 'tape')
      .map((stroke) => ({ id: stroke.id, p: stroke.p, width: stroke.width }));
  }

  /** Mark the selection as a link, heading or keyword. The mark sits over the ink, which stays as it was. */
  markSelection(role: MarkRole, label: string, extra: { level?: 1 | 2 | 3; target?: MarkTarget } = {}) {
    if (!this.selection) return;
    this.bakeSelection(true);
    const selection = this.selection;
    if (!selection) return;
    const box = unionBoxes(this.selectedElements().filter((element) => element.kind !== 'mark').map(elementBox));
    const now = Date.now();
    const mark: MarkElement = { id: newId(), kind: 'mark', role, x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, label, ...extra, createdAt: now, updatedAt: now };
    this.selection = null;
    this.doc.apply([{ type: 'element', page: selection.page, before: null, after: mark }]);
    this.events.onSelection(null);
    this.events.onUndoState();
    this.requestPaint();
  }

  updateMark(mark: MarkElement, changes: Partial<MarkElement>) {
    const page = this.selection?.page ?? this.rects.find((r) => this.doc.element(r.page.id, mark.id))?.page.id;
    if (!page) return;
    const held = this.doc.element(page, mark.id);
    if (!held) return;
    const next = { ...held, ...changes, updatedAt: Date.now() } as MarkElement;
    if (changes.target === undefined && 'target' in changes) delete next.target;
    this.selection = null;
    this.doc.apply([{ type: 'element', page, before: held, after: next }]);
    this.select(page, [mark.id]);
    this.events.onUndoState();
  }

  /** Swap the selected handwriting for typed text that says the same, about the same size. */
  convertSelectionToText(text: string) {
    if (!this.selection || !text.trim()) return;
    this.bakeSelection(true);
    const selection = this.selection;
    if (!selection) return;
    const page = selection.page;
    const strokes = this.selectedElements().filter((element): element is StrokeElement => element.kind === 'stroke');
    if (!strokes.length) return;
    const box = unionBoxes(strokes.map(elementBox));
    const lineCount = Math.max(1, text.split('\n').length);
    const size = Math.round(Math.max(9, Math.min(48, (box.h / lineCount) * 0.62)));
    const now = Date.now();
    const typed: TextElement = {
      id: newId(), kind: 'text', x: box.x, y: box.y, w: Math.max(box.w, 60), h: 0, rot: 0,
      text: text.trim(), size, color: strokes[0].color, font: 'sans', createdAt: now, updatedAt: now,
    };
    typed.h = textHeight(typed);
    this.selection = null;
    this.doc.apply([
      ...strokes.map((stroke): Step => ({ type: 'element', page, before: stroke, after: tombstone(stroke, now) })),
      { type: 'element', page, before: null, after: typed },
    ]);
    this.select(page, [typed.id]);
    this.events.onUndoState();
  }

  editSelectedText() {
    const held = this.selectedElements();
    if (held.length !== 1 || held[0].kind !== 'text') return;
    const page = this.selection!.page;
    const element = held[0];
    this.commitSelection();
    this.openEditor(page, this.doc.element(page, element.id) as TextElement, false);
  }

  /** Put a picture on the current page, and select it so it can be placed. */
  insertImage(file: string, naturalW: number, naturalH: number) {
    const rect = this.rects[Math.max(0, this.currentIndex)];
    if (!rect) return;
    const fit = Math.min(1, (rect.page.w * 0.7) / naturalW, (rect.page.h * 0.6) / naturalH);
    const w = naturalW * fit;
    const h = naturalH * fit;
    const [viewX, viewY] = this.toPage(rect, this.width / 2, this.height / 2);
    const now = Date.now();
    const element: ImageElement = {
      id: newId(), kind: 'image', file, w, h, rot: 0,
      x: Math.max(0, Math.min(rect.page.w - w, viewX - w / 2)),
      y: Math.max(0, Math.min(rect.page.h - h, viewY - h / 2)),
      createdAt: now, updatedAt: now,
    };
    this.commitSelection();
    this.doc.apply([{ type: 'element', page: rect.page.id, before: null, after: element }]);
    this.events.onTool('lasso');
    this.select(rect.page.id, [element.id]);
    this.events.onUndoState();
  }

  // ── Text boxes ───────────────────────────────────────────────────────────────

  private placeText(x: number, y: number) {
    if (this.editing) { this.finishEditing(); return; }
    const rect = this.pageAt(x, y);
    if (!rect) return;
    const [px, py] = this.toPage(rect, x, y);
    const existing = sortForDrawing(this.doc.elementsOf(rect.page.id)).reverse().find((element): element is TextElement => element.kind === 'text' && pointInBox(px, py, element, 4));
    if (existing) {
      this.openEditor(rect.page.id, existing, false);
      return;
    }
    const style = this.tools.text;
    const now = Date.now();
    const w = Math.min(rect.page.w - px - 12, Math.max(220, rect.page.w * 0.5));
    const element: TextElement = {
      id: newId(), kind: 'text', x: px, y: py - (style.size * TEXT_LINE_HEIGHT) / 2, w: Math.max(60, w), h: style.size * TEXT_LINE_HEIGHT, rot: 0,
      text: '', size: style.size, color: style.color, font: style.font,
      ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.align !== 'left' ? { align: style.align } : {}),
      createdAt: now, updatedAt: now,
    };
    this.openEditor(rect.page.id, element, true);
  }

  private openEditor(page: string, element: TextElement, isNew: boolean) {
    this.finishEditing();
    const box = document.createElement('textarea');
    box.className = 'nt-text-edit';
    box.value = element.text;
    box.setAttribute('aria-label', 'Text box');
    box.spellcheck = true;
    box.autocapitalize = 'sentences';
    const grip = document.createElement('div');
    grip.className = 'nt-text-grip';
    grip.setAttribute('aria-hidden', 'true');
    this.host.append(box, grip);
    this.editing = { page, element: { ...element, rot: 0 }, isNew, box, grip };
    // Hidden from the page while it's being edited (see hiddenFor), so it isn't there twice.
    this.requestPaint();
    box.addEventListener('input', this.onEditorInput);
    grip.addEventListener('pointerdown', this.onGripDown);
    this.positionEditor();
    this.events.onEditing({ size: element.size, color: element.color, font: element.font, bold: !!element.bold, italic: !!element.italic, align: element.align ?? 'left' });
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
    // Once the keyboard is up, make sure what you're typing isn't under it.
    setTimeout(() => this.keepEditorVisible(), 350);
  }

  private keepEditorVisible() {
    const editing = this.editing;
    if (!editing) return;
    const viewportHeight = window.visualViewport?.height ?? this.height;
    const box = editing.box.getBoundingClientRect();
    const hostTop = this.host.getBoundingClientRect().top;
    const over = box.bottom - hostTop - (viewportHeight - hostTop) + 24;
    if (over > 0) {
      this.camY -= over;
      this.cameraMoved();
      this.settle();
    }
  }

  private onEditorInput = () => {
    const editing = this.editing;
    if (!editing) return;
    editing.element = { ...editing.element, text: editing.box.value };
    this.positionEditor();
  };

  private onGripDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const editing = this.editing;
    if (!editing) return;
    const startX = e.clientX;
    const startW = editing.element.w;
    const grip = editing.grip;
    try { grip.setPointerCapture?.(e.pointerId); } catch { /* It just isn't captured. */ }
    const move = (event: PointerEvent) => {
      if (!this.editing) return;
      this.editing.element = { ...this.editing.element, w: Math.max(40, startW + (event.clientX - startX) / this.z) };
      this.positionEditor();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      this.editing?.box.focus({ preventScroll: true });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  private positionEditor() {
    const editing = this.editing;
    if (!editing) return;
    const rect = this.rectOf(editing.page);
    if (!rect) return;
    const { element, box, grip } = editing;
    const x = (rect.x + element.x) * this.z + this.camX;
    const y = (rect.y + element.y) * this.z + this.camY;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${element.w * this.z}px`;
    box.style.font = textFont(element, this.z);
    box.style.lineHeight = String(TEXT_LINE_HEIGHT);
    box.style.color = element.color;
    box.style.textAlign = element.align ?? 'left';
    box.style.fontFamily = FONT_STACKS[element.font];
    box.style.height = 'auto';
    box.style.height = `${Math.max(box.scrollHeight, element.size * TEXT_LINE_HEIGHT * this.z)}px`;
    grip.style.left = `${x + element.w * this.z}px`;
    grip.style.top = `${y}px`;
    grip.style.height = box.style.height;
  }

  /** New look for what's being typed, from the bar above the keyboard. */
  setTextStyle(style: TextStyle) {
    const editing = this.editing;
    if (!editing) return;
    editing.element = { ...editing.element, size: style.size, color: style.color, font: style.font, bold: style.bold || undefined, italic: style.italic || undefined, align: style.align === 'left' ? undefined : style.align };
    this.positionEditor();
    editing.box.focus({ preventScroll: true });
  }

  finishEditing() {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const text = editing.box.value.replace(/\s+$/, '');
    editing.box.removeEventListener('input', this.onEditorInput);
    editing.box.remove();
    editing.grip.remove();
    // iPads can leave the page scrolled up after the keyboard goes.
    window.scrollTo(0, 0);
    this.events.onEditing(null);
    const original = this.doc.element(editing.page, editing.element.id);
    const now = Date.now();
    if (!text) {
      if (original) this.doc.apply([{ type: 'element', page: editing.page, before: original, after: tombstone(original, now) }]);
    } else {
      const finished: TextElement = { ...editing.element, text, h: textHeight({ ...editing.element, text }), rot: original?.kind === 'text' ? original.rot : 0, updatedAt: now };
      const changed = !original || JSON.stringify({ ...original, updatedAt: 0, seq: 0 }) !== JSON.stringify({ ...finished, updatedAt: 0, seq: 0 });
      if (changed) this.doc.apply([{ type: 'element', page: editing.page, before: original ?? null, after: finished }]);
    }
    this.events.onUndoState();
    this.requestPaint();
  }
}
