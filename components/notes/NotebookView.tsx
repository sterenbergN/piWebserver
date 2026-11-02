'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/study/Icon';
import { useTheme } from '@/components/ThemeProvider';
import { useWakeLock } from '@/components/useWakeLock';
import type { ShapeKind } from '@/lib/notes/geometry';
import { isDark, TEXT_FONTS, type MarkElement, type MarkRole, type Notebook, type PageRecord, type StrokeElement, type TextFont } from '@/lib/notes/items';
import { getKv, getLibraryRecord, placeKey, putKv } from './db';
import { NotebookDoc } from './doc';
import { NoteCanvas, noteClipboard, type EngineSettings, type SelectionInfo, type TextStyle, type ToolName, type Tools } from './engine';
import { exportPdf, exportPng, parsePageRange, safeFileName, shareOrSave } from './export';
import { ConnectDialog, Glyph, type ConnectRequest } from './Connect';
import { addPdfToNotebook, bringFilesAcross, linksTo, preparePicture, searchNotebook, type PagePlace, type SearchHit } from './notebooks';
import PagesPanel from './PagesPanel';
import { RecordingBar, RecordingsPanel, useRecorder } from './Recorder';
import { keepNewFile, newFileId, scheduleSync, syncNow, watchNews, watchSync, type SyncState } from './sync';
import { TemplateGrid, PaperSwatches } from './TemplatePicker';

// A notebook, full screen: the canvas (engine.ts), with the toolbar, tool settings and panels
// around it. The canvas draws outside React and tells this what's changed through its events.

type Panel = 'pages' | 'search' | 'export' | 'settings' | 'recordings' | 'add-page' | 'links-here' | null;

/** Where you were before following a link, to come back to. */
export type Place = { notebook: string; page: string };

const TOOLS_KEY = 'notes-tools';
const SETTINGS_KEY = 'notes-settings';
const HINT_KEY = 'notes-gesture-hint';
const NIGHT_KEY = 'notes-night';

const PEN_COLORS = ['#1d1f27', '#d13a32', '#2a6bd1', '#2c8a57', '#7b3fc9', '#e07b1a', '#ffffff'];
const MARKER_COLORS = ['#ffe14d', '#9ff0b4', '#ffb3d1', '#a6d8ff', '#ffc078', '#d0b3ff'];
const TAPE_COLORS = ['#c9ccd3', '#f2c14e', '#7fb8d8', '#e58fa6'];
const PEN_WIDTHS = [0.8, 1.3, 2, 3.2];
const MARKER_WIDTHS = [9, 14, 22];
const SHAPE_WIDTHS = [0.8, 1.5, 2.5];
const TAPE_WIDTHS = [12, 20, 34];
const ERASER_WIDTHS = [4, 10, 22];
const TEXT_SIZES = [10, 12, 14, 18, 24, 32, 48];

const DEFAULT_TOOLS: Tools = {
  tool: 'pen',
  penStyle: 'fountain',
  penColor: PEN_COLORS[0],
  penWidth: PEN_WIDTHS[1],
  markerColor: MARKER_COLORS[0],
  markerWidth: MARKER_WIDTHS[1],
  eraserMode: 'partial',
  eraserWidth: ERASER_WIDTHS[1],
  shapeKind: 'auto',
  shapeColor: PEN_COLORS[0],
  shapeWidth: SHAPE_WIDTHS[1],
  tapeColor: TAPE_COLORS[0],
  tapeWidth: TAPE_WIDTHS[1],
  text: { size: 14, color: PEN_COLORS[0], font: 'sans', bold: false, italic: false, align: 'left' },
};

const DEFAULT_SETTINGS: EngineSettings = { direction: 'vertical', fingerDraws: 'auto', twoFingerTap: 'eraser', snapShapes: true };

function loadStored<T extends object>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved) return { ...fallback, ...saved };
  } catch { /* Private browsing, or something unreadable: defaults are fine. */ }
  return fallback;
}

const TOOL_BUTTONS: { tool: ToolName; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'pencil', label: 'Pen' },
  { tool: 'marker', icon: 'marker', label: 'Highlighter' },
  { tool: 'eraser', icon: 'eraser', label: 'Eraser' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso: select and move' },
  { tool: 'shape', icon: 'shapes', label: 'Shapes' },
  { tool: 'text', icon: 'text', label: 'Text' },
  { tool: 'tape', icon: 'tape', label: 'Tape: hide things, tap to show' },
  { tool: 'hand', icon: 'hand', label: 'Just move around' },
];

const SHAPE_KINDS: { kind: 'auto' | ShapeKind; label: string }[] = [
  { kind: 'auto', label: 'Auto' }, { kind: 'line', label: 'Line' }, { kind: 'arrow', label: 'Arrow' }, { kind: 'rect', label: 'Box' }, { kind: 'ellipse', label: 'Oval' }, { kind: 'triangle', label: 'Triangle' },
];

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (color: string) => void }) {
  return (
    <>
      {colors.map((color) => (
        <button key={color} type="button" className={`nt-swatch${value.toLowerCase() === color ? ' is-on' : ''}`} aria-label={`Colour ${color}`} aria-pressed={value.toLowerCase() === color} style={{ background: color }} onClick={() => onPick(color)} />
      ))}
      <label className={`nt-swatch is-custom${colors.includes(value.toLowerCase()) ? '' : ' is-on'}`} style={{ background: colors.includes(value.toLowerCase()) ? undefined : value }} title="Any colour">
        <span className="sr-only">Any colour</span>
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </>
  );
}

function Widths({ widths, value, scale, onPick }: { widths: number[]; value: number; scale: number; onPick: (width: number) => void }) {
  return (
    <>
      {widths.map((width) => (
        <button key={width} type="button" className={`nt-width${value === width ? ' is-on' : ''}`} aria-label={`Width ${width}`} aria-pressed={value === width} onClick={() => onPick(width)}>
          <span style={{ width: `${Math.max(3, width * scale)}px`, height: `${Math.max(3, width * scale)}px` }} />
        </button>
      ))}
    </>
  );
}

