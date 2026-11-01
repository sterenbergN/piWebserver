'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { useWakeLock } from '@/components/useWakeLock';
import { roundStroke, strokeTouches, type Anchor, type BookMeta, type InkColor, type ReaderItem } from '@/lib/reader/items';
import { openEngine } from './bookinfo';
import { getFile, getProgress } from './db';
import { drawPixels, drawStroke, inkColor, MARKER_COLORS, MARKER_PIXELS, PEN_COLORS, PEN_PIXELS, sizeCanvas } from './ink';
import NotesPanel from './NotesPanel';
import type { Engine, ReaderSettings } from './source';
import { downloadBook, flushNow, ReaderSignedOut, saveProgressHere } from './sync';
import { useBookItems } from './useBookItems';

// A book, full screen. The page sits under two canvases, one for saved pen marks and
// one for the stroke being drawn, and under a clear layer that takes every touch. That
// layer decides what a touch means: a pencil writes, a finger turns the page (or writes,
// in draw mode, until a pencil has been seen, after which a resting palm does nothing).

type Tool = 'pen' | 'marker' | 'eraser';
type Panel = 'contents' | 'notes' | 'notes-here' | 'look' | null;
type Undo = { kind: 'added' | 'removed'; item: ReaderItem };

const SWIPE_PIXELS = 44;
const TAP_PIXELS = 10;
const TAP_MS = 350;
const SIDE_ZONE = 0.28;
const ERASER_PIXELS = 11;

const isStandalone = () => window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;

function fullscreenTarget() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  return el.requestFullscreen ? () => el.requestFullscreen() : el.webkitRequestFullscreen ? async () => el.webkitRequestFullscreen?.() : null;
}

