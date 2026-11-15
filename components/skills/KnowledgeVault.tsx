'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  skillsGet,
  SignedOut,
  type KnowledgeBacklink,
  type KnowledgeEdge,
  type KnowledgeEdgeKind,
  type KnowledgeMaterialItem,
  type KnowledgeNode,
  type KnowledgeNodeKind,
  type KnowledgeResponse,
} from '@/components/skills/api';
import { ErrorNote, Loading, SignedOutCard } from '@/components/skills/Ui';
import type { ProjectAttachment } from '@/lib/skills/types';
import './knowledge.css';

const VIEW_W = 960;
const VIEW_H = 640;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;

const KIND_META: Record<KnowledgeNodeKind, { label: string; icon: string; color: string; radius: number; ring: number }> = {
  subject: { label: 'Skills', icon: '🎯', color: 'var(--habit-1)', radius: 16, ring: 70 },
  topic: { label: 'Topics', icon: '🧩', color: 'var(--habit-3)', radius: 11, ring: 165 },
  book: { label: 'Books', icon: '📕', color: 'var(--habit-4)', radius: 10, ring: 245 },
  paper: { label: 'Papers', icon: '📄', color: 'var(--habit-7)', radius: 10, ring: 245 },
  project: { label: 'Projects', icon: '🛠️', color: 'var(--habit-2)', radius: 11, ring: 245 },
  resource: { label: 'Resources', icon: '📎', color: 'var(--info)', radius: 9, ring: 245 },
  note: { label: 'Notes & Logs', icon: '✏️', color: 'var(--habit-5)', radius: 9, ring: 305 },
  reader: { label: 'Reader', icon: '📖', color: 'var(--habit-6)', radius: 10, ring: 305 },
  question: { label: 'Q&As', icon: '❓', color: 'var(--habit-8)', radius: 7, ring: 350 },
  tag: { label: '#Tags', icon: '#', color: 'var(--muted)', radius: 8, ring: 385 },
};

const ALL_KINDS = Object.keys(KIND_META) as KnowledgeNodeKind[];

const SOURCE_LABEL: Record<KnowledgeMaterialItem['sourceKind'], string> = {
  'notes-page': 'Notes page',
  'reader-notes': 'Reader notes',
  'topic-notes': 'Topic notes',
  'resource-takeaways': 'Takeaways',
  'project-log': 'Project log',
  book: 'Book',
  paper: 'Paper',
  article: 'Article',
  course: 'Course',
  video: 'Video',
  'reader-book': 'Reader book',
  question: 'Graded Q&A',
  card: 'Flashcard',
  step: 'Study step',
  activity: 'Activity',
  project: 'Project',
};

const EDGE_LABEL: Record<KnowledgeEdgeKind, string> = {
  subskill: 'Subskill link',
  topic: 'Topic',
  resource: 'Resource',
  reader: 'Reader book',
  'note-page': 'Notes page',
  'wiki-link': '[[Wiki-link]]',
  tag: '#Tag',
  question: 'Q&A',
  'project-log': 'Project log',
};

type Point = { x: number; y: number };
type VaultTab = 'all' | 'knowledge' | 'materials' | 'qa' | 'connections';

