'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import Chart, { fmt, type Series } from '@/components/loop-lab/Chart';
import { Tex } from '@/components/daily/MathText';
import {
  BLOCK_CATALOG,
  BLOCK_TEMPLATES,
  getNodeInputPorts,
  getNodeOutputPorts,
  simulateBlockDiagram,
  benchExport,
  cleanDiagram,
  clampParam,
  decodeDiagram,
  encodeDiagram,
  type BlockCategory,
  type BlockDiagramModel,
  type BlockKind,
  type BlockNode,
  type BlockSimResult,
  type BlockWire,
  type ParamSpec,
} from '@/lib/loop-lab/block-sim';

const BLOCK_WIDTH = 152;
const BLOCK_HEIGHT = 92;
/** Changes closer together than this are one undo step (a drag, a slider being moved). */
const UNDO_RUN_MS = 600;
/** The diagram is kept in this browser between visits. */
const STORAGE_KEY = 'loop-lab:block-studio';
/** Diagrams kept under a name, in this browser. */
const SAVED_KEY = 'loop-lab:block-studio:saved';
const SAVED_MAX = 30;
type SavedDiagram = { id: string; name: string; savedAt: number; model: BlockDiagramModel };

function readSaved(): SavedDiagram[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((e: unknown) => {
      const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const model = cleanDiagram(o.model);
      if (!model || typeof o.id !== 'string' || typeof o.name !== 'string') return [];
      return [{ id: o.id, name: o.name.slice(0, 80), savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0, model }];
    });
  } catch {
    return [];
  }
}

const CATEGORY_COLORS: Record<BlockCategory, { border: string; bg: string; badge: string; text: string; lightBg: string }> = {
  sources: { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.12)', badge: '#0891b2', text: 'var(--ll-cat-sources)', lightBg: 'rgba(6, 182, 212, 0.06)' },
  controllers: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)', badge: '#7c3aed', text: 'var(--ll-cat-controllers)', lightBg: 'rgba(139, 92, 246, 0.06)' },
  dynamics: { border: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', badge: '#059669', text: 'var(--ll-cat-dynamics)', lightBg: 'rgba(16, 185, 129, 0.06)' },
  math: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', badge: '#d97706', text: 'var(--ll-cat-math)', lightBg: 'rgba(245, 158, 11, 0.06)' },
  sinks: { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', badge: '#2563eb', text: 'var(--ll-cat-sinks)', lightBg: 'rgba(59, 130, 246, 0.06)' },
};

function getPortCoords(node: BlockNode, type: 'in' | 'out', portIndex: number) {
  if (type === 'out') {
    return { x: node.x + BLOCK_WIDTH, y: node.y + BLOCK_HEIGHT / 2 };
  } else {
    const inputs = getNodeInputPorts(node);
    const count = Math.max(1, inputs.length);
    const y = node.y + ((portIndex + 1) / (count + 1)) * BLOCK_HEIGHT;
    return { x: node.x, y };
  }
}

function roundedOrthogonalPath(pts: { x: number; y: number }[], radius = 14): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2);
    if (len1 < 2 || len2 < 2) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }
    const r = Math.min(radius, len1 * 0.45, len2 * 0.45);
    const p1x = curr.x - (dx1 / len1) * r;
    const p1y = curr.y - (dy1 / len1) * r;
    const p2x = curr.x + (dx2 / len2) * r;
    const p2y = curr.y + (dy2 / len2) * r;
    d += ` L ${p1x.toFixed(1)} ${p1y.toFixed(1)} Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function computeWirePath(x1: number, y1: number, x2: number, y2: number) {
  if (x2 > x1 + 20) {
    const dx = Math.max(32, (x2 - x1) * 0.46);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  } else {
    const loopY = Math.max(y1, y2, 220) + 125;
    return roundedOrthogonalPath([
      { x: x1, y: y1 },
      { x: x1 + 26, y: y1 },
      { x: x1 + 26, y: loopY },
      { x: x2 - 26, y: loopY },
      { x: x2 - 26, y: y2 },
      { x: x2, y: y2 },
    ]);
  }
}

function computeSmartWireGeometry(
  wire: BlockWire,
  fromNode: BlockNode,
  toNode: BlockNode,
  start: { x: number; y: number },
  end: { x: number; y: number },
  allNodes: BlockNode[],
  allWires: BlockWire[]
): { path: string; labelX: number; labelY: number; branchPoint?: { x: number; y: number } } {
  const x1 = start.x;
  const y1 = start.y;
  const x2 = end.x;
  const y2 = end.y;

  const fanoutWires = allWires.filter((w) => w.fromBlock === wire.fromBlock && w.fromPort === wire.fromPort);
  const hasMultipleOut = fanoutWires.length > 1;
  const tapX = x1 + 22;

  // 1. Backward / Feedback wire (destination is left of or aligned with source output)
  if (x2 <= x1 + 24) {
    const feedbackWires = allWires
      .map((w) => {
        const fn = allNodes.find((n) => n.id === w.fromBlock);
        const tn = allNodes.find((n) => n.id === w.toBlock);
        if (!fn || !tn) return null;
        const s = getPortCoords(fn, 'out', w.fromPort);
        const e = getPortCoords(tn, 'in', w.toPort);
        if (e.x > s.x + 24) return null;
        return { id: w.id, span: s.x - e.x };
      })
      .filter((item): item is { id: string; span: number } => item !== null)
      .sort((a, b) => a.span - b.span);

    const fbRank = Math.max(0, feedbackWires.findIndex((f) => f.id === wire.id));
    const minX = Math.min(x1, x2) - 20;
    const maxX = Math.max(x1, x2) + 20;
    let maxBottom = Math.max(y1, y2);
    for (const n of allNodes) {
      if (n.x + BLOCK_WIDTH >= minX && n.x <= maxX) {
        if (n.y + BLOCK_HEIGHT > maxBottom) maxBottom = n.y + BLOCK_HEIGHT;
      }
    }

    const loopY = maxBottom + 48 + fbRank * 40;
    const xRight = tapX + fbRank * 8;
    const xLeft = x2 - 26 - fbRank * 8;
    const path = roundedOrthogonalPath([
      { x: x1, y: y1 },
      { x: xRight, y: y1 },
      { x: xRight, y: loopY },
      { x: xLeft, y: loopY },
      { x: xLeft, y: y2 },
      { x: x2, y: y2 },
    ]);
    return {
      path,
      labelX: (xRight + xLeft) / 2,
      labelY: loopY - 7,
      branchPoint: hasMultipleOut ? { x: tapX, y: y1 } : undefined,
    };
  }

  // 2. Check if any intermediate block actually obstructs the direct line-of-sight corridor
  const intermediateBlocks = allNodes.filter((n) => {
    if (n.id === fromNode.id || n.id === toNode.id) return false;
    const inHorizSpan = n.x + BLOCK_WIDTH > x1 + 12 && n.x < x2 - 12;
    if (!inHorizSpan) return false;
    const cx = n.x + BLOCK_WIDTH / 2;
    const t = Math.max(0, Math.min(1, (cx - x1) / Math.max(1, x2 - x1)));
    const wireYAtBlock = y1 + t * (y2 - y1);
    return wireYAtBlock >= n.y - 16 && wireYAtBlock <= n.y + BLOCK_HEIGHT + 16;
  });

  if (intermediateBlocks.length > 0) {
    // Route cleanly around intermediate blocks via top signal bus or lower tap lane
    const routeTop = wire.toPort === 0 && fromNode.y <= toNode.y + 45;
    if (routeTop) {
      let minTop = Math.min(y1, y2, fromNode.y, toNode.y);
      for (const n of intermediateBlocks) {
        if (n.y < minTop) minTop = n.y;
      }
      const busY = Math.max(20, minTop - 42);
      const xDown = x2 - 28;
      const path = roundedOrthogonalPath([
        { x: x1, y: y1 },
        { x: tapX, y: y1 },
        { x: tapX, y: busY },
        { x: xDown, y: busY },
        { x: xDown, y: y2 },
        { x: x2, y: y2 },
      ]);
      return {
        path,
        labelX: (tapX + xDown) / 2,
        labelY: busY - 7,
        branchPoint: hasMultipleOut ? { x: tapX, y: y1 } : undefined,
      };
    } else {
      let maxBot = Math.max(y1, y2, fromNode.y + BLOCK_HEIGHT, toNode.y + BLOCK_HEIGHT);
      for (const n of intermediateBlocks) {
        if (n.y + BLOCK_HEIGHT > maxBot) maxBot = n.y + BLOCK_HEIGHT;
      }
      const busY = maxBot + 28 + Math.max(0, wire.toPort - 1) * 18;
      const xUp = x2 - 20;
      const path = roundedOrthogonalPath([
        { x: x1, y: y1 },
        { x: tapX, y: y1 },
        { x: tapX, y: busY },
        { x: xUp, y: busY },
        { x: xUp, y: y2 },
        { x: x2, y: y2 },
      ]);
      return {
        path,
        labelX: (tapX + xUp) / 2,
        labelY: busY - 7,
        branchPoint: hasMultipleOut ? { x: tapX, y: y1 } : undefined,
      };
    }
  }

  // 3. Unobstructed direct forward connection
  const dx = Math.max(32, (x2 - x1) * 0.46);
  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return {
    path,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2 - 9,
  };
}

function getBlockMathNotation(node: BlockNode): string {
  switch (node.kind) {
    case 'step':
      return 'y(t) = Step';
    case 'ramp':
      return 'r(t) = a·t';
    case 'sine':
      return 'A·sin(ωt)';
    case 'pulse':
      return 'Pulse(T, duty)';
    case 'noise':
      return 'w(t) ~ N(0, σ²)';
    case 'constant':
      return `C = ${node.params.value ?? 50}`;
    case 'pid': {
      const Ti = node.params.Ti ?? 12;
      const Td = node.params.Td ?? 0;
      if (Ti > 0 && Td > 0) return 'Kc(1 + 1/Ti·s + Td·s)';
      if (Ti > 0) return 'Kc(1 + 1/Ti·s)';
      return 'Kc·e(t)';
    }
    case 'leadlag':
      return 'K·(T₁s+1)/(T₂s+1)';
    case 'gain':
      return `y = ${node.params.K ?? 1.5}·u`;
    case 'integrator':
      return '1/s';
    case 'derivative':
      return 's/(τf·s + 1)';
    case 'fopdt':
      return 'K·e^{-θs}/(τs+1)';
    case 'sopdt':
      return 'K/[(τ₁s+1)(τ₂s+1)]';
    case 'deadtime':
      return 'e^{-θs}';
    case 'valve':
      return node.params.char === 1 ? 'Equal-% Valve' : 'Linear Valve';
    case 'nonlin_tank':
      return 'dh/dt = (u - Cv√h)/A';
    case 'sum':
      return `Σ (${node.signs || '+-'})`;
    case 'product':
      return 'u₁ × u₂';
    case 'saturation':
      return `[${node.params.lo ?? 0}, ${node.params.hi ?? 100}]`;
    case 'selector':
      return node.params.mode === 1 ? 'MAX(u₁, u₂)' : 'MIN(u₁, u₂)';
    case 'scope':
      return 'Scope [SP, PV, OP]';
    case 'xy':
      return 'Phase Trajectory';
    default:
      return '';
  }
}

function getBlockParamPills(node: BlockNode): string[] {
  const p = node.params;
  switch (node.kind) {
    case 'fopdt':
      return [`K=${p.K ?? 1.2}`, `τ=${p.tau ?? 15}s`, `θ=${p.theta ?? 3}s`];
    case 'sopdt':
      return [`K=${p.K ?? 1}`, `τ₁=${p.tau1 ?? 12}s`, `τ₂=${p.tau2 ?? 5}s`];
    case 'pid':
      return [`Kc=${p.Kc ?? 2}`, `Ti=${p.Ti ?? 12}s`, ...(p.Td ? [`Td=${p.Td}s`] : [])];
    case 'deadtime':
      return [`θ=${p.theta ?? 5}s`];
    case 'gain':
      return [`K=${p.K ?? 1.5}`];
    case 'leadlag':
      return [`K=${p.K ?? 1}`, `Tlead=${p.Tlead ?? 8}s`, `Tlag=${p.Tlag ?? 15}s`];
    case 'integrator':
      return [`K=${p.K ?? 0.2}`];
    case 'valve':
      return [`τ=${p.tau ?? 0.8}s`, `rate=${p.rateLimit ?? 50}%/s`];
    case 'step':
      return [`t=${p.tStep ?? 2}s`, `Δ=${((p.y1 ?? 10) - (p.y0 ?? 0)).toFixed(1)}`];
    case 'ramp':
      return [`slope=${p.slope ?? 1}/s`];
    case 'sine':
      return [`amp=${p.amp ?? 5}`, `ω=${p.freq ?? 0.5}`];
    case 'saturation':
      return [`[${p.lo ?? 0}, ${p.hi ?? 100}]`];
    case 'nonlin_tank':
      return [`A=${p.A ?? 2.5}`, `Cv=${p.Cv ?? 1.2}`];
    default:
      return [];
  }
}

function Sparkline({ data, color }: { data: number[] | undefined; color: string }) {
  if (!data || data.length < 2) return null;
  const w = 124;
  const h = 20;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-5) {
    min -= 1;
    max += 1;
  }
  const points: string[] = [];
  const step = Math.max(1, Math.floor(data.length / w));
  for (let i = 0; i < data.length; i += step) {
    const px = (i / (data.length - 1)) * w;
    const py = h - ((data[i] - min) / (max - min)) * (h - 4) - 2;
    points.push(`${points.length === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
      <path d={points.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/** A parameter typed in: taken as soon as it is a number within the slider's range, held to the range when left. */
function ParamNumber({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={spec.min}
      max={spec.max}
      step={spec.step}
      value={text}
      aria-label={spec.label}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= spec.min && n <= spec.max) {
          setShown(n);
          onChange(n);
        }
      }}
      onBlur={() => {
        const n = Number(text);
        const v = text.trim() === '' || !Number.isFinite(n) ? value : Math.min(spec.max, Math.max(spec.min, n));
        setText(String(v));
        setShown(v);
        if (v !== value) onChange(v);
      }}
      style={{ fontSize: '0.8rem', padding: '0.15rem 0.4rem', minHeight: '26px' }}
    />
  );
}