export default function BookView({ book, startAt, settings, onSettings, onExit, onSignedOut }: {
  book: BookMeta;
  startAt: Anchor | null;
  settings: ReaderSettings;
  onSettings: (settings: ReaderSettings) => void;
  onExit: () => void;
  onSignedOut: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);

  const [phase, setPhase] = useState<'getting' | 'opening' | 'ready' | 'error'>('getting');
  const [fetched, setFetched] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [, setTick] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState<InkColor>('ink');
  const [markerColor, setMarkerColor] = useState<InkColor>('yellow');
  const [undoCount, setUndoCount] = useState(0);
  const [isFull, setIsFull] = useState(false);
  const [canFull, setCanFull] = useState(false);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  useWakeLock(phase === 'ready');

  useEffect(() => {
    setCanFull(!isStandalone() && !!fullscreenTarget());
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── Pen marks ────────────────────────────────────────────────────────────────

  const redrawRef = useRef<() => void>(() => {});
  const { all, version, addInk, addNote, addSketch, editNote, remove, restore } = useBookItems(book.id, () => redrawRef.current());
  const allRef = useRef(all);
  const settingsRef = useRef(settings);

  const redraw = useCallback(() => {
    const canvas = baseRef.current;
    const engine = engineRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!engine) return;
    const onPage = allRef.current().filter((item) => item.kind === 'ink' && !item.deleted && item.stroke);
    // Marker goes underneath, so it never dulls the pen on top of it.
    for (const tool of ['marker', 'pen'] as const) {
      for (const item of onPage) {
        if (item.stroke?.tool !== tool) continue;
        const origin = engine.project(item.anchor);
        if (origin) drawStroke(ctx, item.stroke, origin, settingsRef.current.theme);
      }
    }
  }, []);

  useLayoutEffect(() => {
    allRef.current = all;
    settingsRef.current = settings;
    redrawRef.current = redraw;
  });

  const fitCanvases = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const canvas of [baseRef.current, liveRef.current]) {
      if (canvas) sizeCanvas(canvas, stage.clientWidth, stage.clientHeight);
    }
    redraw();
  }, [redraw]);

  const undoStack = useRef<Undo[]>([]);
  const pushUndo = (entry: Undo) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > 200) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  };
  const undo = () => {
    const last = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!last) return;
    if (last.kind === 'added') remove(last.item);
    else restore(last.item);
  };

  // ── Opening the book ─────────────────────────────────────────────────────────

  useEffect(() => {
    let live = true;
    let lastPlace = '';
    // A phone can show a page number across several screens, so it's the exact spot that counts.
    const placeKey = (anchor: Anchor) => `${anchor.page}/${anchor.s ?? ''}/${anchor.o ?? ''}/${anchor.col ?? ''}`;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;

    const pageChanged = () => {
      setTick((t) => t + 1);
      redrawRef.current();
      const engine = engineRef.current;
      if (!engine) return;
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = setTimeout(() => {
        const anchor = engine.here();
        if (placeKey(anchor) === lastPlace) return;
        lastPlace = placeKey(anchor);
        void saveProgressHere(book.id, { anchor, pct: engine.fraction(), at: Date.now() });
      }, 600);
    };

    (async () => {
      let blob = await getFile(book.id);
      if (!blob) blob = await downloadBook(book, (fraction) => { if (live) setFetched(fraction); });
      if (!live) return;
      setPhase('opening');
      const at = startAt ?? (await getProgress(book.id))?.anchor ?? null;
      if (at) lastPlace = placeKey(at);
      const engine = await openEngine(book.format, blob, stageRef.current!, settingsRef.current, pageChanged);
      if (!live) { engine.destroy(); return; }
      engineRef.current = engine;
      fitCanvases();
      await engine.open(at);
      if (!live) return;
      setEngine(engine);
      setPhase('ready');
      redrawRef.current();
    })().catch((error) => {
      if (!live) return;
      if (error instanceof ReaderSignedOut) { onSignedOut(); return; }
      setPhase('error');
      setErrorText(error instanceof TypeError ? 'This book isn’t on this device yet, and there’s no connection to fetch it.' : error instanceof Error ? error.message : 'This book wouldn’t open.');
    });

    return () => {
      live = false;
      if (progressTimer) clearTimeout(progressTimer);
      const engine = engineRef.current;
      if (engine) {
        void saveProgressHere(book.id, { anchor: engine.here(), pct: engine.fraction(), at: Date.now() }).then(flushNow);
        engine.destroy();
      }
      engineRef.current = null;
    };
  }, [book.id]);

  // New settings or a turned device lay the book out again, keeping your place.
  const lastSettings = useRef(settings);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || lastSettings.current === settings) return;
    lastSettings.current = settings;
    void engine.layout(settings).then(() => redrawRef.current());
  }, [settings]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let size = `${stage.clientWidth}x${stage.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const now = `${stage.clientWidth}x${stage.clientHeight}`;
      if (now === size) return;
      size = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fitCanvases();
        void engineRef.current?.layout(settingsRef.current).then(() => redrawRef.current());
      }, 200);
    });
    observer.observe(stage);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
  }, [fitCanvases]);

  // ── Touch, pencil, mouse and keys ────────────────────────────────────────────

  const drawRef = useRef({ drawMode, tool, penColor, markerColor, panel, chrome });
  useLayoutEffect(() => {
    drawRef.current = { drawMode, tool, penColor, markerColor, panel, chrome };
  });

  useEffect(() => {
    const layer = layerRef.current;
    const stage = stageRef.current;
    if (!layer || !stage) return;

    type Touch = { x: number; y: number; startX: number; startY: number; at: number };
    const touches = new Map<number, Touch>();
    let penSeen = false;
    let stroke: { pointer: number; points: number[]; tool: 'pen' | 'marker'; color: InkColor; width: number; fromPen: boolean } | null = null;
    let erasing: number | null = null;
    let pinch: { distance: number } | null = null;
    let liveFrame = 0;

    const position = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const paintLive = () => {
      liveFrame = 0;
      const ctx = liveRef.current?.getContext('2d');
      if (!ctx || !liveRef.current) return;
      ctx.clearRect(0, 0, liveRef.current.clientWidth, liveRef.current.clientHeight);
      if (stroke) drawPixels(ctx, stroke.tool, inkColor(stroke.color, settingsRef.current.theme), stroke.width, stroke.points);
    };
    const clearLive = () => {
      if (liveFrame) cancelAnimationFrame(liveFrame);
      paintLive();
    };

    const beginStroke = (e: PointerEvent) => {
      const { x, y } = position(e);
      const state = drawRef.current;
      const useMarker = state.tool === 'marker';
      stroke = {
        pointer: e.pointerId,
        points: [x, y, e.pointerType === 'pen' ? e.pressure : 0.5],
        tool: useMarker ? 'marker' : 'pen',
        color: useMarker ? state.markerColor : state.penColor,
        width: useMarker ? MARKER_PIXELS : PEN_PIXELS,
        fromPen: e.pointerType === 'pen',
      };
    };

    const extendStroke = (e: PointerEvent) => {
      if (!stroke) return;
      const events = e.getCoalescedEvents?.() ?? [];
      for (const event of events.length ? events : [e]) {
        const { x, y } = position(event);
        const lastX = stroke.points[stroke.points.length - 3];
        const lastY = stroke.points[stroke.points.length - 2];
        if (Math.hypot(x - lastX, y - lastY) < 0.7) continue;
        stroke.points.push(x, y, event.pointerType === 'pen' ? event.pressure : 0.5);
      }
      if (!liveFrame) liveFrame = requestAnimationFrame(paintLive);
    };

    const finishStroke = () => {
      const engine = engineRef.current;
      const done = stroke;
      stroke = null;
      clearLive();
      if (!engine || !done) return;
      const { anchor, origin } = engine.anchorAt(done.points[0], done.points[1]);
      const pts = new Array<number>(done.points.length);
      for (let i = 0; i < done.points.length; i += 3) {
        pts[i] = (done.points[i] - origin.ox) / origin.scale;
        pts[i + 1] = (done.points[i + 1] - origin.oy) / origin.scale;
        pts[i + 2] = done.points[i + 2];
      }
      const item = addInk(anchor, { tool: done.tool, color: done.color, width: done.width / origin.scale, pts: roundStroke(pts) });
      pushUndo({ kind: 'added', item });
    };

    const eraseAt = (e: PointerEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const { x, y } = position(e);
      for (const item of allRef.current()) {
        if (item.kind !== 'ink' || item.deleted || !item.stroke) continue;
        const origin = engine.project(item.anchor);
        if (!origin) continue;
        if (strokeTouches(item.stroke.pts, (x - origin.ox) / origin.scale, (y - origin.oy) / origin.scale, ERASER_PIXELS / origin.scale)) {
          pushUndo({ kind: 'removed', item });
          remove(item);
        }
      }
    };

    const startMark = (e: PointerEvent) => {
      if (drawRef.current.tool === 'eraser') {
        erasing = e.pointerId;
        eraseAt(e);
      } else {
        beginStroke(e);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      layer.setPointerCapture?.(e.pointerId);
      const { x, y } = position(e);
      if (e.pointerType === 'pen') {
        // The pencil always writes, and a palm that landed first stops counting.
        penSeen = true;
        touches.clear();
        pinch = null;
        startMark(e);
        return;
      }
      // Fingers write only in draw mode, and not once a pencil is about.
      if (drawRef.current.drawMode && !penSeen && !touches.size && !stroke && erasing === null) {
        touches.set(e.pointerId, { x, y, startX: x, startY: y, at: Date.now() });
        startMark(e);
        return;
      }
      touches.set(e.pointerId, { x, y, startX: x, startY: y, at: Date.now() });
      if (touches.size === 2) {
        // A second finger means a pinch, so the first one's stroke was a false start.
        stroke = null;
        erasing = null;
        clearLive();
        const [a, b] = [...touches.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      }
    };

    const onMove = (e: PointerEvent) => {
      if (stroke?.pointer === e.pointerId) { extendStroke(e); return; }
      if (erasing === e.pointerId) { eraseAt(e); return; }
      const touch = touches.get(e.pointerId);
      if (!touch) return;
      const { x, y } = position(e);
      const dx = x - touch.x;
      const dy = y - touch.y;
      touch.x = x;
      touch.y = y;
      const engine = engineRef.current;
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        engine?.zoomBy(distance / Math.max(1, pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.distance = distance;
      } else if (engine?.zoomed()) {
        engine.panBy(dx, dy);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (stroke?.pointer === e.pointerId) {
        // A quick touch of the pencil outside draw mode is a tap, not a dot.
        const tapped = stroke.fromPen && !drawRef.current.drawMode && stroke.points.length <= 12;
        if (tapped) {
          const { x, y } = position(e);
          stroke = null;
          clearLive();
          handleTap(x, y);
        } else {
          finishStroke();
        }
        touches.delete(e.pointerId);
        return;
      }
      if (erasing === e.pointerId) { erasing = null; touches.delete(e.pointerId); return; }
      const touch = touches.get(e.pointerId);
      if (!touch) return;
      touches.delete(e.pointerId);
      const engine = engineRef.current;
      if (pinch) {
        if (touches.size < 2) pinch = null;
        engine?.settle();
        // The other finger lifting too shouldn't count as a tap or swipe.
        touches.clear();
        return;
      }
      if (e.type === 'pointercancel') return;
      if (engine?.zoomed()) {
        engine.settle();
      }
      const dx = touch.x - touch.startX;
      const dy = touch.y - touch.startY;
      const moved = Math.hypot(dx, dy);
      const quick = Date.now() - touch.at < TAP_MS;
      if (moved < TAP_PIXELS && quick) handleTap(touch.x, touch.y);
      else if (drawRef.current.drawMode) return;
      else if (!engine?.zoomed() && Math.abs(dx) > SWIPE_PIXELS && Math.abs(dx) > Math.abs(dy) * 1.4) {
        void (dx < 0 ? engine?.next() : engine?.prev());
        setChrome(false);
      }
    };

    const handleTap = (x: number, y: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const state = drawRef.current;
      if (state.drawMode) return;
      if (state.chrome) { setChrome(false); return; }
      if (engine.tap(x, y)) return;
      const share = x / stage.clientWidth;
      if (engine.zoomed() || (share >= SIDE_ZONE && share <= 1 - SIDE_ZONE)) setChrome(true);
      else void (share < SIDE_ZONE ? engine.prev() : engine.next());
    };

    const onWheel = (e: WheelEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      e.preventDefault();
      if (e.ctrlKey) {
        engine.zoomBy(Math.exp(-e.deltaY / 200), e.offsetX, e.offsetY);
        window.clearTimeout(wheelTimer);
        wheelTimer = window.setTimeout(() => engine.settle(), 200);
      } else if (engine.zoomed()) {
        engine.panBy(-e.deltaX, -e.deltaY);
      } else if (Date.now() - lastWheel > 300 && Math.abs(e.deltaY) + Math.abs(e.deltaX) > 20) {
        lastWheel = Date.now();
        void (e.deltaY + e.deltaX > 0 ? engine.next() : engine.prev());
      }
    };
    let lastWheel = 0;
    let wheelTimer = 0;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const engine = engineRef.current;
      if (e.key === 'Escape') {
        if (drawRef.current.panel) setPanel(null);
        else if (drawRef.current.drawMode) setDrawMode(false);
        else onExit();
        return;
      }
      if (!engine || drawRef.current.panel) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); void engine.next(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); void engine.prev(); }
    };

    // iPhones scroll and zoom the whole page under a finger unless they're told not to.
    const stopScroll = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };

    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
    layer.addEventListener('wheel', onWheel, { passive: false });
    layer.addEventListener('touchstart', stopScroll, { passive: false });
    layer.addEventListener('touchmove', stopScroll, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      layer.removeEventListener('pointerdown', onDown);
      layer.removeEventListener('pointermove', onMove);
      layer.removeEventListener('pointerup', onUp);
      layer.removeEventListener('pointercancel', onUp);
      layer.removeEventListener('wheel', onWheel);
      layer.removeEventListener('touchstart', stopScroll);
      layer.removeEventListener('touchmove', stopScroll);
      window.removeEventListener('keydown', onKey);
      if (liveFrame) cancelAnimationFrame(liveFrame);
    };
  }, [addInk, remove]);

  // ── What's on screen ─────────────────────────────────────────────────────────

  const ready = phase === 'ready' && !!engine;
  const here = ready ? engine.here() : undefined;
  // `version` is what says these have changed: the list itself lives outside React.
  const items = useMemo(() => all(), [all, version]);
  const isOnPage = useCallback((anchor: Anchor) => engineRef.current?.onScreen(anchor) ?? false, []);
  const notesHere = ready ? items.filter((item) => (item.kind === 'note' || item.kind === 'sketch') && !item.deleted && engine.onScreen(item.anchor)).length : 0;
  const fraction = dragFraction ?? (ready ? engine.fraction() : 0);
  const pageLabel = ready && here ? `${engine.kind === 'fixed' ? '' : 'p. '}${here.page} of ${engine.totalPages}` : '';

  const jump = (anchor: Anchor) => {
    setPanel(null);
    setChrome(false);
    void engineRef.current?.goTo(anchor);
  };

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void fullscreenTarget()?.();
  };

  const { theme, fontSize, lineHeight, font } = settings;
  const toolColors = tool === 'marker' ? MARKER_COLORS : PEN_COLORS;

  return (
    <div className="rd-book" data-rd-theme={theme}>
      <div className="rd-stage" ref={stageRef}>
        <canvas className="rd-ink" ref={baseRef} />
        <canvas className="rd-ink" ref={liveRef} />
        <div className={`rd-touch${drawMode ? ' is-drawing' : ''}`} ref={layerRef} aria-hidden />
      </div>

      {phase !== 'ready' && (
        <div className="rd-status">
          {phase === 'error' ? (
            <>
              <p>{errorText}</p>
              <button type="button" className="rd-btn" onClick={onExit}>Back to your books</button>
            </>
          ) : phase === 'getting' ? (
            <>
              <p>Fetching {book.title}…</p>
              <div className="rd-meter"><span style={{ width: `${Math.round(fetched * 100)}%` }} /></div>
            </>
          ) : (
            <p>Opening {book.title}…</p>
          )}
        </div>
      )}

      {ready && here && !chrome && !drawMode && !panel && (
        <div className="rd-folio" aria-live="off">
          {pageLabel}
        </div>
      )}

      {ready && notesHere > 0 && !chrome && !drawMode && !panel && (
        <button type="button" className="rd-page-note" onClick={() => setPanel('notes-here')} aria-label={`${notesHere} note${notesHere === 1 ? '' : 's'} on this page`}>
          <Icon name="note" /> {notesHere}
        </button>
      )}

      {chrome && !drawMode && (
        <header className="rd-bar rd-top">
          <button type="button" className="rd-icon-btn" onClick={onExit} aria-label="Back to your books"><Icon name="left" /></button>
          <div className="rd-bar-title">
            <strong>{book.title}</strong>
            {here?.chapter && <span>{here.chapter}</span>}
          </div>
          <button type="button" className="rd-icon-btn" onClick={() => setPanel('contents')} aria-label="Contents" disabled={!ready}><Icon name="list" /></button>
          <button type="button" className="rd-icon-btn" onClick={() => setPanel('notes')} aria-label="Notes" disabled={!ready}><Icon name="note" /></button>
          <button type="button" className="rd-icon-btn" onClick={() => setPanel('look')} aria-label="How the page looks" disabled={!ready}><Icon name="text" /></button>
          {canFull && <button type="button" className="rd-icon-btn" onClick={toggleFull} aria-label={isFull ? 'Leave full screen' : 'Full screen'}><Icon name={isFull ? 'shrink' : 'expand'} /></button>}
        </header>
      )}

      {chrome && !drawMode && ready && (
        <footer className="rd-bar rd-bottom">
          <input
            type="range" min={0} max={1000} aria-label="Move through the book" className="rd-slider"
            value={Math.round(fraction * 1000)}
            onChange={(e) => setDragFraction(Number(e.target.value) / 1000)}
            onPointerUp={() => { if (dragFraction !== null) { void engine.goToFraction(dragFraction); setDragFraction(null); } }}
            onKeyUp={() => { if (dragFraction !== null) { void engine.goToFraction(dragFraction); setDragFraction(null); } }}
          />
          <span className="rd-bar-page">{pageLabel}</span>
          <button type="button" className="rd-btn is-primary" onClick={() => { setChrome(false); setDrawMode(true); }}><Icon name="pencil" /> Draw</button>
        </footer>
      )}

      {drawMode && (
        <div className="rd-tools" role="toolbar" aria-label="Pen">
          <button type="button" className={`rd-icon-btn${tool === 'pen' ? ' is-on' : ''}`} aria-pressed={tool === 'pen'} aria-label="Pen" onClick={() => setTool('pen')}><Icon name="pencil" /></button>
          <button type="button" className={`rd-icon-btn${tool === 'marker' ? ' is-on' : ''}`} aria-pressed={tool === 'marker'} aria-label="Highlighter" onClick={() => setTool('marker')}><Icon name="marker" /></button>
          <button type="button" className={`rd-icon-btn${tool === 'eraser' ? ' is-on' : ''}`} aria-pressed={tool === 'eraser'} aria-label="Eraser" onClick={() => setTool('eraser')}><Icon name="eraser" /></button>
          {tool !== 'eraser' && <span className="rd-tools-gap" />}
          {tool !== 'eraser' && toolColors.map((color) => {
            const current = tool === 'marker' ? markerColor : penColor;
            return (
              <button
                key={color} type="button" className={`rd-swatch${current === color ? ' is-on' : ''}`} aria-label={color} aria-pressed={current === color}
                style={{ background: inkColor(color, theme) }}
                onClick={() => (tool === 'marker' ? setMarkerColor(color) : setPenColor(color))}
              />
            );
          })}
          <span className="rd-tools-gap" />
          <button type="button" className="rd-icon-btn" aria-label="Undo" disabled={!undoCount} onClick={undo}><Icon name="undo" /></button>
          <button type="button" className="rd-btn is-primary" onClick={() => setDrawMode(false)}>Done</button>
        </div>
      )}

      {panel && ready && here && (
        <div className="rd-sheet-wrap" onClick={() => setPanel(null)}>
          <aside className="rd-sheet" onClick={(e) => e.stopPropagation()} aria-label={panel === 'contents' ? 'Contents' : panel === 'look' ? 'How the page looks' : 'Notes'}>
            <div className="rd-sheet-head">
              <div className="rd-tabs">
                <button type="button" className={panel === 'contents' ? 'is-on' : ''} onClick={() => setPanel('contents')}>Contents</button>
                <button type="button" className={panel === 'notes' || panel === 'notes-here' ? 'is-on' : ''} onClick={() => setPanel('notes')}>Notes</button>
                <button type="button" className={panel === 'look' ? 'is-on' : ''} onClick={() => setPanel('look')}>Page</button>
              </div>
              <span className="rd-grow" />
              <button type="button" className="rd-icon-btn" onClick={() => setPanel(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="rd-sheet-body">
              {panel === 'contents' && (
                engine.toc.length ? (
                  <ul className="rd-toc">
                    {engine.toc.map((entry, i) => (
                      <li key={i} style={{ paddingLeft: `${entry.depth * 0.9}rem` }}>
                        <button type="button" onClick={() => { setPanel(null); setChrome(false); void engineRef.current?.goToToc(entry); }}>
                          <span>{entry.label}</span>
                          {entry.page !== undefined && <span className="rd-toc-page">{entry.page}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="rd-empty">This book doesn’t list its chapters. The slider moves through it.</p>
              )}
              {(panel === 'notes' || panel === 'notes-here') && (
                <NotesPanel
                  key={panel}
                  items={items}
                  theme={theme}
                  here={here}
                  isOnPage={isOnPage}
                  startOnPage={panel === 'notes-here'}
                  onJump={jump}
                  onAddNote={(text) => addNote(engineRef.current!.here(), text)}
                  onAddSketch={(strokes, aspect) => addSketch(engineRef.current!.here(), strokes, aspect)}
                  onEdit={editNote}
                  onDelete={remove}
                />
              )}
              {panel === 'look' && (
                <div className="rd-look">
                  <div className="rd-label">Colour</div>
                  <div className="rd-themes">
                    {(['paper', 'sepia', 'night'] as const).map((value) => (
                      <button type="button" key={value} data-rd-swatch={value} className={theme === value ? 'is-on' : ''} aria-pressed={theme === value} onClick={() => onSettings({ ...settings, theme: value })}>{value[0].toUpperCase() + value.slice(1)}</button>
                    ))}
                  </div>
                  {engine.kind === 'flow' ? (
                    <>
                      <div className="rd-label">Text size</div>
                      <div className="rd-stepper">
                        <button type="button" className="rd-btn" aria-label="Smaller text" disabled={fontSize <= 12} onClick={() => onSettings({ ...settings, fontSize: fontSize - 1 })}>A−</button>
                        <span>{fontSize}</span>
                        <button type="button" className="rd-btn" aria-label="Bigger text" disabled={fontSize >= 34} onClick={() => onSettings({ ...settings, fontSize: fontSize + 1 })}>A+</button>
                      </div>
                      <div className="rd-label">Line spacing</div>
                      <div className="rd-tabs">
                        {([['Tight', 1.3], ['Normal', 1.5], ['Loose', 1.75]] as const).map(([label, value]) => (
                          <button type="button" key={label} className={lineHeight === value ? 'is-on' : ''} aria-pressed={lineHeight === value} onClick={() => onSettings({ ...settings, lineHeight: value })}>{label}</button>
                        ))}
                      </div>
                      <div className="rd-label">Font</div>
                      <div className="rd-tabs">
                        {([['The book’s', 'book'], ['Serif', 'serif'], ['Sans', 'sans']] as const).map(([label, value]) => (
                          <button type="button" key={value} className={font === value ? 'is-on' : ''} aria-pressed={font === value} onClick={() => onSettings({ ...settings, font: value })}>{label}</button>
                        ))}
                      </div>
                      <p className="rd-hint">Page numbers and your notes stay put when you change these, and your pen marks stay with their words.</p>
                    </>
                  ) : (
                    <p className="rd-hint">Pinch to zoom in, and drag to move around the page.</p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