function hashUnit(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Deterministic radial + force-directed layout so nodes never flicker on re-render. */
function computeLayout(nodes: KnowledgeNode[], edges: KnowledgeEdge[], subjectId?: string): Record<string, Point> {
  if (!nodes.length) return {};
  const ordered = [...nodes].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const n = ordered.length;
  const idxById = new Map(ordered.map((node, idx) => [node.id, idx]));

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  const byRing = new Map<number, number[]>();
  ordered.forEach((node, idx) => {
    const r = node.kind === 'subject' && (subjectId ? node.subjectId === subjectId : ordered.filter((k) => k.kind === 'subject').length <= 1)
      ? 0
      : KIND_META[node.kind].ring;
    const list = byRing.get(r);
    if (list) list.push(idx);
    else byRing.set(r, [idx]);
  });

  for (const [radius, indices] of byRing.entries()) {
    const count = indices.length;
    indices.forEach((idx, pos) => {
      if (radius === 0 && count === 1) {
        x[idx] = CX;
        y[idx] = CY;
      } else {
        const effR = radius === 0 ? 75 : radius;
        const angle = (pos / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2 + (hashUnit(ordered[idx].id) - 0.5) * 0.15;
        x[idx] = CX + Math.cos(angle) * effR;
        y[idx] = CY + Math.sin(angle) * effR * 0.78;
      }
    });
  }

  const edgePairs: { a: number; b: number; ideal: number; weight: number }[] = [];
  for (const e of edges) {
    const a = idxById.get(e.from);
    const b = idxById.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const ideal = e.kind === 'note-page' || e.kind === 'reader' || e.kind === 'project-log'
      ? 68
      : e.kind === 'question' || e.kind === 'tag'
        ? 85
        : 105;
    const weight = e.kind === 'wiki-link' ? 0.11 : 0.08;
    edgePairs.push({ a, b, ideal, weight });
  }

  const iters = n > 200 ? 40 : n > 100 ? 75 : 110;
  const repulsion = Math.max(900, Math.min(3400, 46000 / Math.max(6, Math.sqrt(n))));

  for (let step = 0; step < iters; step++) {
    const cool = 1 - step / (iters + 10);
    for (let i = 0; i < n; i++) {
      vx[i] = 0;
      vy[i] = 0;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j];
        let dy = y[i] - y[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          const jitter = (hashUnit(`${ordered[i].id}:${ordered[j].id}`) - 0.5) * 2;
          dx = jitter || 0.7;
          dy = 0.7;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] += fx;
        vy[i] += fy;
        vx[j] -= fx;
        vy[j] -= fy;
      }
    }
    for (const ep of edgePairs) {
      const dx = x[ep.b] - x[ep.a];
      const dy = y[ep.b] - y[ep.a];
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - ep.ideal) * ep.weight;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[ep.a] += fx;
      vy[ep.a] += fy;
      vx[ep.b] -= fx;
      vy[ep.b] -= fy;
    }
    for (let i = 0; i < n; i++) {
      const isFocusedCenter = subjectId && ordered[i].id === `sub:${subjectId}`;
      const gravity = isFocusedCenter ? 0.14 : 0.028;
      vx[i] += (CX - x[i]) * gravity;
      vy[i] += (CY - y[i]) * gravity;

      const mag = Math.hypot(vx[i], vy[i]);
      const cap = 26 * cool;
      if (mag > cap && mag > 0) {
        vx[i] = (vx[i] / mag) * cap;
        vy[i] = (vy[i] / mag) * cap;
      }
      x[i] = Math.max(44, Math.min(VIEW_W - 44, x[i] + vx[i]));
      y[i] = Math.max(44, Math.min(VIEW_H - 44, y[i] + vy[i]));
    }
  }

  const out: Record<string, Point> = {};
  ordered.forEach((node, idx) => {
    out[node.id] = { x: Math.round(x[idx] * 10) / 10, y: Math.round(y[idx] * 10) / 10 };
  });
  return out;
}