export default function NotebookView({ notebook, startPage, returnTo, onExit, onOpen }: {
  notebook: string;
  startPage: string | null;
  /** Followed a link here from another notebook: the way back. */
  returnTo: Place | null;
  onExit: () => void;
  onOpen: (notebook: string, page: string | null, from: Place | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const engineRef = useRef<NoteCanvas | null>(null);
  const [doc] = useState(() => new NotebookDoc(notebook));
  const [engine, setEngine] = useState<NoteCanvas | null>(null);
  const [info, setInfo] = useState<Notebook | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [tools, setTools] = useState<Tools>(DEFAULT_TOOLS);
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_SETTINGS);
  const [night, setNight] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [atEnd, setAtEnd] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [editing, setEditing] = useState<TextStyle | null>(null);
  const [toast, setToast] = useState('');
  const [undoState, setUndoState] = useState({ undo: false, redo: false, paste: false });
  const [chrome, setChrome] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const [sync, setSync] = useState<SyncState>('idle');
  const [recolor, setRecolor] = useState(false);
  const [connect, setConnect] = useState<ConnectRequest | null>(null);
  const [connectInk, setConnectInk] = useState<{ id: string; p: number[]; width: number }[]>([]);
  /** Followed a link within this notebook: the page to go back to. */
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  const [linksHere, setLinksHere] = useState<(PagePlace & { label: string })[]>([]);
  const followRef = useRef<(mark: MarkElement) => void>(() => {});
  const [, setDocTick] = useState(0);
  const pictureRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolsRef = useRef(tools);
  const { theme, toggleTheme } = useTheme();

  const say = useCallback((text: string, ms = 1400) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), ms);
  }, []);

  useWakeLock(phase === 'ready');

  const recorder = useRecorder(notebook, doc, say);
  const recorderRef = useRef(recorder);
  useEffect(() => { recorderRef.current = recorder; });

  // While a recording plays, the canvas lights up what was being written, and a tap on ink jumps there.
  const heard = recorder.playing;
  useEffect(() => {
    engine?.setPlayback(heard ? { startedAt: heard.record.startedAt, at: heard.at } : null);
  }, [engine, heard]);

  // Called after every stroke, so it only redraws the screen when the buttons really change.
  const refreshUndo = useCallback(() => {
    const next = { undo: doc.canUndo, redo: doc.canRedo, paste: noteClipboard.elements.length > 0 };
    setUndoState((held) => (held.undo === next.undo && held.redo === next.redo && held.paste === next.paste ? held : next));
  }, [doc]);

  const applyTools = useCallback((next: Tools) => {
    toolsRef.current = next;
    setTools(next);
    engineRef.current?.setTools(next);
    try { localStorage.setItem(TOOLS_KEY, JSON.stringify(next)); } catch { /* It still applies for now. */ }
  }, []);

  const lastInk = useRef<ToolName>('pen');
  const chooseTool = useCallback((tool: ToolName) => {
    const current = toolsRef.current;
    if (tool === current.tool) {
      setOptionsOpen((open) => !open);
      return;
    }
    if (tool !== 'eraser') lastInk.current = tool;
    setOptionsOpen(true);
    applyTools({ ...current, tool });
  }, [applyTools]);

  // ── Opening the notebook ─────────────────────────────────────────────────────

  useEffect(() => {
    let live = true;
    const savedTools = loadStored(TOOLS_KEY, DEFAULT_TOOLS);
    const savedSettings = loadStored(SETTINGS_KEY, DEFAULT_SETTINGS);
    toolsRef.current = savedTools;
    setTools(savedTools);
    setSettings(savedSettings);
    let savedNight = false;
    try { savedNight = localStorage.getItem(NIGHT_KEY) === 'yes'; } catch { /* Fine. */ }
    setNight(savedNight);
    try {
      if (navigator.maxTouchPoints > 1 && !localStorage.getItem(HINT_KEY)) {
        localStorage.setItem(HINT_KEY, 'seen');
        setTimeout(() => say('Pencil writes. One finger moves the page. Two-finger tap for the eraser, three-finger tap to undo.', 5500), 800);
      }
    } catch { /* No hint, then. */ }

    let canvas: NoteCanvas | null = null;
    let stopDoc = () => {};

    (async () => {
      const record = await getLibraryRecord(notebook);
      if (!live) return;
      if (record?.kind === 'notebook' && !record.deleted) setInfo(record as Notebook);
      await doc.load();
      if (!doc.pages.length) {
        // Just signed in on a new device, and not synced yet.
        await syncNow();
        await doc.load();
      }
      if (!live) return;
      if (!doc.pages.length || !hostRef.current) {
        setPhase('missing');
        return;
      }
      canvas = new NoteCanvas(hostRef.current, doc, savedTools, savedSettings, {
        onPage: setPageIndex,
        onSelection: setSelection,
        onZoom: setZoom,
        onEnd: setAtEnd,
        onTool: (tool) => {
          if (tool !== toolsRef.current.tool) {
            setOptionsOpen(false);
            applyTools({ ...toolsRef.current, tool: tool === 'pen' && lastInk.current !== 'eraser' ? lastInk.current : tool });
            say(tool === 'eraser' ? 'Eraser' : tool === 'pen' ? 'Pen' : TOOL_BUTTONS.find((b) => b.tool === tool)?.label.split(':')[0] ?? '');
          }
        },
        onSay: say,
        onEditing: setEditing,
        onInkTap: (stroke: StrokeElement) => recorderRef.current.seekToStroke(stroke),
        onFollow: (mark) => followRef.current(mark),
        onUndoState: refreshUndo,
      });
      canvas.setNight(savedNight);
      canvas.setTopInset(barRef.current?.offsetHeight ?? 0);
      engineRef.current = canvas;
      setEngine(canvas);
      canvas.start();
      const place = startPage ? { page: startPage, fx: 0.5, fy: 0.5 } : await getKv<{ page: string; fx: number; fy: number }>(placeKey(notebook));
      if (live && place) canvas.restorePlace(place);
      if (startPage) canvas.goToPageId(startPage);
      setPhase('ready');
      setPageCount(doc.pages.length);
      // Only changes to the pages themselves show here. A stroke is the canvas's business, and
      // redrawing all of this after each one would hold up the next.
      stopDoc = doc.subscribe((page) => {
        if (page !== null) return;
        setPageCount(doc.pages.length);
        setDocTick((tick) => tick + 1);
      });
      void doc.ensure(doc.pages[0].id);
    })();

    const stopNews = watchNews((news) => {
      if (news.notebook !== notebook) return;
      void doc.reload(news.pages ?? []);
    });
    const stopSync = watchSync(setSync);
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      const place = engineRef.current?.place();
      if (place) void putKv(placeKey(notebook), place);
      void doc.touchLibrary();
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      live = false;
      stopDoc();
      stopNews();
      stopSync();
      document.removeEventListener('visibilitychange', onHide);
      const place = canvas?.place();
      if (place) void putKv(placeKey(notebook), place);
      canvas?.destroy();
      engineRef.current = null;
      void doc.touchLibrary().then(() => doc.settled()).then(() => scheduleSync(200));
    };
    // Set up once for each notebook; everything else reaches the canvas through its methods.
  }, [notebook]);

  useEffect(() => { engine?.setNight(night); }, [engine, night, theme]);

  // Pages scroll clear of the toolbar, or right to the top with it hidden.
  useEffect(() => {
    if (!engine) return;
    const bar = barRef.current;
    if (!bar) { engine.setTopInset(0); return; }
    const observer = new ResizeObserver(() => engine.setTopInset(bar.offsetHeight));
    observer.observe(bar);
    engine.setTopInset(bar.offsetHeight);
    return () => observer.disconnect();
  }, [engine, chrome]);

  const applySettings = (next: EngineSettings) => {
    setSettings(next);
    engine?.setSettings(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* It still applies for now. */ }
  };

  // ── Things you can do ────────────────────────────────────────────────────────

  const here: PageRecord | undefined = doc.pages[pageIndex] ?? doc.pages[0];
  const onDarkPaper = isDark(here?.paper ?? '#ffffff');

  // Black ink can't be seen on black paper. Arriving on a page where the pen wouldn't show
  // swaps it for its opposite, and only if it was plain black or white to begin with.
  useEffect(() => {
    const swap = (color: string) => (onDarkPaper ? (color === PEN_COLORS[0] ? '#ffffff' : color) : (color === '#ffffff' ? PEN_COLORS[0] : color));
    const now = toolsRef.current;
    const next = { ...now, penColor: swap(now.penColor), shapeColor: swap(now.shapeColor), text: { ...now.text, color: swap(now.text.color) } };
    if (next.penColor !== now.penColor || next.shapeColor !== now.shapeColor || next.text.color !== now.text.color) applyTools(next);
  }, [onDarkPaper, applyTools]);
  const bookmarked = !!here?.starred;

  const goTo = (place: Place) => {
    if (place.notebook !== notebook) { onOpen(place.notebook, place.page, { notebook, page: here?.id ?? '' }); return; }
    setCameFrom(here?.id ?? null);
    engine?.goToPageId(place.page);
  };

  // Following a link: to a page here, a page in another notebook, or out to the web.
  const follow = (mark: MarkElement) => {
    const target = mark.target;
    if (!target) return;
    if ('url' in target) {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target.notebook === notebook) {
      const page = target.page ?? doc.pages[0]?.id;
      if (!page || !doc.pages.some((p) => p.id === page)) { say('That page isn’t there any more.', 2500); return; }
      setCameFrom(here?.id ?? null);
      engine?.goToPageId(page);
      return;
    }
    onOpen(target.notebook, target.page ?? null, { notebook, page: here?.id ?? '' });
  };
  useEffect(() => { followRef.current = follow; });

  const goBack = () => {
    if (cameFrom) {
      engine?.goToPageId(cameFrom);
      setCameFrom(null);
    } else if (returnTo) {
      onOpen(returnTo.notebook, returnTo.page, null);
    }
  };

  const openConnect = (request: ConnectRequest) => {
    setConnectInk(request.mark ? [] : engine?.selectionInk() ?? []);
    setConnect(request);
  };

  // Links from anywhere that come to this page.
  const herePage = here?.id;
  const firstPage = doc.pages[0]?.id;
  useEffect(() => {
    if (!herePage) return;
    let live = true;
    void linksTo(notebook, herePage, herePage === firstPage).then((links) => { if (live) setLinksHere(links); });
    return () => { live = false; };
  }, [notebook, herePage, firstPage, undoState]);

  const toggleBookmark = () => {
    const page = here;
    if (!page) return;
    const { starred: _starred, ...rest } = page;
    if (page.starred) doc.apply([{ type: 'book', before: page, after: { ...rest, updatedAt: Date.now() } }]);
    else doc.updatePage(page, { starred: true });
    say(page.starred ? 'Bookmark removed' : 'Bookmarked');
  };

  const addPage = (like: Partial<Pick<PageRecord, 'template' | 'paper' | 'w' | 'h'>> = {}) => {
    const made = doc.addPage(here?.id ?? null, like);
    setPanel(null);
    setTimeout(() => engine?.goToPageId(made.id), 0);
    say(`Page ${doc.pages.findIndex((p) => p.id === made.id) + 1} of ${doc.pages.length}`);
  };

  const insertPicture = async (file: Blob) => {
    try {
      const { blob, width, height } = await preparePicture(file);
      const id = newFileId();
      await keepNewFile(notebook, id, blob);
      engine?.insertImage(id, width, height);
    } catch (error) {
      say(error instanceof Error ? error.message : 'That picture wouldn’t open.', 3000);
    }
  };

  const pasteHere = () => {
    void engine?.paste((elements) => bringFilesAcross(elements, noteClipboard.notebook, notebook));
  };

  // Pictures pasted from anywhere else on the device.
  const pasteRef = useRef({ insertPicture, pasteHere });
  useEffect(() => { pasteRef.current = { insertPicture, pasteHere }; });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const image = [...(e.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      if (image) {
        e.preventDefault();
        void pasteRef.current.insertPicture(image);
      } else if (noteClipboard.elements.length) {
        e.preventDefault();
        pasteRef.current.pasteHere();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const addPdf = async (file: File) => {
    const page = here;
    if (!page) return;
    say(`Adding ${file.name}…`, 8000);
    try {
      const index = doc.pages.findIndex((p) => p.id === page.id);
      const added = await addPdfToNotebook(notebook, file, { order: page.order, next: doc.pages[index + 1]?.order });
      await doc.load();
      await doc.reload([]);
      if (added[0]) engine?.goToPageId(added[0].id);
      say(`Added ${added.length} page${added.length === 1 ? '' : 's'}`);
    } catch {
      say('That PDF wouldn’t open.', 3000);
    }
  };

  const setText = (next: TextStyle) => {
    applyTools({ ...toolsRef.current, text: next });
    if (editing) {
      setEditing(next);
      engine?.setTextStyle(next);
    }
  };

  // Where the bar for what's selected sits: above it if there's room, otherwise below.
  const selectionStyle = useMemo(() => {
    if (!selection) return undefined;
    const middle = selection.rect.x + selection.rect.w / 2;
    // Clear of the turning handle, which stands above the top edge.
    const above = selection.rect.y - 96;
    const top = above >= 60 ? above : Math.min(selection.rect.y + selection.rect.h + 16, window.innerHeight - 120);
    return { left: `clamp(150px, ${middle}px, calc(100% - 150px))`, top: `${top}px` };
  }, [selection]);

  const canvasTool = tools.tool;
  const textStyle = editing ?? tools.text;
  const totalPages = pageCount;
  const title = info?.title ?? 'Notebook';

  return (
    <div className={`nt-book${chrome ? '' : ' is-focus'}`}>
      <div className="nt-host" ref={hostRef} />

      {phase === 'loading' && <div className="nt-status"><p>Opening…</p></div>}
      {phase === 'missing' && (
        <div className="nt-status">
          <p>This notebook isn’t on this device yet, and there’s no connection to fetch it.</p>
          <button type="button" className="nt-btn" onClick={onExit}>Back to your notes</button>
        </div>
      )}

      {toast && <div className="nt-toast" role="status">{toast}</div>}

      {chrome && (
        <header className="nt-bar" ref={barRef} role="toolbar" aria-label="Notebook tools">
          <div className="nt-bar-side">
            <button type="button" className="nt-icon-btn" aria-label="Back to your notes" onClick={onExit}><Icon name="left" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Pages" onClick={() => setPanel('pages')}><Icon name="pages" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Search this notebook" onClick={() => setPanel('search')}><Icon name="search" /></button>
            <button type="button" className={`nt-icon-btn${bookmarked ? ' is-marked' : ''}`} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'} aria-pressed={bookmarked} onClick={toggleBookmark}><Icon name="bookmark" /></button>
          </div>
          <div className="nt-bar-tools">
            {TOOL_BUTTONS.map(({ tool, icon, label }) => (
              <button key={tool} type="button" className={`nt-icon-btn${canvasTool === tool ? ' is-on' : ''}`} aria-label={label} title={label} aria-pressed={canvasTool === tool} onClick={() => chooseTool(tool)}>
                <Icon name={icon} />
                {tool === 'pen' && <i className="nt-tool-dot" style={{ background: tools.penColor }} />}
                {tool === 'marker' && <i className="nt-tool-dot" style={{ background: tools.markerColor }} />}
              </button>
            ))}
            <span className="nt-bar-gap" />
            <button type="button" className="nt-icon-btn" aria-label="Add a picture" title="Add a picture" onClick={() => pictureRef.current?.click()}><Icon name="image" /></button>
            <button type="button" className={`nt-icon-btn${recorder.recording ? ' is-recording' : ''}`} aria-label={recorder.recording ? 'Stop recording' : 'Record sound'} title="Record sound while you write" onClick={() => (recorder.recording ? void recorder.stop() : setPanel('recordings'))}><Icon name={recorder.recording ? 'stop' : 'mic'} /></button>
          </div>
          <div className="nt-bar-side is-end">
            <button type="button" className="nt-icon-btn" aria-label="Undo" disabled={!undoState.undo} onClick={() => engine?.undo()}><Icon name="undo" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Redo" disabled={!undoState.redo} onClick={() => engine?.redo()}><Icon name="redo" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Add a page" onClick={() => setPanel('add-page')}><Icon name="plus" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Export and share" onClick={() => setPanel('export')}><Icon name="share" /></button>
            <button type="button" className="nt-icon-btn" aria-label="Settings" onClick={() => setPanel('settings')}><Icon name="sliders" /></button>
          </div>
        </header>
      )}

      {chrome && optionsOpen && (canvasTool !== 'hand' && canvasTool !== 'lasso') && !editing && (
        <div className="nt-options" role="toolbar" aria-label="Tool settings">
          {canvasTool === 'pen' && (
            <>
              <div className="nt-tabs is-small">
                {([['ball', 'Ball'], ['fountain', 'Fountain'], ['brush', 'Brush']] as const).map(([style, label]) => (
                  <button key={style} type="button" className={tools.penStyle === style ? 'is-on' : ''} aria-pressed={tools.penStyle === style} onClick={() => applyTools({ ...tools, penStyle: style })}>{label}</button>
                ))}
              </div>
              <span className="nt-bar-gap" />
              <Widths widths={PEN_WIDTHS} value={tools.penWidth} scale={3} onPick={(penWidth) => applyTools({ ...tools, penWidth })} />
              <span className="nt-bar-gap" />
              <Swatches colors={PEN_COLORS} value={tools.penColor} onPick={(penColor) => applyTools({ ...tools, penColor })} />
            </>
          )}
          {canvasTool === 'marker' && (
            <>
              <Widths widths={MARKER_WIDTHS} value={tools.markerWidth} scale={0.8} onPick={(markerWidth) => applyTools({ ...tools, markerWidth })} />
              <span className="nt-bar-gap" />
              <Swatches colors={MARKER_COLORS} value={tools.markerColor} onPick={(markerColor) => applyTools({ ...tools, markerColor })} />
            </>
          )}
          {canvasTool === 'eraser' && (
            <>
              <div className="nt-tabs is-small">
                {([['partial', 'Rub out'], ['stroke', 'Whole stroke'], ['marker', 'Highlighter only']] as const).map(([mode, label]) => (
                  <button key={mode} type="button" className={tools.eraserMode === mode ? 'is-on' : ''} aria-pressed={tools.eraserMode === mode} onClick={() => applyTools({ ...tools, eraserMode: mode })}>{label}</button>
                ))}
              </div>
              <span className="nt-bar-gap" />
              <Widths widths={ERASER_WIDTHS} value={tools.eraserWidth} scale={0.9} onPick={(eraserWidth) => applyTools({ ...tools, eraserWidth })} />
            </>
          )}
          {canvasTool === 'shape' && (
            <>
              <div className="nt-tabs is-small">
                {SHAPE_KINDS.map(({ kind, label }) => (
                  <button key={kind} type="button" className={tools.shapeKind === kind ? 'is-on' : ''} aria-pressed={tools.shapeKind === kind} onClick={() => applyTools({ ...tools, shapeKind: kind })}>{label}</button>
                ))}
              </div>
              <span className="nt-bar-gap" />
              <Widths widths={SHAPE_WIDTHS} value={tools.shapeWidth} scale={3} onPick={(shapeWidth) => applyTools({ ...tools, shapeWidth })} />
              <span className="nt-bar-gap" />
              <Swatches colors={PEN_COLORS} value={tools.shapeColor} onPick={(shapeColor) => applyTools({ ...tools, shapeColor })} />
            </>
          )}
          {canvasTool === 'tape' && (
            <>
              <Widths widths={TAPE_WIDTHS} value={tools.tapeWidth} scale={0.6} onPick={(tapeWidth) => applyTools({ ...tools, tapeWidth })} />
              <span className="nt-bar-gap" />
              <Swatches colors={TAPE_COLORS} value={tools.tapeColor} onPick={(tapeColor) => applyTools({ ...tools, tapeColor })} />
              <span className="nt-options-note">Cover an answer, then tap it to peek.</span>
            </>
          )}
          {canvasTool === 'text' && <TextOptions style={textStyle} onChange={setText} />}
        </div>
      )}

      {chrome && editing && (
        <div className="nt-options" role="toolbar" aria-label="Text style" onPointerDown={(e) => e.preventDefault()}>
          <TextOptions style={textStyle} onChange={setText} />
          <button type="button" className="nt-btn is-small is-primary" onClick={() => engine?.finishEditing()}>Done</button>
        </div>
      )}

      {selection && selection.count > 0 && (
        <div className="nt-selection" style={selectionStyle} role="toolbar" aria-label="Selection" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" aria-label="Cut" title="Cut" onClick={() => { engine?.cutSelection(); refreshUndo(); }}><Icon name="scissors" /></button>
          <button type="button" aria-label="Copy" title="Copy" onClick={() => { engine?.copySelection(); refreshUndo(); }}><Icon name="copy" /></button>
          <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => engine?.duplicateSelection()}><Icon name="pages" /></button>
          {selection.hasStroke && (
            <>
              <button type="button" aria-label="Turn into typed text" title="Turn into typed text" onClick={() => openConnect({ role: 'text' })}><Glyph name="to-text" /></button>
              <button type="button" aria-label="Make a link" title="Make a link" onClick={() => openConnect({ role: 'link' })}><Icon name="link" /></button>
              <button type="button" aria-label="Make a heading" title="Make a heading" onClick={() => openConnect({ role: 'heading' })}><Glyph name="heading" /></button>
              <button type="button" aria-label="Make a keyword" title="Make a keyword" onClick={() => openConnect({ role: 'keyword' })}><Glyph name="tag" /></button>
            </>
          )}
          {selection.mark && (
            <button type="button" aria-label={`Change ${selection.mark.role}`} title={`Change ${selection.mark.role}`} onClick={() => openConnect({ role: selection.mark!.role, mark: selection.mark! })}><Icon name="pencil" /></button>
          )}
          {selection.count === 1 && selection.hasText && <button type="button" aria-label="Edit text" title="Edit text" onClick={() => engine?.editSelectedText()}><Icon name="text" /></button>}
          {selection.hasImage && <button type="button" aria-label="Bring to front" title="Bring to front" onClick={() => engine?.bringForward()}><Icon name="layers" /></button>}
          {(selection.hasStroke || selection.hasText) && <button type="button" aria-label="Change colour" title="Change colour" aria-expanded={recolor} onClick={() => setRecolor((open) => !open)}><span className="nt-recolor-dot" /></button>}
          <button type="button" className="is-danger" aria-label="Delete" title="Delete" onClick={() => engine?.deleteSelection()}><Icon name="trash" /></button>
          {recolor && (
            <div className="nt-selection-colors">
              <Swatches colors={PEN_COLORS} value="#000001" onPick={(color) => { engine?.recolorSelection(color); setRecolor(false); }} />
            </div>
          )}
        </div>
      )}

      {phase === 'ready' && atEnd && !selection && (
        <button type="button" className="nt-add-end" onClick={() => addPage()}><Icon name="plus" /> New page</button>
      )}

      {phase === 'ready' && (
        <div className="nt-corner">
          {(cameFrom || returnTo) && (
            <button type="button" className="nt-chip is-back" onClick={goBack}><Icon name="left" /> Back</button>
          )}
          {linksHere.length > 0 && (
            <button type="button" className="nt-chip" onClick={() => setPanel('links-here')} aria-label={`${linksHere.length} link${linksHere.length === 1 ? '' : 's'} to this page`}><Icon name="link" /> {linksHere.length}</button>
          )}
          {zoom !== 100 && <button type="button" className="nt-chip" onClick={() => engine?.fit()} aria-label="Fit the page to the window">{zoom}%</button>}
          {sync === 'offline' && <span className="nt-chip is-quiet" title="Saved here. It’ll go up when there’s a connection."><Icon name="offline" /></span>}
          {undoState.paste && !selection && <button type="button" className="nt-chip" onClick={pasteHere}><Icon name="paste" /> Paste</button>}
          <button type="button" className="nt-chip" onClick={() => setPanel('pages')} aria-label={`Page ${pageIndex + 1} of ${totalPages}. Open pages.`}>{pageIndex + 1} / {totalPages}</button>
          <button type="button" className="nt-chip" aria-label={chrome ? 'Hide the toolbar' : 'Show the toolbar'} aria-pressed={!chrome} onClick={() => setChrome((on) => !on)}><Icon name={chrome ? 'expand' : 'shrink'} /></button>
        </div>
      )}

      <RecordingBar recorder={recorder} onOpen={() => setPanel('recordings')} />

      {connect && (
        <div className="nt-sheet-wrap is-center" onClick={() => setConnect(null)}>
          <ConnectDialog
            request={connect}
            ink={connectInk}
            notebook={notebook}
            onCancel={() => setConnect(null)}
            onConvert={(text) => { engine?.convertSelectionToText(text); setConnect(null); }}
            onSave={(label, extra) => {
              if (connect.mark) engine?.updateMark(connect.mark, { label, ...extra });
              else engine?.markSelection(connect.role as MarkRole, label, extra);
              setConnect(null);
              say(connect.role === 'link' ? 'Linked. Tap it to follow.' : connect.role === 'heading' ? 'Heading added to the outline' : 'Keyword added');
            }}
          />
        </div>
      )}

      <input ref={pictureRef} type="file" hidden accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void insertPicture(file); e.target.value = ''; }} />
      <input ref={pdfRef} type="file" hidden accept="application/pdf,.pdf" onChange={(e) => { const file = e.target.files?.[0]; if (file) void addPdf(file); e.target.value = ''; }} />

      {panel && (
        <div className="nt-sheet-wrap" onClick={() => setPanel(null)}>
          <aside className={`nt-sheet${panel === 'pages' ? ' is-left' : ''}`} onClick={(e) => e.stopPropagation()} aria-label="Panel">
            {panel === 'pages' && (
              <PagesPanel
                doc={doc}
                notebook={notebook}
                current={here?.id ?? ''}
                onGo={(page, box) => { setPanel(null); engine?.goToPageId(page); if (box) engine?.flash(page, box); }}
                onClose={() => setPanel(null)}
                onSay={say}
              />
            )}
            {panel === 'search' && <SearchPanel notebook={notebook} title={title} onGo={(page, box) => { setPanel(null); engine?.goToPageId(page); if (box) engine?.flash(page, box); }} onClose={() => setPanel(null)} />}
            {panel === 'links-here' && (
              <>
                <div className="nt-sheet-head"><strong>Links to this page</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={() => setPanel(null)}><Icon name="x" /></button></div>
                <div className="nt-sheet-body">
                  {linksHere.map((link, i) => (
                    <button type="button" key={`${link.page}/${i}`} className="nt-result" onClick={() => { setPanel(null); goTo({ notebook: link.notebook, page: link.page }); }}>
                      <strong>{link.label || 'A link'}</strong>
                      <small>{link.notebook === notebook ? 'This notebook' : link.title} · page {link.pageNumber}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {panel === 'export' && <ExportPanel doc={doc} notebook={notebook} title={title} current={here} onClose={() => setPanel(null)} />}
            {panel === 'recordings' && <RecordingsPanel doc={doc} notebook={notebook} recorder={recorder} onClose={() => setPanel(null)} />}
            {panel === 'add-page' && (
              <AddPagePanel
                current={here}
                onAdd={addPage}
                onPdf={() => pdfRef.current?.click()}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'settings' && (
              <>
                <div className="nt-sheet-head"><strong>Settings</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={() => setPanel(null)}><Icon name="x" /></button></div>
                <div className="nt-sheet-body">
                  <div className="nt-label">Pages scroll</div>
                  <div className="nt-tabs is-wide">
                    {([['vertical', 'Up and down'], ['horizontal', 'Side to side']] as const).map(([value, label]) => (
                      <button key={value} type="button" className={settings.direction === value ? 'is-on' : ''} aria-pressed={settings.direction === value} onClick={() => applySettings({ ...settings, direction: value })}>{label}</button>
                    ))}
                  </div>
                  <div className="nt-label">Fingers</div>
                  <div className="nt-tabs is-wide">
                    {([['auto', 'Write until a pencil is used'], ['on', 'Always write'], ['off', 'Never write']] as const).map(([value, label]) => (
                      <button key={value} type="button" className={settings.fingerDraws === value ? 'is-on' : ''} aria-pressed={settings.fingerDraws === value} onClick={() => applySettings({ ...settings, fingerDraws: value })}>{label}</button>
                    ))}
                  </div>
                  <div className="nt-label">Two-finger tap</div>
                  <div className="nt-tabs is-wide">
                    {([['eraser', 'Pen and eraser'], ['undo', 'Undo']] as const).map(([value, label]) => (
                      <button key={value} type="button" className={settings.twoFingerTap === value ? 'is-on' : ''} aria-pressed={settings.twoFingerTap === value} onClick={() => applySettings({ ...settings, twoFingerTap: value })}>{label}</button>
                    ))}
                  </div>
                  <label className="nt-check">
                    <input type="checkbox" checked={settings.snapShapes} onChange={(e) => applySettings({ ...settings, snapShapes: e.target.checked })} />
                    <span><strong>Hold to straighten</strong>Hold the pencil still at the end of a stroke, and it snaps to a straight line, circle, box or triangle.</span>
                  </label>
                  <label className="nt-check">
                    <input type="checkbox" checked={night} onChange={(e) => { setNight(e.target.checked); try { localStorage.setItem(NIGHT_KEY, e.target.checked ? 'yes' : 'no'); } catch { /* For now, then. */ } }} />
                    <span><strong>Night view</strong>Shows every page in reverse, for reading in the dark. Only how it looks here: what’s saved and exported stays as it is.</span>
                  </label>
                  <label className="nt-check">
                    <input type="checkbox" checked={theme === 'light'} onChange={toggleTheme} />
                    <span><strong>Light toolbar</strong>The app’s bars and panels in the light theme.</span>
                  </label>
                  <ReadingStatus />
                  <PencilCheck engine={engine} />
                  <div className="nt-label">Quick gestures</div>
                  <ul className="nt-gestures">
                    <li><strong>Apple Pencil</strong><span>Always writes. Your palm can rest on the screen.</span></li>
                    <li><strong>One finger</strong><span>Moves the page, once a pencil has been used here.</span></li>
                    <li><strong>Two fingers</strong><span>Pinch to zoom, or drag to move. Double-tap to zoom in and back out.</span></li>
                    <li><strong>Two-finger tap</strong><span>{settings.twoFingerTap === 'undo' ? 'Undo.' : 'Between the pen and the eraser.'}</span></li>
                    <li><strong>Three-finger tap</strong><span>Undo.</span></li>
                    <li><strong>Hold at the end of a stroke</strong><span>Straightens it.</span></li>
                  </ul>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function TextOptions({ style, onChange }: { style: TextStyle; onChange: (style: TextStyle) => void }) {
  const FONT_LABELS: Record<TextFont, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', hand: 'Hand' };
  return (
    <>
      <select className="nt-select is-small" aria-label="Font" value={style.font} onChange={(e) => onChange({ ...style, font: e.target.value as TextFont })}>
        {TEXT_FONTS.map((font) => <option key={font} value={font}>{FONT_LABELS[font]}</option>)}
      </select>
      <select className="nt-select is-small" aria-label="Size" value={style.size} onChange={(e) => onChange({ ...style, size: Number(e.target.value) })}>
        {[...new Set([...TEXT_SIZES, style.size])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{Math.round(size)}</option>)}
      </select>
      <button type="button" className={`nt-icon-btn is-small${style.bold ? ' is-on' : ''}`} aria-label="Bold" aria-pressed={style.bold} onClick={() => onChange({ ...style, bold: !style.bold })}><b>B</b></button>
      <button type="button" className={`nt-icon-btn is-small${style.italic ? ' is-on' : ''}`} aria-label="Italic" aria-pressed={style.italic} onClick={() => onChange({ ...style, italic: !style.italic })}><i>I</i></button>
      <div className="nt-tabs is-small">
        {([['left', 'Left'], ['center', 'Middle'], ['right', 'Right']] as const).map(([align, label]) => (
          <button key={align} type="button" className={style.align === align ? 'is-on' : ''} aria-pressed={style.align === align} onClick={() => onChange({ ...style, align })}>{label}</button>
        ))}
      </div>
      <span className="nt-bar-gap" />
      <Swatches colors={PEN_COLORS} value={style.color} onPick={(color) => onChange({ ...style, color })} />
    </>
  );
}

/** Whether the server can read handwriting, and what to know about it. */
/**
 * How the pencil and the screen did on the last few strokes, measured on this device. A browser
 * can't be timed from outside, so this is how a slow pencil on a real iPad can be looked into.
 */
function PencilCheck({ engine }: { engine: NoteCanvas | null }) {
  const [copied, setCopied] = useState(false);
  const strokes = engine?.pencilCheck() ?? [];
  if (!strokes.length) {
    return (
      <>
        <div className="nt-label">Pencil check</div>
        <p className="nt-hint">Write a few lines, then come back here to see how quickly the pencil and the screen kept up.</p>
      </>
    );
  }
  const timed = strokes.filter((s) => s.ms > 80);
  const rate = (count: (s: typeof strokes[number]) => number) => {
    const rates = timed.map((s) => (count(s) * 1000) / s.ms).sort((a, b) => a - b);
    return rates.length ? Math.round(rates[Math.floor(rates.length / 2)]) : 0;
  };
  const rows: [string, string][] = [
    ['Pencil points a second', String(rate((s) => s.points))],
    ['Updates a second', String(rate((s) => s.events))],
    ['Extra points between updates', strokes.some((s) => s.coalesced) ? 'yes' : 'no'],
    ['Screen redraws a second', String(rate((s) => s.paints))],
    ['Longest wait for the pencil', `${Math.max(...strokes.map((s) => s.slowestGap))} ms`],
    ['Longest frame while writing', `${Math.max(...strokes.map((s) => s.slowestFrame))} ms`],
    ['Saving a finished stroke', `${Math.max(...strokes.map((s) => s.commitMs))} ms`],
  ];
  const report = [`Pencil check (${strokes.length} strokes, ${navigator.userAgent})`, ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n');
  return (
    <>
      <div className="nt-label">Pencil check</div>
      <dl className="nt-pencil-check">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="nt-hint">From your last {strokes.length} strokes. A smooth screen redraws about 60 times a second, and a frame over 30 ms is a stutter you can see.</p>
      <button type="button" className="nt-btn is-small nt-gap" onClick={() => { void navigator.clipboard?.writeText(report).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy these numbers'}</button>
    </>
  );
}

function ReadingStatus() {
  const [status, setStatus] = useState<{ state: string; problem: string } | null>(null);
  useEffect(() => {
    void fetch('/api/notes/read').then((res) => res.json()).then((body) => { if (body.success) setStatus(body); }).catch(() => {});
  }, []);
  const words: Record<string, string> = {
    ready: 'Ready. Pages are read about a minute after you stop writing on them.',
    idle: 'Ready. Pages are read about a minute after you stop writing on them.',
    downloading: 'Getting the handwriting model onto the server (63 MB, once).',
    unavailable: `Not available right now${status?.problem ? `: ${status.problem}` : '.'} It tries again in a few minutes.`,
  };
  return (
    <>
      <div className="nt-label">Reading handwriting</div>
      <p className="nt-hint">{status ? words[status.state] ?? words.idle : 'Needs a connection to check.'} Search finds what it reads, near misses included. It reads neat writing best.</p>
    </>
  );
}

const WHERE: Record<SearchHit['where'], string> = { title: '', page: ' · page title', text: '', pdf: ' · in the PDF', ink: ' · handwriting', mark: ' · link, heading or keyword', tag: ' · tag' };

function SearchPanel({ notebook, title, onGo, onClose }: { notebook: string; title: string; onGo: (page: string, box?: SearchHit['box']) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    if (!query.trim()) { setHits(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      void searchNotebook(notebook, title, query).then((found) => { if (live) setHits(found); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, notebook, title]);
  return (
    <>
      <div className="nt-sheet-head"><strong>Search this notebook</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="nt-sheet-body">
        <input className="nt-input" type="search" autoFocus placeholder="Page titles, typed text, PDFs" aria-label="Search this notebook" value={query} onChange={(e) => setQuery(e.target.value)} />
        {hits && !hits.length && <p className="nt-empty">Nothing found. Handwriting can’t be searched, but page titles can, and you can give a page one in the Pages panel.</p>}
        {hits?.map((hit, i) => (
          <button type="button" key={`${hit.page}/${i}`} className="nt-result" onClick={() => hit.page && onGo(hit.page, hit.box)}>
            <small>Page {hit.pageNumber}{WHERE[hit.where]}</small>
            <span>{hit.snippet}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function AddPagePanel({ current, onAdd, onPdf, onClose }: { current: PageRecord | undefined; onAdd: (like: Partial<Pick<PageRecord, 'template' | 'paper' | 'w' | 'h'>>) => void; onPdf: () => void; onClose: () => void }) {
  const [paper, setPaper] = useState(current?.pdf ? '#ffffff' : current?.paper ?? '#ffffff');
  const w = current?.w ?? 612;
  const h = current?.h ?? 792;
  return (
    <>
      <div className="nt-sheet-head"><strong>Add a page</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="nt-sheet-body">
        <p className="nt-hint">It goes after the page you’re on.</p>
        <div className="nt-row is-wrap">
          <button type="button" className="nt-btn is-primary" onClick={() => onAdd({})}><Icon name="plus" /> Same as this one</button>
          <button type="button" className="nt-btn" onClick={() => { onClose(); onPdf(); }}><Icon name="file" /> From a PDF</button>
        </div>
        <div className="nt-label">Paper colour</div>
        <PaperSwatches value={paper} onPick={setPaper} />
        <div className="nt-label">Or pick the paper</div>
        <TemplateGrid value={null} paper={paper} w={w} h={h} onPick={(template) => onAdd({ template, paper })} />
      </div>
    </>
  );
}

function ExportPanel({ doc, notebook, title, current, onClose }: { doc: NotebookDoc; notebook: string; title: string; current: PageRecord | undefined; onClose: () => void }) {
  const [range, setRange] = useState<'all' | 'this' | 'marked' | 'custom'>('all');
  const [custom, setCustom] = useState('');
  const [templates, setTemplates] = useState(true);
  const [state, setState] = useState<{ busy?: string; error?: string; ready?: { blob: Blob; name: string } }>({});
  const bookmarks = doc.pages.filter((page) => page.starred).length;

  const chosen = () => {
    if (range === 'this') return current ? [current] : [];
    if (range === 'marked') return doc.pages.filter((page) => page.starred);
    if (range === 'custom') return parsePageRange(custom, doc.pages.length).map((n) => doc.pages[n - 1]);
    return doc.pages;
  };

  const run = async (kind: 'pdf' | 'png') => {
    const pages = chosen();
    if (!pages.length) {
      setState({ error: 'Which pages? Try something like 1-3, 7.' });
      return;
    }
    await doc.settled();
    try {
      if (kind === 'png') {
        setState({ busy: 'Making a picture…' });
        const blob = await exportPng(notebook, pages[0]);
        setState({ ready: { blob, name: `${safeFileName(title)} page ${doc.pages.indexOf(pages[0]) + 1}.png` } });
      } else {
        setState({ busy: `Making a PDF: 0 of ${pages.length}` });
        const blob = await exportPdf(notebook, title, pages, { templates }, (done) => setState({ busy: `Making a PDF: ${done} of ${pages.length}` }));
        setState({ ready: { blob, name: `${safeFileName(title)}.pdf` } });
      }
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'That didn’t work.' });
    }
  };

  return (
    <>
      <div className="nt-sheet-head"><strong>Export and share</strong><span className="nt-grow" /><button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
      <div className="nt-sheet-body">
        <div className="nt-label">Which pages</div>
        <div className="nt-tabs is-wide">
          <button type="button" className={range === 'all' ? 'is-on' : ''} onClick={() => setRange('all')}>All {doc.pages.length}</button>
          <button type="button" className={range === 'this' ? 'is-on' : ''} onClick={() => setRange('this')}>This one</button>
          <button type="button" className={range === 'marked' ? 'is-on' : ''} disabled={!bookmarks} onClick={() => setRange('marked')}>Bookmarked</button>
          <button type="button" className={range === 'custom' ? 'is-on' : ''} onClick={() => setRange('custom')}>Choose</button>
        </div>
        {range === 'custom' && <input className="nt-input nt-gap" placeholder="1-3, 7" aria-label="Page numbers" value={custom} onChange={(e) => setCustom(e.target.value)} />}
        <label className="nt-check">
          <input type="checkbox" checked={templates} onChange={(e) => setTemplates(e.target.checked)} />
          <span><strong>Include the paper’s lines</strong>Leave this off for just your writing on a plain page.</span>
        </label>
        <div className="nt-row is-wrap nt-gap">
          <button type="button" className="nt-btn is-primary" disabled={!!state.busy} onClick={() => void run('pdf')}>Make a PDF</button>
          <button type="button" className="nt-btn" disabled={!!state.busy} onClick={() => void run('png')}>First page as a picture</button>
        </div>
        {state.busy && <p className="nt-hint">{state.busy}</p>}
        {state.error && <p className="nt-hint is-error">{state.error}</p>}
        {state.ready && (
          <div className="nt-banner nt-gap">
            <p>{state.ready.name} is ready.</p>
            {/* A separate tap, because an iPad only opens the share sheet straight from one. */}
            <button type="button" className="nt-btn is-primary" onClick={() => void shareOrSave(state.ready!.blob, state.ready!.name)}><Icon name="share" /> Share or save</button>
          </div>
        )}
      </div>
    </>
  );
}