export default function BlockBuilder() {
  const [model, setModelNow] = useState<BlockDiagramModel>(() => JSON.parse(JSON.stringify(BLOCK_TEMPLATES[0])));
  // The handlers read the diagram and its history from refs, so a run of changes in one event chains.
  const modelRef = useRef(model);
  const hist = useRef<{ past: BlockDiagramModel[]; future: BlockDiagramModel[] }>({ past: [], future: [] });
  const [histSize, setHistSize] = useState({ past: 0, future: 0 });
  const lastEdit = useRef(0);
  /** Change the diagram. Changes in quick succession are one undo step; `step` makes this one its own. */
  const setModel = useCallback((next: BlockDiagramModel | ((prev: BlockDiagramModel) => BlockDiagramModel), opts?: { step?: boolean }) => {
    const cur = modelRef.current;
    const resolved = typeof next === 'function' ? next(cur) : next;
    if (resolved === cur) return;
    const now = performance.now();
    if (opts?.step || now - lastEdit.current > UNDO_RUN_MS) hist.current.past = [...hist.current.past.slice(-49), cur];
    hist.current.future = [];
    lastEdit.current = opts?.step ? 0 : now;
    modelRef.current = resolved;
    setModelNow(resolved);
    setHistSize({ past: hist.current.past.length, future: 0 });
  }, []);
  const undo = useCallback(() => {
    const h = hist.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [modelRef.current, ...h.future].slice(0, 50);
    lastEdit.current = 0;
    modelRef.current = prev;
    setModelNow(prev);
    setConnectingFrom(null);
    setHistSize({ past: h.past.length, future: h.future.length });
  }, []);
  const redo = useCallback(() => {
    const h = hist.current;
    if (!h.future.length) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past.slice(-49), modelRef.current];
    lastEdit.current = 0;
    modelRef.current = next;
    setModelNow(next);
    setConnectingFrom(null);
    setHistSize({ past: h.past.length, future: h.future.length });
  }, []);
  // Nothing selected to begin with: Delete only ever removes a block that was picked.
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [pinnedResult, setPinnedResult] = useState<BlockSimResult | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<{ blockId: string; portIndex: number; x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [draggingBlock, setDraggingBlock] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [activeCategory, setActiveCategory] = useState<BlockCategory | 'all'>('all');
  const [zoom, setZoom] = useState<number>(1);

  const canvasRef = useRef<HTMLDivElement>(null);

  // The diagram as it was left in this browser, and kept as it changes. (Storage can be refused:
  // then it just isn't kept.)
  const [restored, setRestored] = useState(false);
  const [savedList, setSavedList] = useState<SavedDiagram[]>([]);
  const [notice, setNotice] = useState('');
  const writeSaved = useCallback((list: SavedDiagram[]) => {
    setSavedList(list);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      setNotice('This browser wouldn’t keep the saved diagrams (storage full or not allowed).');
    }
  }, []);
  useEffect(() => {
    let left: BlockDiagramModel | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      left = raw ? cleanDiagram(JSON.parse(raw)) : null;
    } catch {
      // Unreadable or not allowed: start from the template.
    }
    const list = readSaved();
    setSavedList(list);
    const code = new URLSearchParams(window.location.search).get('d');
    const shared = code ? decodeDiagram(code) : null;
    if (code) {
      // The link has done its job: a reload shows the diagram as it is by then.
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    if (shared) {
      // What was being worked on here isn't lost to the link: it goes in the saved list first.
      if (left && JSON.stringify(left) !== JSON.stringify(shared) && JSON.stringify(left) !== JSON.stringify(BLOCK_TEMPLATES[0])) {
        const keep: SavedDiagram = { id: `s_${Date.now().toString(36)}`, name: `Before the shared link (${new Date().toLocaleString()})`, savedAt: Date.now(), model: left };
        writeSaved([keep, ...list].slice(0, SAVED_MAX));
        setNotice('Opened the diagram from the link. What you had here is in Saved diagrams, as “Before the shared link”.');
      } else setNotice('Opened the diagram from the link.');
      modelRef.current = shared;
      setModelNow(shared);
    } else {
      if (code) setNotice('That link doesn’t hold a diagram this page can read.');
      if (left) {
        modelRef.current = left;
        setModelNow(left);
      }
    }
    setRestored(true);
  }, [writeSaved]);

  // Sharing: a link that opens this diagram as it is now.
  const [shareUrl, setShareUrl] = useState('');
  const share = async () => {
    const url = `${window.location.origin}/loop-lab/builder?d=${encodeDiagram(modelRef.current)}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareUrl('');
      setNotice('Link copied. It opens this diagram as it is now; later changes aren’t in it.');
    } catch {
      // No clipboard here: show it to copy by hand.
      setShareUrl(url);
    }
  };

  // Saved diagrams.
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveCurrent = () => {
    const name = saveName.trim() || model.name;
    const existing = savedList.find((e) => e.name === name);
    const entry: SavedDiagram = { id: existing?.id ?? `s_${Date.now().toString(36)}`, name, savedAt: Date.now(), model: { ...modelRef.current, name } };
    const rest = savedList.filter((e) => e.id !== entry.id);
    const list = [entry, ...rest];
    writeSaved(list.slice(0, SAVED_MAX));
    setSaveName('');
    setNotice(existing ? `Saved over “${name}”.` : list.length > SAVED_MAX ? `Saved “${name}”; the oldest saved diagram made room for it (${SAVED_MAX} at most).` : `Saved “${name}”.`);
  };
  const openSaved = (e: SavedDiagram) => {
    setModel(JSON.parse(JSON.stringify(e.model)), { step: true });
    setSelectedBlockId(null);
    setSelectedWireId(null);
    setNotice(`Opened “${e.name}”. Undo goes back to what was here.`);
  };
  const deleteSaved = (e: SavedDiagram) => {
    if (!window.confirm(`Delete the saved diagram “${e.name}”? This can’t be undone.`)) return;
    writeSaved(savedList.filter((x) => x.id !== e.id));
  };
  useEffect(() => {
    if (!restored) return;
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
      } catch {
        // Full or not allowed.
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [model, restored]);

  // Synchronous, rock-solid simulation execution on every model state update
  const simResult = useMemo(() => simulateBlockDiagram(model), [model]);

  // Selected entities
  const selectedNode = useMemo(() => model.nodes.find((n) => n.id === selectedBlockId) || null, [model.nodes, selectedBlockId]);
  const selectedWire = useMemo(() => model.wires.find((w) => w.id === selectedWireId) || null, [model.wires, selectedWireId]);

  // Keys: Esc cancels a wire, Delete removes what is selected, Ctrl+Z / Ctrl+Y undo and redo.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField = !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
      const typing = inField && !(el instanceof HTMLInputElement && ['range', 'checkbox', 'radio', 'button'].includes(el.type));
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Escape') {
        setConnectingFrom(null);
        setSelectedWireId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && !mod) {
        if (selectedWireId) {
          e.preventDefault();
          setModel((prev) => ({ ...prev, wires: prev.wires.filter((w) => w.id !== selectedWireId) }), { step: true });
          setSelectedWireId(null);
        } else if (selectedBlockId) {
          e.preventDefault();
          setModel((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== selectedBlockId),
            wires: prev.wires.filter((w) => w.fromBlock !== selectedBlockId && w.toBlock !== selectedBlockId),
          }), { step: true });
          setSelectedBlockId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWireId, selectedBlockId, setModel, undo, redo]);

  // Mouse move on canvas for rubber-band connecting line & block dragging
  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left + canvasRef.current.scrollLeft) / zoom;
      const y = (e.clientY - rect.top + canvasRef.current.scrollTop) / zoom;
      setMousePos({ x, y });

      if (draggingBlock && e.pointerType === 'mouse' && e.buttons === 0) {
        setDraggingBlock(null);
        return;
      }
      if (draggingBlock) {
        const dx = (e.clientX - draggingBlock.startX) / zoom;
        const dy = (e.clientY - draggingBlock.startY) / zoom;
        const newX = Math.max(10, Math.round((draggingBlock.origX + dx) / 10) * 10);
        const newY = Math.max(10, Math.round((draggingBlock.origY + dy) / 10) * 10);
        setModel((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === draggingBlock.id ? { ...n, x: newX, y: newY } : n)),
        }));
      }
    },
    [draggingBlock, zoom]
  );

  const handleCanvasPointerUp = useCallback(() => {
    if (draggingBlock) setDraggingBlock(null);
  }, [draggingBlock]);

  // Template switch
  const loadTemplate = (tmpl: BlockDiagramModel) => {
    setModel(JSON.parse(JSON.stringify(tmpl)), { step: true });
    setSelectedBlockId(tmpl.nodes[0]?.id || null);
    setSelectedWireId(null);
    setConnectingFrom(null);
    if (canvasRef.current) {
      const availW = canvasRef.current.clientWidth || 1340;
      const reqW = Math.max(...tmpl.nodes.map((n) => n.x + BLOCK_WIDTH)) + 45;
      const fitZoom = reqW > availW ? Math.max(0.75, Math.floor((availW / reqW) * 20) / 20) : 1.0;
      setZoom(fitZoom);
    }
  };

  // Add block from library
  const addBlock = (kind: BlockKind) => {
    const entry = BLOCK_CATALOG[kind];
    if (!entry) return;
    let id = `${kind}_${Date.now().toString(36).slice(-4)}`;
    while (model.nodes.some((n) => n.id === id)) id += 'x';
    const defaultParams: Record<string, number> = {};
    for (const spec of entry.paramSpecs) {
      defaultParams[spec.key] = spec.default;
    }

    // The first spot, row by row, with a clear margin round every block already there.
    const gap = 24;
    const free = (bx: number, by: number) => model.nodes.every((n) =>
      bx + BLOCK_WIDTH + gap <= n.x || n.x + BLOCK_WIDTH + gap <= bx || by + BLOCK_HEIGHT + gap <= n.y || n.y + BLOCK_HEIGHT + gap <= by);
    let x = 40;
    let y = 40;
    search: for (let row = 0; row < 200; row++) {
      for (let col = 0; col < 6; col++) {
        x = 40 + col * (BLOCK_WIDTH + 2 * gap);
        y = 40 + row * (BLOCK_HEIGHT + 2 * gap);
        if (free(x, y)) break search;
      }
    }

    const newNode: BlockNode = {
      id,
      kind,
      label: entry.name,
      x,
      y,
      params: defaultParams,
      signs: kind === 'sum' ? '+-' : undefined,
    };

    setModel((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    setSelectedBlockId(id);
    setSelectedWireId(null);
  };

  // Duplicate block
  const duplicateSelectedBlock = () => {
    if (!selectedNode) return;
    let newId = `${selectedNode.kind}_${Date.now().toString(36).slice(-4)}`;
    while (model.nodes.some((n) => n.id === newId)) newId += 'x';
    const clone: BlockNode = {
      ...JSON.parse(JSON.stringify(selectedNode)),
      id: newId,
      label: `${selectedNode.label} (Copy)`,
      x: selectedNode.x + 30,
      y: selectedNode.y + 30,
    };
    setModel((prev) => ({
      ...prev,
      nodes: [...prev.nodes, clone],
    }));
    setSelectedBlockId(newId);
  };

  // Delete selected block
  const deleteSelectedBlock = () => {
    if (!selectedBlockId) return;
    setModel((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== selectedBlockId),
      wires: prev.wires.filter((w) => w.fromBlock !== selectedBlockId && w.toBlock !== selectedBlockId),
    }));
    setSelectedBlockId(null);
  };

  // Auto-Layout
  const handleAutoLayout = () => {
    const tmpl = BLOCK_TEMPLATES.find((t) => t.id === model.id);
    if (tmpl && tmpl.nodes.length === model.nodes.length && tmpl.nodes.every((tn) => model.nodes.some((n) => n.id === tn.id))) {
      setModel((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const match = tmpl.nodes.find((tn) => tn.id === n.id);
          return match ? { ...n, x: match.x, y: match.y } : n;
        }),
      }));
      return;
    }

    // Topological longest-path layered layout (Sugiyama-style)
    const layerOf = new Map<string, number>();
    for (const n of model.nodes) {
      const cat = BLOCK_CATALOG[n.kind]?.category;
      layerOf.set(n.id, cat === 'sources' ? 0 : 1);
    }

    // Ignore backward/feedback wires (toPort >= 1 on sum when cyclic) during forward rank propagation
    const forwardWires = model.wires.filter((w) => {
      const lbl = (w.label || '').toLowerCase();
      if (lbl.includes('fb') || lbl.includes('feedback')) return false;
      return true;
    });

    for (let iter = 0; iter < model.nodes.length; iter++) {
      for (const w of forwardWires) {
        const toNode = model.nodes.find((n) => n.id === w.toBlock);
        // Avoid pushing sum blocks forward via their feedback port
        if (toNode?.kind === 'sum' && w.toPort === 1 && iter > 1) continue;
        const u = layerOf.get(w.fromBlock) ?? 0;
        const v = layerOf.get(w.toBlock) ?? 0;
        if (v < u + 1) {
          layerOf.set(w.toBlock, u + 1);
        }
      }
    }

    // Ensure sinks sit in the rightmost column
    let maxLayer = 0;
    for (const n of model.nodes) {
      const cat = BLOCK_CATALOG[n.kind]?.category;
      if (cat !== 'sinks') {
        maxLayer = Math.max(maxLayer, layerOf.get(n.id) ?? 0);
      }
    }
    for (const n of model.nodes) {
      if (BLOCK_CATALOG[n.kind]?.category === 'sinks') {
        layerOf.set(n.id, maxLayer + 1);
      }
    }

    const columns = new Map<number, BlockNode[]>();
    for (const n of model.nodes) {
      const col = layerOf.get(n.id) ?? 0;
      const list = columns.get(col) || [];
      list.push(n);
      columns.set(col, list);
    }

    const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
    const updatedNodes: BlockNode[] = [];
    sortedCols.forEach((colKey, colIdx) => {
      const list = columns.get(colKey) || [];
      const x = 30 + colIdx * 240;
      list.forEach((node, rowIdx) => {
        const y = list.length === 1 ? 140 : 60 + rowIdx * 150;
        updatedNodes.push({ ...node, x, y });
      });
    });

    setModel((prev) => ({ ...prev, nodes: updatedNodes }));
  };

  // Port click: handle wiring
  const handlePortClick = (e: React.MouseEvent, node: BlockNode, type: 'in' | 'out', portIndex: number) => {
    e.stopPropagation();
    if (type === 'out') {
      const coords = getPortCoords(node, 'out', portIndex);
      setConnectingFrom({ blockId: node.id, portIndex, x: coords.x, y: coords.y });
    } else {
      // In port clicked
      if (connectingFrom) {
        if (connectingFrom.blockId === node.id) {
          // Prevent direct self loops
          setConnectingFrom(null);
          return;
        }
        // Remove any existing wire connected to this exact destination port
        const filteredWires = model.wires.filter((w) => !(w.toBlock === node.id && w.toPort === portIndex));
        const newWire: BlockWire = {
          id: `w_${Date.now().toString(36)}`,
          fromBlock: connectingFrom.blockId,
          fromPort: connectingFrom.portIndex,
          toBlock: node.id,
          toPort: portIndex,
        };
        setModel((prev) => ({ ...prev, wires: [...filteredWires, newWire] }));
        setConnectingFrom(null);
      }
    }
  };

  // Update param on selected block
  const handleParamChange = (key: string, val: number) => {
    if (!selectedBlockId) return;
    setModel((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === selectedBlockId ? { ...n, params: { ...n.params, [key]: clampParam(n.kind, key, val) } } : n)),
    }));
  };

  // Canvas bounds calculation
  const canvasBounds = useMemo(() => {
    let maxX = 1280;
    let maxY = 440;
    for (const n of model.nodes) {
      if (n.x + BLOCK_WIDTH + 35 > maxX) maxX = n.x + BLOCK_WIDTH + 35;
      if (n.y + BLOCK_HEIGHT + 135 > maxY) maxY = n.y + BLOCK_HEIGHT + 135;
    }
    return { width: Math.max(1280, maxX), height: Math.max(460, maxY) };
  }, [model.nodes]);

  // The loop as the bench can run it, or why it can't.
  const bench = useMemo(() => benchExport(model), [model]);

  return (
    <div className="ll ll-builder" style={{ paddingBottom: '3rem' }}>
      {/* ── Header & Primary Actions ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.2rem' }}>
        <div>
          <div className="ll-crumbs">
            <Link href="/loop-lab">Loop Lab</Link> / Block Studio
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span>Block Diagram Studio</span>
            <span style={{ fontSize: '0.74rem', fontWeight: 700, background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-light)', padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              SYSTEM BUILDER
            </span>
          </h1>
          <p className="ll-muted" style={{ fontSize: '0.88rem', marginTop: '0.25rem', maxWidth: '820px' }}>
            Wire a loop from blocks and simulate it as you build. Assemble sources, feedback controllers, nonlinearities, and multi-channel scopes with instantaneous numerical simulation and export to the benchmark suite.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={share} className="ll-btn is-small" title="Copy a link that opens this diagram">
            🔗 Share
          </button>
          <button onClick={() => setShowSaved((v) => !v)} className={`ll-btn is-small${showSaved ? ' is-primary' : ''}`} aria-expanded={showSaved} title="Diagrams kept in this browser">
            📁 Saved ({savedList.length})
          </button>
          <button onClick={undo} disabled={histSize.past === 0} className="ll-btn is-small" title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button onClick={redo} disabled={histSize.future === 0} className="ll-btn is-small" title="Redo (Ctrl+Y)">
            ↷ Redo
          </button>
          {pinnedResult ? (
            <button
              onClick={() => setPinnedResult(null)}
              className="ll-btn is-small"
              style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--danger)' }}
              title="Clear pinned reference trace"
            >
              ✕ Clear Pin
            </button>
          ) : (
            <button
              onClick={() => setPinnedResult(simResult)}
              className="ll-btn is-small"
              title="Pin current simulation trace to compare with future parameter tweaks"
            >
              📌 Pin Trace
            </button>
          )}

          <button
            onClick={() => {
              const curTmpl = BLOCK_TEMPLATES.find((t) => t.id === model.id) || BLOCK_TEMPLATES[0];
              loadTemplate(curTmpl);
            }}
            className="ll-btn is-small"
            title="Reset diagram to pristine template configuration"
          >
            ↺ Reset
          </button>

          {bench.url ? (
            <Link href={bench.url} className="ll-btn is-primary is-small" style={{ fontWeight: 650, gap: '0.4rem' }}
              title={bench.notes.length ? `Runs this loop on the bench. ${bench.notes.join(' ')}` : 'Runs this loop on the bench'}>
              <span>🚀 Open in Bench</span>
              <span style={{ opacity: 0.8 }}>→</span>
            </Link>
          ) : (
            <button className="ll-btn is-small" disabled title={`The bench can't run this diagram as drawn. ${bench.reason}`}>
              🚀 Open in Bench
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="ll-small" role="status" style={{ margin: '0 0 0.75rem' }}>
          {notice}{' '}
          <button className="ll-link" onClick={() => setNotice('')}>Dismiss</button>
        </p>
      )}
      {shareUrl && (
        <div className="ll-card" style={{ padding: '0.6rem 0.8rem', marginBottom: '0.75rem' }}>
          <label className="ll-field">
            <span>Copy this link (the browser wouldn’t copy it for you)</span>
            <input type="text" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button className="ll-link" onClick={() => setShareUrl('')}>Close</button>
        </div>
      )}
      {showSaved && (
        <div className="ll-card" style={{ padding: '0.75rem 1rem', marginBottom: '0.85rem' }}>
          <form style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); saveCurrent(); }}>
            <label className="ll-field" style={{ flex: '1 1 14rem' }}>
              <span>Save this diagram as</span>
              <input type="text" value={saveName} placeholder={model.name} maxLength={80} onChange={(e) => setSaveName(e.target.value)} />
            </label>
            <button type="submit" className="ll-btn is-small is-primary">Save</button>
          </form>
          {savedList.length === 0 ? (
            <p className="ll-small" style={{ margin: '0.6rem 0 0' }}>Nothing saved yet. Saved diagrams stay in this browser.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {savedList.map((e) => (
                <li key={e.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                  <span>
                    <strong>{e.name}</strong>{' '}
                    <span className="ll-small">{e.model.nodes.length} blocks · {e.savedAt ? new Date(e.savedAt).toLocaleString() : ''}</span>
                  </span>
                  <span style={{ display: 'flex', gap: '0.3rem' }}>
                    <button className="ll-btn is-small" onClick={() => openSaved(e)}>Open</button>
                    <button className="ll-btn is-small is-quiet" onClick={() => deleteSaved(e)} aria-label={`Delete ${e.name}`}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(!bench.url || bench.notes.length > 0) && (
        <p className="ll-small" role="status" style={{ margin: '0 0 0.75rem' }}>
          {bench.url
            ? <><strong>On the bench:</strong> {bench.notes.join(' ')}</>
            : <><strong>Open in Bench is off:</strong> the bench can&apos;t run this diagram as drawn. {bench.reason}</>}
        </p>
      )}
      {simResult.algebraicLoops.map((ring, i) => (
        <p key={i} className="ll-small" role="status" style={{ margin: '0 0 0.75rem', color: ring.solved ? undefined : 'var(--danger)' }}>
          <strong>{ring.solved ? 'Solved at every instant:' : 'No answer:'}</strong>{' '}
          {ring.blocks.join(' → ')} feed back into {ring.blocks.length === 1 ? 'itself' : 'each other'} with nothing that takes time in between.
          {ring.solved
            ? ' Each step finds the value that comes back unchanged.'
            : ' No value comes back unchanged, so these blocks read 0. Put a lag, a delay or an integrator in the ring.'}
        </p>
      ))}

      {/* ── Top Control Bar (Templates, Sim Settings, Wiring Mode, Zoom, Clear) ── */}
      <div
        className="ll-card"
        style={{
          padding: '0.65rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.85rem',
          background: 'var(--surface-glass)',
        }}
      >
        {/* Template Selector Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '0.2rem' }}>
            Templates:
          </span>
          {BLOCK_TEMPLATES.map((tmpl) => {
            const active = model.id === tmpl.id;
            return (
              <button
                key={tmpl.id}
                onClick={() => loadTemplate(tmpl)}
                className="ll-btn is-small"
                style={{
                  fontSize: '0.78rem',
                  padding: '0.22rem 0.65rem',
                  background: active ? 'var(--surface-hover)' : 'transparent',
                  borderColor: active ? 'var(--accent-light)' : 'var(--surface-border)',
                  fontWeight: active ? 650 : 500,
                  color: active ? 'var(--foreground)' : 'var(--muted)',
                }}
              >
                {tmpl.name.split(' (')[0]}
              </button>
            );
          })}
        </div>

        {/* Simulation & Canvas Controls Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Duration */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
            <span className="ll-muted">Duration (s):</span>
            <select
              value={model.duration}
              onChange={(e) => setModel((prev) => ({ ...prev, duration: Number(e.target.value) }))}
              style={{ padding: '0.15rem 0.45rem', minHeight: '26px', fontSize: '0.8rem' }}
            >
              <option value={40}>40 s</option>
              <option value={60}>60 s</option>
              <option value={80}>80 s</option>
              <option value={100}>100 s</option>
              <option value={150}>150 s</option>
            </select>
          </div>

          {/* dt */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
            <span className="ll-muted">dt (s):</span>
            <select
              value={model.dt}
              onChange={(e) => setModel((prev) => ({ ...prev, dt: Number(e.target.value) }))}
              style={{ padding: '0.15rem 0.45rem', minHeight: '26px', fontSize: '0.8rem' }}
            >
              <option value={0.05}>0.05 s (Fidelity)</option>
              <option value={0.1}>0.10 s (Standard)</option>
              <option value={0.2}>0.20 s (Fast)</option>
            </select>
          </div>

          {/* Wiring Mode Toggle */}
          <button
            onClick={() => {
              if (connectingFrom) {
                setConnectingFrom(null);
              } else if (selectedBlockId) {
                const node = model.nodes.find((n) => n.id === selectedBlockId);
                if (node) {
                  const coords = getPortCoords(node, 'out', 0);
                  setConnectingFrom({ blockId: node.id, portIndex: 0, x: coords.x, y: coords.y });
                }
              }
            }}
            disabled={!connectingFrom && !selectedBlockId}
            className="ll-btn is-small"
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              borderColor: connectingFrom ? 'var(--warning)' : undefined,
              background: connectingFrom ? 'rgba(245, 158, 11, 0.15)' : undefined,
              color: connectingFrom ? 'var(--warning)' : undefined,
            }}
            title={connectingFrom ? 'Cancel wire creation (Esc)' : selectedBlockId ? 'Start a wire from the selected block\'s output' : 'Select a block first, or click any block\'s output ● to start a wire'}
          >
            {connectingFrom ? '✕ Cancel Wire' : '+ Add Wire'}
          </button>

          {/* Auto-Layout */}
          <button
            onClick={handleAutoLayout}
            className="ll-btn is-small"
            title="Cleanly organize blocks in topological left-to-right alignment"
            style={{ fontSize: '0.78rem' }}
          >
            ⚡ Auto-Layout
          </button>

          {/* Zoom Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
              className="ll-btn is-small"
              style={{ minHeight: '26px', padding: '0 0.45rem', fontSize: '0.8rem' }}
              title="Zoom Out"
            >
              −
            </button>
            <button
              onClick={() => setZoom(1.0)}
              className="ll-btn is-small"
              style={{
                minHeight: '26px',
                padding: '0 0.5rem',
                fontSize: '0.76rem',
                fontWeight: Math.abs(zoom - 1) < 0.02 ? 700 : 500,
                borderColor: Math.abs(zoom - 1) < 0.02 ? 'var(--accent-light)' : undefined,
              }}
              title="Reset Zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
              className="ll-btn is-small"
              style={{ minHeight: '26px', padding: '0 0.45rem', fontSize: '0.8rem' }}
              title="Zoom In"
            >
              +
            </button>
          </div>

          {/* Clear Canvas */}
          <button
            onClick={() => {
              if (confirm('Clear the diagram canvas?')) {
                setModel({ id: 'custom-diagram', name: 'Custom Diagram', description: 'Empty canvas diagram', duration: 60, dt: 0.1, nodes: [], wires: [] }, { step: true });
                setSelectedBlockId(null);
                setSelectedWireId(null);
                setConnectingFrom(null);
              }
            }}
            className="ll-btn is-small"
            style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)', fontSize: '0.78rem' }}
            title="Clear all blocks and wires"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Categorized Horizontal Block Palette Dock ── */}
      <div
        className="ll-card"
        style={{
          padding: '0.75rem 1rem',
          marginBottom: '0.85rem',
          background: 'var(--surface-glass)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
          {/* Category Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '0.3rem' }}>
              Block Palette:
            </span>
            {[
              { id: 'all', label: 'All' },
              { id: 'sources', label: 'Sources' },
              { id: 'controllers', label: 'Controllers' },
              { id: 'dynamics', label: 'Plant Dynamics' },
              { id: 'math', label: 'Math & Logic' },
              { id: 'sinks', label: 'Sinks' },
            ].map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id as any)}
                  className="ll-btn is-small"
                  style={{
                    border: active ? '1px solid var(--accent-light)' : '1px solid transparent',
                    background: active ? 'var(--surface-hover)' : 'transparent',
                    color: active ? 'var(--foreground)' : 'var(--muted)',
                    borderRadius: '5px',
                    fontSize: '0.76rem',
                    fontWeight: active ? 650 : 500,
                    padding: '0.2rem 0.55rem',
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
            Click card to add block • Drag header to reposition • Click ● ports to wire
          </span>
        </div>

        {/* Responsive Grid of Clickable Block Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
            gap: '0.5rem',
            maxHeight: '160px',
            overflowY: 'auto',
            paddingRight: '4px',
          }}
        >
          {(Object.keys(BLOCK_CATALOG) as BlockKind[])
            .filter((k) => activeCategory === 'all' || BLOCK_CATALOG[k].category === activeCategory)
            .map((kind) => {
              const entry = BLOCK_CATALOG[kind];
              const col = CATEGORY_COLORS[entry.category];
              return (
                <button
                  key={kind}
                  onClick={() => addBlock(kind)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '0.45rem 0.6rem',
                    border: '1px solid var(--surface-border)',
                    borderTop: `3px solid ${col.border}`,
                    borderRadius: '7px',
                    background: 'var(--input-bg)',
                    color: 'var(--foreground)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'border-color 0.12s, transform 0.08s, box-shadow 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = col.border;
                    e.currentTarget.style.boxShadow = `0 4px 12px ${col.border}22`;
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--surface-border)';
                    e.currentTarget.style.borderTop = `3px solid ${col.border}`;
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'none';
                  }}
                  title={entry.description}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: 650, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.66rem',
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 650,
                        color: col.text,
                        background: col.bg,
                        padding: '0.05rem 0.3rem',
                        borderRadius: '3px',
                        border: `1px solid ${col.border}44`,
                        flexShrink: 0,
                      }}
                    >
                      {entry.shortSymbol}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      color: 'var(--muted)',
                      lineHeight: 1.25,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {entry.description}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* ── Full-Width Interactive Block Diagram Canvas ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
        {/* Active Connection Notification Banner */}
        {connectingFrom && (
          <div
            style={{
              padding: '0.4rem 0.85rem',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              color: 'var(--warning)',
              fontSize: '0.82rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Wiring active: Click any destination input port ● (left side of target block) to complete connection.</span>
            <button
              onClick={() => setConnectingFrom(null)}
              style={{ background: 'none', border: 'none', color: 'var(--warning)', cursor: 'pointer', fontWeight: 700 }}
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        <div
          ref={canvasRef}
          data-canvas
          aria-label="Block diagram canvas"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
          onClick={() => {
            setSelectedBlockId(null);
            setSelectedWireId(null);
          }}
          style={{
            position: 'relative',
            width: '100%',
            minHeight: '500px',
            height: '520px',
            borderRadius: '12px',
            border: '1px solid var(--surface-border)',
            background: 'var(--surface-glass)',
            backgroundImage: 'radial-gradient(circle, var(--surface-border) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            overflow: 'auto',
            cursor: connectingFrom ? 'crosshair' : 'default',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: `${canvasBounds.width * zoom}px`,
              height: `${canvasBounds.height * zoom}px`,
              transform: zoom === 1 ? undefined : `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            {/* SVG Wire Layer */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${canvasBounds.width}px`,
                height: `${canvasBounds.height}px`,
                pointerEvents: 'none',
              }}
            >
              <defs>
                <marker id="ll-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--muted)" />
                </marker>
                <marker id="ll-arrow-active" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent-light)" />
                </marker>
              </defs>

              {/* Existing Connected Wires */}
              {model.wires.map((wire) => {
                const fromNode = model.nodes.find((n) => n.id === wire.fromBlock);
                const toNode = model.nodes.find((n) => n.id === wire.toBlock);
                if (!fromNode || !toNode) return null;

                const start = getPortCoords(fromNode, 'out', wire.fromPort);
                const end = getPortCoords(toNode, 'in', wire.toPort);
                const geom = computeSmartWireGeometry(wire, fromNode, toNode, start, end, model.nodes, model.wires);
                const pathD = geom.path;
                const isSelected = selectedWireId === wire.id;
                const isFeedback = Boolean(
                  wire.label?.toLowerCase().includes('fb') ||
                    wire.label?.toLowerCase().includes('feedback') ||
                    end.x <= start.x + 24
                );
                const labelWidth = wire.label ? Math.max(28, wire.label.length * 6.6 + 12) : 0;

                return (
                  <g key={wire.id} style={{ pointerEvents: 'auto' }}>
                    {/* Fat invisible path for easy hover/clicking */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedWireId(wire.id);
                        setSelectedBlockId(null);
                      }}
                    />
                    {/* Glowing highlight if selected */}
                    {isSelected && (
                      <path
                        d={pathD}
                        fill="none"
                        stroke="var(--accent-light)"
                        strokeWidth={7}
                        strokeOpacity={0.45}
                        strokeLinecap="round"
                      />
                    )}
                    {/* Visible wire path */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isSelected ? 'var(--accent-light)' : 'var(--muted)'}
                      strokeWidth={isSelected ? 2.8 : 2.0}
                      strokeDasharray={isFeedback ? '6 4' : undefined}
                      markerEnd={isSelected ? 'url(#ll-arrow-active)' : 'url(#ll-arrow)'}
                      style={{ cursor: 'pointer', transition: 'stroke 0.15s, stroke-width 0.15s' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedWireId(wire.id);
                        setSelectedBlockId(null);
                      }}
                    />
                    {/* Branch junction dot if output port fans out */}
                    {geom.branchPoint && (
                      <circle
                        cx={geom.branchPoint.x}
                        cy={geom.branchPoint.y}
                        r={3.5}
                        fill={isSelected ? 'var(--accent-light)' : 'var(--muted)'}
                      />
                    )}
                    {/* Wire label badge with crisp pill backing */}
                    {wire.label && (
                      <g
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWireId(wire.id);
                          setSelectedBlockId(null);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <rect
                          x={geom.labelX - labelWidth / 2}
                          y={geom.labelY - 11}
                          width={labelWidth}
                          height={16}
                          rx={4}
                          fill="var(--background)"
                          fillOpacity={0.9}
                          stroke={isSelected ? 'var(--accent-light)' : 'var(--surface-border)'}
                          strokeWidth={1}
                        />
                        <text
                          x={geom.labelX}
                          y={geom.labelY + 1}
                          fill={isSelected ? 'var(--accent-light)' : 'var(--foreground)'}
                          fontSize="10.5"
                          fontFamily="ui-sans-serif, system-ui"
                          fontWeight="650"
                          textAnchor="middle"
                        >
                          {wire.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Rubber Band Wire when actively dragging connection */}
              {connectingFrom && (
                <path
                  d={computeWirePath(connectingFrom.x, connectingFrom.y, mousePos.x, mousePos.y)}
                  fill="none"
                  stroke="var(--warning)"
                  strokeWidth={2.5}
                  strokeDasharray="4 4"
                />
              )}
            </svg>

            {/* Interactive Block Diagram Nodes */}
            {model.nodes.map((node) => {
              const entry = BLOCK_CATALOG[node.kind];
              const isSelected = selectedBlockId === node.id;
              const col = CATEGORY_COLORS[entry.category];
              const inputPorts = getNodeInputPorts(node);
              const outputPorts = getNodeOutputPorts(node);
              const trace = simResult.nodeOutputs[node.id];
              const mathNotation = getBlockMathNotation(node);
              const paramPills = getBlockParamPills(node);

              return (
                <div
                  key={node.id}
                  data-block={node.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBlockId(node.id);
                    setSelectedWireId(null);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${BLOCK_WIDTH}px`,
                    height: `${BLOCK_HEIGHT}px`,
                    borderRadius: '10px',
                    border: `2px solid ${isSelected ? col.border : 'var(--surface-border)'}`,
                    boxShadow: isSelected
                      ? `0 0 0 3px ${col.border}44, 0 8px 24px rgba(0,0,0,0.25)`
                      : '0 2px 10px rgba(0,0,0,0.12)',
                    background: 'var(--surface-hover)',
                    zIndex: isSelected ? 30 : 10,
                    userSelect: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 0,
                    overflow: 'visible',
                    transition: 'box-shadow 0.12s, border-color 0.12s',
                  }}
                >
                  {/* Colored Header Bar (Drag Handle) */}
                  <div
                    data-handle
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      // Moves and the release come here wherever the pointer goes. (A pointer the browser no
                      // longer counts as down can't be captured; the drag still works without it.)
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Not capturable.
                      }
                      lastEdit.current = 0;
                      setSelectedBlockId(node.id);
                      setSelectedWireId(null);
                      setDraggingBlock({
                        id: node.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: node.x,
                        origY: node.y,
                      });
                    }}
                    style={{
                      height: '26px',
                      cursor: 'grab',
                      touchAction: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: col.bg,
                      borderTopLeftRadius: '8px',
                      borderTopRightRadius: '8px',
                      borderBottom: `1px solid ${col.border}33`,
                      padding: '0 8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: '12.5px',
                          fontWeight: 700,
                          color: 'var(--foreground)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={node.label}
                      >
                        {node.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.64rem',
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 650,
                        color: col.text,
                        background: 'var(--input-bg)',
                        padding: '0 4px',
                        borderRadius: '3px',
                        flexShrink: 0,
                      }}
                    >
                      {entry.shortSymbol}
                    </span>
                  </div>

                  {/* Block Body: Mathematical Transfer Function & Key Parameter Pills & Live Sparkline */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '4px 8px 6px' }}>
                    {/* Math Notation */}
                    <div
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 650,
                        fontFamily: 'ui-monospace, monospace',
                        color: col.text,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={mathNotation}
                    >
                      {mathNotation}
                    </div>

                    {/* Parameter Pills */}
                    {paramPills.length > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {paramPills.map((pill, pIdx) => (
                          <span
                            key={pIdx}
                            style={{
                              fontSize: '0.65rem',
                              fontFamily: 'ui-monospace, monospace',
                              color: 'var(--muted)',
                              background: 'var(--input-bg)',
                              padding: '0.05rem 0.35rem',
                              borderRadius: '3px',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            {pill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ height: '4px' }} />
                    )}

                    {/* Inline Sparkline */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '20px' }}>
                      <Sparkline data={trace} color={col.border} />
                    </div>
                  </div>

                  {/* Input Ports (Left) */}
                  {inputPorts.map((portName, idx) => {
                    const coords = getPortCoords(node, 'in', idx);
                    const relY = coords.y - node.y;
                    const isConnectingTarget = !!connectingFrom && connectingFrom.blockId !== node.id;

                    return (
                      <div
                        key={`in_${idx}`}
                        data-port={`in:${idx}`}
                        onClick={(e) => handlePortClick(e, node, 'in', idx)}
                        style={{
                          position: 'absolute',
                          left: '-13px',
                          top: `${relY - 13}px`,
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          border: '6px solid transparent',
                          backgroundClip: 'padding-box',
                          background: isConnectingTarget ? 'var(--warning)' : 'var(--background)',
                          boxShadow: `inset 0 0 0 2px ${isConnectingTarget ? 'var(--warning)' : 'var(--muted)'}${isConnectingTarget ? ', 0 0 10px var(--warning)' : ''}`,
                          touchAction: 'manipulation',
                          cursor: 'pointer',
                          zIndex: 40,
                          transition: 'transform 0.12s, border-color 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.35)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                        title={`Input port ${idx + 1}: ${portName}`}
                      >
                        {/* Port label placed inside/above port only when multi-input (except Scope which labels wires directly) */}
                        {inputPorts.length > 1 && node.kind !== 'scope' && (
                          <span
                            style={{
                              position: 'absolute',
                              left: '13px',
                              top: '-5px',
                              fontSize: '0.62rem',
                              fontWeight: 750,
                              color: 'var(--muted)',
                              background: 'var(--surface-hover)',
                              padding: '0 2px',
                              borderRadius: '2px',
                              pointerEvents: 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {portName.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Output Ports (Right) */}
                  {outputPorts.map((portName, idx) => {
                    const coords = getPortCoords(node, 'out', idx);
                    const relY = coords.y - node.y;
                    const isSourceActive = connectingFrom?.blockId === node.id;

                    return (
                      <div
                        key={`out_${idx}`}
                        data-port={`out:${idx}`}
                        onClick={(e) => handlePortClick(e, node, 'out', idx)}
                        style={{
                          position: 'absolute',
                          right: '-13px',
                          top: `${relY - 13}px`,
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          border: '6px solid transparent',
                          backgroundClip: 'padding-box',
                          background: isSourceActive ? 'var(--warning)' : col.border,
                          boxShadow: `inset 0 0 0 2px var(--background)${isSourceActive ? ', 0 0 12px var(--warning)' : ''}`,
                          touchAction: 'manipulation',
                          cursor: 'pointer',
                          zIndex: 40,
                          transition: 'transform 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.35)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                        title={`Output port: ${portName} (Click to wire)`}
                      >
                        {outputPorts.length > 1 && (
                          <span
                            style={{
                              position: 'absolute',
                              right: '13px',
                              top: '-5px',
                              fontSize: '0.62rem',
                              fontWeight: 750,
                              color: 'var(--muted)',
                              pointerEvents: 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {portName}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom 2-Column Split: Scopes/Phase Left (1.5fr) vs Inspector Right (1fr) ── */}
      <div className="ll-builder-split">
        {/* ── Left Column: Multi-Channel Scope Chart, Phase-Plane Plot & Metrics Table ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Scope Visualizers */}
          {simResult.scopeSeries.map((scope) => {
            const chartSeries: Series[] = scope.series.map((s) => ({
              label: s.label,
              color: s.color,
              x: s.x,
              y: s.y,
              width: 2.2,
            }));

            if (pinnedResult) {
              const pinnedScope = pinnedResult.scopeSeries.find((ps) => ps.id === scope.id);
              if (pinnedScope) {
                for (const ps of pinnedScope.series) {
                  chartSeries.push({
                    label: `[Pinned] ${ps.label}`,
                    color: ps.color,
                    x: ps.x,
                    y: ps.y,
                    dash: '5 4',
                    width: 1.6,
                  });
                }
              }
            }

            const spMetric = scope.metrics.find((x) => x.channel === 0);
            const ch0Final = spMetric?.finalValue ?? 0;

            return (
              <div key={scope.id} className="ll-card" style={{ padding: '1rem 1.15rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.15rem' }}>📊</span>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 650, margin: 0 }}>{scope.title}</h3>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Duration: {model.duration} s • dt: {model.dt} s
                  </span>
                </div>

                {/* Multi-Channel Scope Chart */}
                <div style={{ width: '100%', marginBottom: '1rem' }}>
                  <Chart
                    series={chartSeries}
                    x={{ label: 'Time (s)', min: 0, max: model.duration }}
                    y={{ label: 'Signal Magnitude' }}
                    height={280}
                    label={scope.title}
                  />
                </div>

                {/* Signal Performance Metrics Table */}
                <div>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' }}>
                    Signal Performance Analytics
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--muted)' }}>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>Signal / Channel</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>Overshoot %</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>Settling Time</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>SS Error</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>IAE</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>Peak</th>
                          <th style={{ padding: '0.35rem 0.5rem', fontWeight: 650 }}>Final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scope.metrics.map((m, idx) => {
                          const ssErr = m.channel === 1 && spMetric ? Math.abs(ch0Final - m.finalValue).toFixed(2) : '—';
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                              <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                                  <span>{m.label}</span>
                                </div>
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}>
                                {m.channel !== 1 ? (
                                  <span className="ll-muted" title="Read on the process value (ch2) only">—</span>
                                ) : m.overshootPct > 0 ? (
                                  <span style={{ color: m.overshootPct > 25 ? 'var(--danger)' : 'var(--warning)', fontWeight: 600 }}>
                                    {m.overshootPct}%
                                  </span>
                                ) : (
                                  '0.0%'
                                )}
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}>
                                {m.settleTime !== null ? `${m.settleTime} s` : '—'}
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}>
                                {ssErr}
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}>
                                {m.iae}
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace' }}>
                                {m.peak}
                              </td>
                              <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                                {m.finalValue}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Phase-Plane Orbit Trajectory Plots */}
          {simResult.xyPlots.map((xy) => (
            <div key={xy.id} className="ll-card" style={{ padding: '1rem 1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '1.15rem' }}>🌀</span>
                <h3 style={{ fontSize: '1.02rem', fontWeight: 650, margin: 0 }}>{xy.title}</h3>
              </div>
              <Chart
                series={[{ label: 'Phase Orbit Trajectory', color: 'var(--accent-light)', x: xy.x, y: xy.y, width: 2.2 }]}
                x={{ label: xy.xLabel }}
                y={{ label: xy.yLabel }}
                height={220}
                label={xy.title}
              />
            </div>
          ))}
        </div>

        {/* ── Right Column: Selected Block Inspector & Tuning ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {selectedNode ? (
            <div className="ll-card" style={{ padding: '1rem 1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚙️</span>
                  <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Block Inspector</h3>
                    <span style={{ fontSize: '0.72rem', color: CATEGORY_COLORS[BLOCK_CATALOG[selectedNode.kind].category].text, fontWeight: 650 }}>
                      {BLOCK_CATALOG[selectedNode.kind].name}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <button onClick={duplicateSelectedBlock} className="ll-btn is-small" title="Duplicate this block">
                    Copy
                  </button>
                  <button
                    onClick={deleteSelectedBlock}
                    className="ll-btn is-small"
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    title="Delete block (Del)"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Editable Block Label */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 650, color: 'var(--muted)', marginBottom: '0.25rem' }}>
                  Block Label
                </label>
                <input
                  type="text"
                  value={selectedNode.label}
                  onChange={(e) => {
                    const val = e.target.value;
                    setModel((prev) => ({
                      ...prev,
                      nodes: prev.nodes.map((n) => (n.id === selectedNode.id ? { ...n, label: val } : n)),
                    }));
                  }}
                  style={{ width: '100%', fontSize: '0.84rem' }}
                />
              </div>

              {/* Sum Junction Port Signs Configuration */}
              {selectedNode.kind === 'sum' && (
                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 650, color: 'var(--muted)', marginBottom: '0.3rem' }}>
                    Summing Signs Configuration
                  </label>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {['+-', '++', '+--', '++-', '+++'].map((sign) => {
                      const active = (selectedNode.signs || '+-') === sign;
                      return (
                        <button
                          key={sign}
                          onClick={() => {
                            setModel((prev) => ({
                              ...prev,
                              nodes: prev.nodes.map((n) => (n.id === selectedNode.id ? { ...n, signs: sign } : n)),
                            }));
                          }}
                          className="ll-btn is-small"
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            background: active ? 'var(--surface-hover)' : 'transparent',
                            borderColor: active ? 'var(--accent-light)' : 'var(--surface-border)',
                            fontWeight: active ? 700 : 500,
                          }}
                        >
                          {sign.split('').join(' ')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Large KaTeX Equation Card */}
              <div
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: '9px',
                  padding: '0.75rem 0.9rem',
                  marginBottom: '0.85rem',
                }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                  Transfer Function / Mathematical Model
                </div>
                <div style={{ overflowX: 'auto', textAlign: 'center', padding: '0.3rem 0' }}>
                  <Tex latex={BLOCK_CATALOG[selectedNode.kind]?.latex(selectedNode) || ''} display />
                </div>
              </div>

              {/* Physical Intuition Callout */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  fontSize: '0.8rem',
                  lineHeight: 1.45,
                  color: 'var(--muted)',
                  marginBottom: '0.95rem',
                }}
              >
                <strong style={{ color: 'var(--foreground)', display: 'block', marginBottom: '0.2rem' }}>Physical Intuition:</strong>
                {BLOCK_CATALOG[selectedNode.kind]?.intuition}
              </div>

              {/* Interactive Parameter Sliders & Number Inputs */}
              {BLOCK_CATALOG[selectedNode.kind]?.paramSpecs.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.55rem' }}>
                    Tuning Parameters
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {BLOCK_CATALOG[selectedNode.kind].paramSpecs.map((spec) => {
                      const curVal = selectedNode.params[spec.key] ?? spec.default;
                      return (
                        <div key={spec.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                            <span style={{ fontWeight: 650 }}>{spec.label}</span>
                            <span style={{ color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>
                              {curVal} {spec.unit}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 75px', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="range"
                              min={spec.min}
                              max={spec.max}
                              step={spec.step}
                              value={curVal}
                              onChange={(e) => handleParamChange(spec.key, Number(e.target.value))}
                            />
                            <ParamNumber spec={spec} value={curVal} onChange={(v) => handleParamChange(spec.key, v)} />
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{spec.hint}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Connected Wires List */}
              <div style={{ marginBottom: '0.95rem' }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' }}>
                  Connected Wires
                </div>
                {(() => {
                  const incoming = model.wires.filter((w) => w.toBlock === selectedNode.id);
                  const outgoing = model.wires.filter((w) => w.fromBlock === selectedNode.id);
                  if (incoming.length === 0 && outgoing.length === 0) {
                    return <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>No wires connected to this block.</div>;
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {incoming.map((w) => {
                        const src = model.nodes.find((n) => n.id === w.fromBlock);
                        return (
                          <div
                            key={w.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '0.75rem',
                              padding: '0.3rem 0.5rem',
                              background: 'var(--input-bg)',
                              borderRadius: '5px',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            <span>
                              <strong>In:</strong> from {src?.label || w.fromBlock} (Port {w.toPort + 1})
                            </span>
                            <button
                              onClick={() => setModel((prev) => ({ ...prev, wires: prev.wires.filter((wire) => wire.id !== w.id) }))}
                              className="ll-btn is-small"
                              style={{ color: 'var(--danger)', minHeight: '20px', padding: '0 0.35rem', fontSize: '0.7rem' }}
                              title="Disconnect wire"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      {outgoing.map((w) => {
                        const dst = model.nodes.find((n) => n.id === w.toBlock);
                        return (
                          <div
                            key={w.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '0.75rem',
                              padding: '0.3rem 0.5rem',
                              background: 'var(--input-bg)',
                              borderRadius: '5px',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            <span>
                              <strong>Out:</strong> to {dst?.label || w.toBlock} (Port {w.toPort + 1})
                            </span>
                            <button
                              onClick={() => setModel((prev) => ({ ...prev, wires: prev.wires.filter((wire) => wire.id !== w.id) }))}
                              className="ll-btn is-small"
                              style={{ color: 'var(--danger)', minHeight: '20px', padding: '0 0.35rem', fontSize: '0.7rem' }}
                              title="Disconnect wire"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Delete Block Button */}
              <button
                onClick={deleteSelectedBlock}
                className="ll-btn is-small"
                style={{
                  width: '100%',
                  color: 'var(--danger)',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  justifyContent: 'center',
                  fontWeight: 650,
                  fontSize: '0.8rem',
                  padding: '0.4rem',
                }}
              >
                🗑️ Delete Selected Block
              </button>
            </div>
          ) : selectedWire ? (
            <div className="ll-card" style={{ padding: '1rem 1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                <h3 style={{ fontSize: '1.02rem', fontWeight: 650, margin: 0 }}>Wire Properties</h3>
                <button
                  onClick={() => {
                    setModel((prev) => ({ ...prev, wires: prev.wires.filter((w) => w.id !== selectedWire.id) }));
                    setSelectedWireId(null);
                  }}
                  className="ll-btn is-small"
                  style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                >
                  Delete Wire
                </button>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '0.85rem' }}>
                <div>
                  <strong>From Source:</strong> {model.nodes.find((n) => n.id === selectedWire.fromBlock)?.label || selectedWire.fromBlock}
                </div>
                <div>
                  <strong>To Target:</strong> {model.nodes.find((n) => n.id === selectedWire.toBlock)?.label || selectedWire.toBlock} (Input Port {selectedWire.toPort + 1})
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 650, color: 'var(--muted)', marginBottom: '0.25rem' }}>
                  Wire Annotation Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. SP, Feedback, Valve OP"
                  value={selectedWire.label || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setModel((prev) => ({
                      ...prev,
                      wires: prev.wires.map((w) => (w.id === selectedWire.id ? { ...w, label: val } : w)),
                    }));
                  }}
                  style={{ width: '100%', fontSize: '0.82rem' }}
                />
              </div>
            </div>
          ) : (
            <div className="ll-card" style={{ padding: '1rem 1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🏛️</span>
                <h3 style={{ fontSize: '1.02rem', fontWeight: 650, margin: 0 }}>System Architecture</h3>
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0 0 0.85rem', lineHeight: 1.45 }}>
                {model.description}
              </p>

              {/* Effective Dynamics Badge Strip */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  padding: '0.65rem',
                  background: 'var(--input-bg)',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  fontSize: '0.76rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--muted)' }}>Loop State:</span>
                  <div style={{ fontWeight: 650, color: simResult.summary.loopClosed ? 'var(--success)' : 'var(--warning)' }}>
                    {simResult.summary.loopClosed ? 'Closed (Feedback)' : 'Open Loop'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Plant Gain (K):</span>
                  <div style={{ fontWeight: 650, fontFamily: 'ui-monospace, monospace' }}>{simResult.summary.plant ? `${Number(simResult.summary.plant.K.toFixed(3))}${simResult.summary.plant.integrating ? ' /s' : ''}` : '—'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Time Lag (τ₁):</span>
                  <div style={{ fontWeight: 650, fontFamily: 'ui-monospace, monospace' }}>{simResult.summary.plant ? (simResult.summary.plant.integrating ? 'integrating' : `${Number(simResult.summary.plant.tau1.toFixed(2))} s`) : '—'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--muted)' }}>Dead Time (θ):</span>
                  <div style={{ fontWeight: 650, fontFamily: 'ui-monospace, monospace' }}>{simResult.summary.plant ? `${Number(simResult.summary.plant.theta.toFixed(2))} s` : '—'}</div>
                </div>
              </div>

              <p className="ll-small" style={{ margin: '0 0 1rem' }}>
                {simResult.summary.plant
                  ? 'Everything in series round the controller\'s loop, multiplied out.'
                  : 'The controller\'s loop doesn\'t come down to one gain, lag and dead time.'}
              </p>

              {/* Guided Experiments */}
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.45rem' }}>
                Suggested Guided Experiments
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                <li style={{ marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--foreground)' }}>Phase Lag & Stability:</strong> Double plant dead time θ on the FOPDT block and watch oscillations expand on the Scope.
                </li>
                <li style={{ marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--foreground)' }}>Actuator Saturation:</strong> Reduce valve or saturation limits and observe transient windup.
                </li>
                <li>
                  <strong style={{ color: 'var(--foreground)' }}>Trace Pinning:</strong> Click <em>Pin Trace</em> in toolbar, adjust PI gain Kc, and inspect the Before vs After response overlay!
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