function formatBytes(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentList({ attachments }: { attachments?: ProjectAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="kv-attachments">
      {attachments.map((att) => (
        <Fragment key={att.id}>
          {att.kind === 'video' && (
            <video className="kv-video-preview" controls preload="metadata" src={att.url}>
              <a href={att.url} target="_blank" rel="noopener noreferrer">{att.name}</a>
            </video>
          )}
          {att.kind === 'image' && (
            <img className="kv-image-preview" src={att.url} alt={att.name} loading="lazy" />
          )}
          <a className="kv-attachment-link" href={att.url} target="_blank" rel="noopener noreferrer">
            <span>{att.kind === 'video' ? '🎬' : att.kind === 'zip' ? '🗜️' : att.kind === 'image' ? '🖼️' : att.kind === 'link' ? '🔗' : '📎'}</span>
            <span>{att.name}</span>
            {att.size ? <span className="sk-muted">({formatBytes(att.size)})</span> : null}
          </a>
        </Fragment>
      ))}
    </div>
  );
}

function RichText({
  text,
  resolveWiki,
  onSelectNode,
}: {
  text: string;
  resolveWiki: (target: string) => string | undefined;
  onSelectNode: (nodeId: string) => void;
}) {
  const parts = useMemo(() => {
    const tokens: Array<{ type: 'text' | 'wiki' | 'tag'; raw: string; value: string }> = [];
    const re = /\[\[([^[\]\r\n]+?)\]\]|(https?:\/\/[^\s<>"')]+)|(?:^|(?<=[\s(\[{,;:]))#([a-zA-Z][a-zA-Z0-9_/-]{0,63})/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        tokens.push({ type: 'text', raw: text.slice(last, m.index), value: text.slice(last, m.index) });
      }
      if (m[1]) {
        const target = m[1].split('|')[0].trim();
        tokens.push({ type: 'wiki', raw: m[0], value: target });
      } else if (m[2]) {
        tokens.push({ type: 'text', raw: m[0], value: m[0] });
      } else if (m[3]) {
        const tag = m[3].replace(/[/_-]+$/, '').toLowerCase();
        if (/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(tag) || /^([a-f])\1\1$/i.test(tag)) {
          tokens.push({ type: 'text', raw: m[0], value: m[0] });
        } else {
          tokens.push({ type: 'tag', raw: m[0], value: tag });
        }
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      tokens.push({ type: 'text', raw: text.slice(last), value: text.slice(last) });
    }
    return tokens;
  }, [text]);

  return (
    <>
      {parts.map((tok, i) => {
        if (tok.type === 'wiki') {
          const targetId = resolveWiki(tok.value);
          if (!targetId) {
            return <span key={i} className="kv-inline-token is-unresolved">{tok.raw}</span>;
          }
          return (
            <button key={i} type="button" className="kv-inline-token" onClick={() => onSelectNode(targetId)}>
              {tok.raw}
            </button>
          );
        }
        if (tok.type === 'tag') {
          return (
            <button key={i} type="button" className="kv-inline-token is-tag" onClick={() => onSelectNode(`tag:${tok.value}`)}>
              {tok.raw}
            </button>
          );
        }
        return <Fragment key={i}>{tok.value}</Fragment>;
      })}
    </>
  );
}

export default function KnowledgeVault({
  subjectId,
  compact,
  onNavigateSubjectTab,
}: {
  subjectId?: string;
  compact?: boolean;
  onNavigateSubjectTab?: (tab: string) => void;
}) {
  const [data, setData] = useState<KnowledgeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');

  const [enabledKinds, setEnabledKinds] = useState<Set<KnowledgeNodeKind>>(() => new Set(ALL_KINDS));
  const [search, setSearch] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [scopeToNode, setScopeToNode] = useState(true);
  const [vaultTab, setVaultTab] = useState<VaultTab>('all');

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragPositions, setDragPositions] = useState<Record<string, Point>>({});
  const [isPanning, setIsPanning] = useState(false);

  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<
    | { kind: 'pan'; startX: number; startY: number; baseX: number; baseY: number; moved: boolean }
    | { kind: 'node'; id: string; startX: number; startY: number; baseX: number; baseY: number; moved: boolean }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await skillsGet<KnowledgeResponse>({ knowledge: '1', ...(subjectId ? { subject: subjectId } : {}) });
      setData(res);
      setSignedOut(false);
      setDragPositions({});
      setSelectedNodeId((prev) => {
        if (prev && res.graph.nodes.some((n) => n.id === prev)) return prev;
        if (subjectId && res.graph.nodes.some((n) => n.id === `sub:${subjectId}`)) return `sub:${subjectId}`;
        return res.graph.nodes.find((n) => n.kind === 'subject')?.id ?? res.graph.nodes[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof SignedOut) setSignedOut(true);
      else setError(e instanceof Error ? e.message : 'Couldn’t load knowledge vault.');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Attach non-passive wheel listener for smooth zoom without console warnings.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      setZoom((z) => Math.max(0.35, Math.min(3.2, Math.round(z * factor * 100) / 100)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [data]);

  const nodesById = useMemo(() => new Map((data?.graph.nodes ?? []).map((n) => [n.id, n])), [data]);

  const kindCounts = useMemo(() => {
    const counts = new Map<KnowledgeNodeKind, number>();
    for (const n of data?.graph.nodes ?? []) {
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const visibleNodes = useMemo(() => {
    const nodes = data?.graph.nodes ?? [];
    return nodes.filter((n) => enabledKinds.has(n.kind));
  }, [data, enabledKinds]);

  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    const edges = data?.graph.edges ?? [];
    return edges.filter((e) => visibleNodeSet.has(e.from) && visibleNodeSet.has(e.to));
  }, [data, visibleNodeSet]);

  const basePositions = useMemo(() => {
    if (!data) return {};
    return computeLayout(data.graph.nodes, data.graph.edges, subjectId);
  }, [data, subjectId]);

  const positions = useMemo(() => {
    const merged: Record<string, Point> = { ...basePositions };
    for (const [id, pt] of Object.entries(dragPositions)) {
      if (merged[id]) merged[id] = pt;
    }
    return merged;
  }, [basePositions, dragPositions]);

  const query = search.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!query || !data) return [];
    return data.graph.nodes
      .filter((n) =>
        n.label.toLowerCase().includes(query)
        || (n.subtitle?.toLowerCase().includes(query) ?? false)
        || (n.excerpt?.toLowerCase().includes(query) ?? false)
        || n.tags.some((t) => t.includes(query.replace(/^#/, ''))),
      )
      .slice(0, 12);
  }, [data, query]);

  const searchHitIds = useMemo(() => new Set(searchHits.map((n) => n.id)), [searchHits]);

  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const neighborhood = useMemo(() => {
    const set = new Set<string>();
    if (!activeNodeId) return set;
    set.add(activeNodeId);
    for (const e of visibleEdges) {
      if (e.from === activeNodeId) set.add(e.to);
      if (e.to === activeNodeId) set.add(e.from);
    }
    return set;
  }, [activeNodeId, visibleEdges]);

  const resolveWiki = useCallback(
    (target: string): string | undefined => {
      const k = target.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!data) return undefined;
      for (const n of data.graph.nodes) {
        if (n.label.trim().replace(/\s+/g, ' ').toLowerCase() === k) return n.id;
      }
      return undefined;
    },
    [data],
  );

  const selectAndFocus = useCallback(
    (nodeId: string) => {
      const target = nodesById.get(nodeId);
      if (target && !enabledKinds.has(target.kind)) {
        setEnabledKinds((prev) => {
          const next = new Set(prev);
          next.add(target.kind);
          return next;
        });
      }
      setSelectedNodeId(nodeId);
      setScopeToNode(true);
      const pt = positions[nodeId];
      if (pt) {
        setPan({ x: (CX - pt.x) * zoom, y: (CY - pt.y) * zoom });
      }
    },
    [nodesById, enabledKinds, positions, zoom],
  );

  const fitGraph = useCallback(() => {
    const pts = visibleNodes.map((n) => positions[n.id]).filter(Boolean);
    if (!pts.length) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = Math.max(120, maxX - minX + 90);
    const spanY = Math.max(120, maxY - minY + 90);
    const nextZoom = Math.max(0.45, Math.min(2, Math.min(VIEW_W / spanX, VIEW_H / spanY)));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    setZoom(Math.round(nextZoom * 100) / 100);
    setPan({ x: (CX - midX) * nextZoom, y: (CY - midY) * nextZoom });
  }, [visibleNodes, positions]);

  const unitPerPx = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return 1;
    return Math.max(VIEW_W / rect.width, VIEW_H / rect.height);
  };

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, moved: false };
    setIsPanning(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onNodePointerDown(nodeId: string, e: React.PointerEvent<SVGGElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = positions[nodeId] ?? { x: CX, y: CY };
    dragRef.current = { kind: 'node', id: nodeId, startX: e.clientX, startY: e.clientY, baseX: pt.x, baseY: pt.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) >= 4) drag.moved = true;
    if (!drag.moved) return;
    const s = unitPerPx();
    if (drag.kind === 'pan') {
      setPan({ x: drag.baseX + dx * s, y: drag.baseY + dy * s });
    } else {
      setDragPositions((prev) => ({
        ...prev,
        [drag.id]: {
          x: Math.max(20, Math.min(VIEW_W - 20, drag.baseX + (dx * s) / zoom)),
          y: Math.max(20, Math.min(VIEW_H - 20, drag.baseY + (dy * s) / zoom)),
        },
      }));
    }
  }

  function onSvgPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsPanning(false);
    if (drag?.kind === 'node' && !drag.moved) {
      setSelectedNodeId(drag.id);
      setScopeToNode(true);
    }
  }

  function renderNavAction(label: string, href?: string) {
    if (!href) return null;
    if (subjectId && onNavigateSubjectTab && href.startsWith(`/skills/${subjectId}`)) {
      const parsed = new URL(href, 'https://local.test');
      const tab = parsed.searchParams.get('tab') ?? 'overview';
      return (
        <button type="button" className="sk-small-btn" onClick={() => onNavigateSubjectTab(tab)}>
          {label}
        </button>
      );
    }
    return <Link className="sk-small-btn" href={href}>{label}</Link>;
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;

  const { filteredKnowledge, filteredMaterials, filteredQa, incomingBacklinks, outgoingEdges } = useMemo(() => {
    const bundle = data?.bundle;
    if (!bundle) {
      return {
        filteredKnowledge: [] as KnowledgeMaterialItem[],
        filteredMaterials: [] as KnowledgeMaterialItem[],
        filteredQa: [] as KnowledgeMaterialItem[],
        incomingBacklinks: [] as KnowledgeBacklink[],
        outgoingEdges: [] as KnowledgeEdge[],
      };
    }

    const active = selectedNode && scopeToNode ? selectedNode : null;
    const isWholeSubjectNode = active?.kind === 'subject' && active.subjectId === subjectId;

    const matchesItem = (item: KnowledgeMaterialItem): boolean => {
      if (!active || isWholeSubjectNode) return true;
      if (item.nodeId === active.id) return true;
      if (active.kind === 'subject' && item.subjectId === active.subjectId) return true;
      if (active.kind === 'topic' && item.topicId === active.topicId) return true;
      if ((active.kind === 'book' || active.kind === 'paper' || active.kind === 'project' || active.kind === 'resource') && item.resourceId === active.resourceId) {
        return true;
      }
      if (active.kind === 'reader' && item.nodeId === active.id) return true;
      if (active.kind === 'tag' && active.tags[0] && item.tags.includes(active.tags[0])) return true;
      return false;
    };

    const incoming = active ? (bundle.backlinks[active.id] ?? []) : Object.values(bundle.backlinks).flat().slice(0, 40);
    const outgoing = active ? (data?.graph.edges ?? []).filter((e) => e.from === active.id) : [];

    return {
      filteredKnowledge: bundle.ownKnowledge.filter(matchesItem),
      filteredMaterials: bundle.sourceMaterials.filter(matchesItem),
      filteredQa: bundle.qaAndActivities.filter(matchesItem),
      incomingBacklinks: incoming,
      outgoingEdges: outgoing,
    };
  }, [data, selectedNode, scopeToNode, subjectId]);

  if (signedOut) return <SignedOutCard />;
  if (loading) return <Loading rows={3} />;
  if (error) {
    return (
      <div className="kv-root">
        <ErrorNote>{error}</ErrorNote>
        <div className="sk-actions">
          <button type="button" className="sk-small-btn" onClick={() => void load()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!data || !data.graph.nodes.length) {
    return (
      <section className="sk-card">
        <h2>Knowledge Vault</h2>
        <p className="sk-empty">
          No notes, topics, books, or links in this vault yet. Add topics, tie Notes pages, link Reader books, or write{' '}
          <code>[[Wiki-links]]</code> and <code>#tags</code> in your notes to grow the graph.
        </p>
      </section>
    );
  }

  return (
    <div className={`kv-root${compact ? ' is-compact' : ''}`}>
      <div className="kv-toolbar">
        <div className="kv-toolbar-top">
          <div className="kv-search-wrap">
            <input
              type="search"
              className="kv-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills, topics, books, notes, #tags…"
              aria-label="Search knowledge graph"
            />
            {search && (
              <button type="button" className="kv-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>
          <div className="kv-toolbar-actions">
            <button type="button" className="sk-small-btn" onClick={() => setEnabledKinds(new Set(ALL_KINDS))}>All types</button>
            <button
              type="button"
              className="sk-small-btn"
              onClick={() => setEnabledKinds(new Set<KnowledgeNodeKind>(['subject', 'topic', 'book', 'paper', 'project', 'note', 'reader']))}
            >
              Core only
            </button>
            <button type="button" className="sk-small-btn" onClick={() => { setDragPositions({}); fitGraph(); }}>
              Reset layout
            </button>
            <button type="button" className="sk-small-btn" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>

        <div className="kv-filters" role="group" aria-label="Node type filters">
          {ALL_KINDS.filter((k) => (kindCounts.get(k) ?? 0) > 0).map((kind) => {
            const meta = KIND_META[kind];
            const on = enabledKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`kv-filter-pill${on ? ' is-on' : ''}`}
                style={{ '--kv-dot': meta.color } as React.CSSProperties}
                aria-pressed={on}
                onClick={() => {
                  setEnabledKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  });
                }}
              >
                <span className="kv-dot" aria-hidden />
                <span>{meta.label}</span>
                <span className="sk-muted">{kindCounts.get(kind)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="kv-split">
        <div className="kv-graph-card" ref={canvasWrapRef}>
          <div className="kv-graph-hud">
            <span className="kv-graph-stats">
              {visibleNodes.length} nodes · {visibleEdges.length} links
            </span>
            <div className="kv-zoom-bar" aria-label="Graph zoom controls">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.35, Math.round((z - 0.15) * 100) / 100))}>−</button>
              <button type="button" aria-label="Reset zoom" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3.2, Math.round((z + 0.15) * 100) / 100))}>+</button>
              <button type="button" onClick={fitGraph}>Fit</button>
            </div>
          </div>

          {query && searchHits.length > 0 && (
            <div className="kv-search-hits" role="listbox" aria-label="Matching nodes">
              {searchHits.map((hit) => {
                const meta = KIND_META[hit.kind];
                return (
                  <button
                    key={hit.id}
                    type="button"
                    className="kv-search-hit"
                    onClick={() => { selectAndFocus(hit.id); setSearch(''); }}
                  >
                    <span className="kv-dot" style={{ '--kv-dot': meta.color } as React.CSSProperties} aria-hidden />
                    <span>{hit.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <svg
            ref={svgRef}
            className={`kv-svg${isPanning ? ' is-panning' : ''}`}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label="Interactive Knowledge Graph"
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerCancel={onSvgPointerUp}
          >
            <defs>
              <marker id="kv-arrow" viewBox="0 0 10 10" refX="14" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--muted)" opacity="0.7" />
              </marker>
            </defs>

            <g transform={`translate(${CX + pan.x}, ${CY + pan.y}) scale(${zoom}) translate(${-CX}, ${-CY})`}>
              {visibleEdges.map((edge) => {
                const a = positions[edge.from];
                const b = positions[edge.to];
                if (!a || !b) return null;
                const touchesActive = activeNodeId ? edge.from === activeNodeId || edge.to === activeNodeId : false;
                const dimmed = !!activeNodeId && !touchesActive;
                return (
                  <line
                    key={edge.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={`kv-edge is-${edge.kind}${touchesActive ? ' is-highlighted' : ''}${dimmed ? ' is-dimmed' : ''}`}
                    markerEnd={edge.kind === 'subskill' || edge.kind === 'wiki-link' ? 'url(#kv-arrow)' : undefined}
                  />
                );
              })}

              {visibleNodes.map((node) => {
                const pt = positions[node.id];
                if (!pt) return null;
                const meta = KIND_META[node.kind];
                const isSelected = node.id === selectedNodeId;
                const isHit = searchHitIds.has(node.id);
                const dimmed = !!activeNodeId && !neighborhood.has(node.id) && !isHit;
                const showLabel =
                  node.kind === 'subject'
                  || isSelected
                  || node.id === hoveredNodeId
                  || isHit
                  || neighborhood.has(node.id)
                  || visibleNodes.length <= 36
                  || zoom >= 1.25;

                const shortLabel = node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label;
                return (
                  <g
                    key={node.id}
                    className={`kv-node${isSelected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
                    transform={`translate(${pt.x}, ${pt.y})`}
                    onPointerDown={(e) => onNodePointerDown(node.id, e)}
                    onPointerEnter={() => setHoveredNodeId(node.id)}
                    onPointerLeave={() => setHoveredNodeId((cur) => (cur === node.id ? null : cur))}
                  >
                    {(isSelected || isHit) && <circle className="kv-node-ring" r={meta.radius + 5} />}
                    <circle
                      className="kv-node-circle"
                      r={isSelected ? meta.radius + 2 : meta.radius}
                      fill={meta.color}
                    />
                    {showLabel && (
                      <text className="kv-node-label" y={meta.radius + 13} textAnchor="middle">
                        {shortLabel}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="kv-graph-legend">
            <span className="kv-graph-hint">Click node to inspect · Drag node to rearrange · Drag background to pan · Scroll to zoom</span>
          </div>
        </div>

        <aside className="kv-inspector" aria-label="Vault inspector">
          <div className="kv-node-header">
            {selectedNode ? (
              <>
                <div className="kv-node-title-row">
                  <div>
                    <span
                      className="kv-kind-badge"
                      style={{ '--kv-dot': KIND_META[selectedNode.kind].color } as React.CSSProperties}
                    >
                      <span aria-hidden>{KIND_META[selectedNode.kind].icon}</span>
                      <span>{KIND_META[selectedNode.kind].label}</span>
                    </span>
                    <h3>{selectedNode.label}</h3>
                    {selectedNode.subtitle && <p className="sk-muted">{selectedNode.subtitle}</p>}
                  </div>
                  <div className="sk-actions">
                    {selectedNode.kind !== 'subject' && (
                      <button
                        type="button"
                        className="sk-text-btn"
                        onClick={() => setScopeToNode((s) => !s)}
                      >
                        {scopeToNode ? 'Show whole vault' : 'Filter to node'}
                      </button>
                    )}
                    {subjectId && selectedNode.id !== `sub:${subjectId}` && (
                      <button
                        type="button"
                        className="sk-text-btn"
                        onClick={() => selectAndFocus(`sub:${subjectId}`)}
                      >
                        Back to skill
                      </button>
                    )}
                  </div>
                </div>

                {selectedNode.content && (
                  <div className="kv-node-body">
                    <RichText text={selectedNode.content} resolveWiki={resolveWiki} onSelectNode={selectAndFocus} />
                  </div>
                )}

                <AttachmentList attachments={selectedNode.attachments} />

                <div className="sk-actions">
                  {renderNavAction('Open →', selectedNode.href)}
                  {selectedNode.url && (
                    <a className="sk-small-btn" href={selectedNode.url} target="_blank" rel="noopener noreferrer">
                      Source Link ↗
                    </a>
                  )}
                  {selectedNode.freePdfUrl && (
                    <a className="sk-small-btn" href={selectedNode.freePdfUrl} target="_blank" rel="noopener noreferrer">
                      Free PDF ↗
                    </a>
                  )}
                  {selectedNode.youtubeAudioUrl && (
                    <a className="sk-small-btn" href={selectedNode.youtubeAudioUrl} target="_blank" rel="noopener noreferrer">
                      Audio / Lectures ↗
                    </a>
                  )}
                </div>
              </>
            ) : (
              <div>
                <h3>{subjectId ? 'Skill Knowledge Vault' : 'Whole Knowledge Vault'}</h3>
                <p className="sk-hint">Select any node on the graph to inspect its notes, materials, Q&As, and backlinks.</p>
              </div>
            )}
          </div>

          <div className="kv-section-tabs" role="tablist" aria-label="Vault sections">
            {([
              { id: 'all', label: 'All' },
              { id: 'knowledge', label: `My Knowledge (${filteredKnowledge.length})` },
              { id: 'materials', label: `Materials (${filteredMaterials.length})` },
              { id: 'qa', label: `Q&As & Steps (${filteredQa.length})` },
              { id: 'connections', label: `Backlinks (${incomingBacklinks.length + outgoingEdges.length})` },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className="kv-section-tab"
                aria-selected={vaultTab === tab.id}
                onClick={() => setVaultTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(vaultTab === 'all' || vaultTab === 'knowledge') && (
            <section className="kv-section" aria-label="My Knowledge">
              <div className="kv-section-head">
                <h4>1. My Knowledge</h4>
                <span className="sk-muted">{filteredKnowledge.length}</span>
              </div>
              {filteredKnowledge.length === 0 ? (
                <p className="sk-hint">No notes, Reader highlights, takeaways, or project logs in this selection yet.</p>
              ) : (
                <ul className="kv-item-list">
                  {filteredKnowledge.map((item) => (
                    <li key={item.id} className="kv-item-card">
                      <div className="kv-item-top">
                        <span className="sk-chip">{SOURCE_LABEL[item.sourceKind]}</span>
                        {item.day && <span className="sk-muted">{item.day}</span>}
                      </div>
                      <div className="kv-item-title">{item.title}</div>
                      {item.subtitle && <div className="sk-muted">{item.subtitle}</div>}
                      {item.text && (
                        <p className="kv-item-text">
                          <RichText text={item.text} resolveWiki={resolveWiki} onSelectNode={selectAndFocus} />
                        </p>
                      )}
                      <AttachmentList attachments={item.attachments} />
                      <div className="sk-actions">
                        <button type="button" className="sk-text-btn" onClick={() => selectAndFocus(item.nodeId)}>
                          Focus node
                        </button>
                        {renderNavAction('Open ↗', item.href)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(vaultTab === 'all' || vaultTab === 'materials') && (
            <section className="kv-section" aria-label="Source Materials">
              <div className="kv-section-head">
                <h4>2. Source Materials</h4>
                <span className="sk-muted">{filteredMaterials.length}</span>
              </div>
              {filteredMaterials.length === 0 ? (
                <p className="sk-hint">No books, papers, courses, or Reader items in this selection.</p>
              ) : (
                <ul className="kv-item-list">
                  {filteredMaterials.map((item) => (
                    <li key={item.id} className="kv-item-card">
                      <div className="kv-item-top">
                        <span className="sk-chip">{SOURCE_LABEL[item.sourceKind]}</span>
                        {item.status && <span className="sk-muted">{item.status}</span>}
                      </div>
                      <div className="kv-item-title">{item.title}</div>
                      {item.subtitle && <div className="sk-muted">{item.subtitle}</div>}
                      {item.text && (
                        <p className="kv-item-text">
                          <RichText text={item.text} resolveWiki={resolveWiki} onSelectNode={selectAndFocus} />
                        </p>
                      )}
                      <div className="sk-actions">
                        <button type="button" className="sk-text-btn" onClick={() => selectAndFocus(item.nodeId)}>
                          Focus node
                        </button>
                        {renderNavAction(item.sourceKind === 'reader-book' ? 'Open in Reader ↗' : 'Open ↗', item.href)}
                        {item.url && (
                          <a className="sk-small-btn" href={item.url} target="_blank" rel="noopener noreferrer">
                            Link ↗
                          </a>
                        )}
                        {item.freePdfUrl && (
                          <a className="sk-small-btn" href={item.freePdfUrl} target="_blank" rel="noopener noreferrer">
                            Free PDF ↗
                          </a>
                        )}
                        {item.youtubeAudioUrl && (
                          <a className="sk-small-btn" href={item.youtubeAudioUrl} target="_blank" rel="noopener noreferrer">
                            Audio ↗
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(vaultTab === 'all' || vaultTab === 'qa') && (
            <section className="kv-section" aria-label="Q&As and Steps">
              <div className="kv-section-head">
                <h4>3. Q&As &amp; Steps</h4>
                <span className="sk-muted">{filteredQa.length}</span>
              </div>
              {filteredQa.length === 0 ? (
                <p className="sk-hint">No questions, flashcards, study steps, or activities in this selection.</p>
              ) : (
                <ul className="kv-item-list">
                  {filteredQa.map((item) => (
                    <li key={item.id} className="kv-item-card">
                      <div className="kv-item-top">
                        <span className="sk-chip">{SOURCE_LABEL[item.sourceKind]}</span>
                        {item.status && <span className="sk-muted">{item.status}</span>}
                      </div>
                      <div className="kv-item-title">{item.title}</div>
                      {item.subtitle && <div className="sk-muted">{item.subtitle}</div>}
                      {item.text && (
                        <p className="kv-item-text">
                          <RichText text={item.text} resolveWiki={resolveWiki} onSelectNode={selectAndFocus} />
                        </p>
                      )}
                      <div className="sk-actions">
                        <button type="button" className="sk-text-btn" onClick={() => selectAndFocus(item.nodeId)}>
                          Focus node
                        </button>
                        {renderNavAction(item.sourceKind === 'question' || item.sourceKind === 'card' ? 'Practice ↗' : 'Open ↗', item.href)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(vaultTab === 'all' || vaultTab === 'connections') && (
            <section className="kv-section" aria-label="Connections and Backlinks">
              <div className="kv-section-head">
                <h4>4. Connections &amp; Backlinks</h4>
                <span className="sk-muted">{incomingBacklinks.length + outgoingEdges.length}</span>
              </div>

              {incomingBacklinks.length > 0 && (
                <div>
                  <p className="sk-muted">Incoming backlinks ({incomingBacklinks.length})</p>
                  <div className="kv-link-pills">
                    {incomingBacklinks.map((bl, idx) => {
                      const meta = KIND_META[bl.sourceKind];
                      return (
                        <button
                          key={`${bl.sourceId}-${bl.edgeKind}-${idx}`}
                          type="button"
                          className="kv-conn-btn"
                          onClick={() => selectAndFocus(bl.sourceId)}
                        >
                          <span className="kv-dot" style={{ '--kv-dot': meta.color } as React.CSSProperties} aria-hidden />
                          <span>{bl.sourceLabel}</span>
                          <span className="sk-muted">← {EDGE_LABEL[bl.edgeKind]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {outgoingEdges.length > 0 && (
                <div>
                  <p className="sk-muted">Outgoing connections ({outgoingEdges.length})</p>
                  <div className="kv-link-pills">
                    {outgoingEdges.map((edge) => {
                      const target = nodesById.get(edge.to);
                      if (!target) return null;
                      const meta = KIND_META[target.kind];
                      return (
                        <button
                          key={edge.id}
                          type="button"
                          className="kv-conn-btn"
                          onClick={() => selectAndFocus(target.id)}
                        >
                          <span className="kv-dot" style={{ '--kv-dot': meta.color } as React.CSSProperties} aria-hidden />
                          <span>{target.label}</span>
                          <span className="sk-muted">· {EDGE_LABEL[edge.kind]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedNode && selectedNode.wikiLinks.length > 0 && (
                <div>
                  <p className="sk-muted">Wiki-links in text</p>
                  <div className="kv-link-pills">
                    {selectedNode.wikiLinks.map((wl) => {
                      const targetId = resolveWiki(wl);
                      if (!targetId) {
                        return (
                          <span key={wl} className="kv-inline-token is-unresolved">
                            [[{wl}]] (unlinked)
                          </span>
                        );
                      }
                      return (
                        <button key={wl} type="button" className="kv-inline-token" onClick={() => selectAndFocus(targetId)}>
                          [[{wl}]]
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {incomingBacklinks.length === 0 && outgoingEdges.length === 0 && (
                <p className="sk-hint">
                  No links on this node yet. Mention <code>[[Topic or Skill]]</code> or <code>#tag</code> in notes, takeaways, or project logs to link ideas together.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
