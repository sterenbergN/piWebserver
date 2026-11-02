'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import type { Notebook, PageRecord, TemplateId } from '@/lib/notes/items';
import { listLibrary } from './db';
import type { NotebookDoc } from './doc';
import { Glyph, TagEditor } from './Connect';
import { allTags, copyPageToNotebook, isNotebook, notebookOutline } from './notebooks';
import { Assets, renderPage } from './paper';
import { PaperSwatches, TemplateGrid } from './TemplatePicker';

// Every page in the notebook as a picture: go to one, drag it somewhere else, bookmark it, give
// it a title or tags you can search for, change its paper, or copy it to another notebook. The
// outline is the notebook's table of contents: page titles, and headings lassoed in the writing.

type Filter = 'all' | 'marked' | 'outline';
type OutlineEntry = Awaited<ReturnType<typeof notebookOutline>>[number];

const THUMB_WIDTH = 180;

function Thumb({ doc, page, assets }: { doc: NotebookDoc; page: PageRecord; assets: Assets }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = doc.version(page.id);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Only drawn once it's scrolled into view: a notebook can have hundreds of pages.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    void doc.ensure(page.id).then(async () => {
      const canvas = ref.current;
      if (!live || !canvas) return;
      const scale = (THUMB_WIDTH * Math.min(window.devicePixelRatio || 1, 2)) / page.w;
      const paint = document.createElement('canvas');
      await renderPage(paint, page, doc.elementsOf(page.id), assets, scale);
      if (!live) return;
      canvas.width = paint.width;
      canvas.height = paint.height;
      canvas.getContext('2d')?.drawImage(paint, 0, 0);
    });
    return () => { live = false; };
  }, [seen, version, page, doc, assets]);

  return <canvas ref={ref} className="nt-thumb" style={{ aspectRatio: `${page.w} / ${page.h}` }} />;
}

export default function PagesPanel({ doc, notebook, current, onGo, onClose, onSay }: {
  doc: NotebookDoc;
  notebook: string;
  current: string;
  onGo: (page: string, box?: { x: number; y: number; w: number; h: number }) => void;
  onClose: () => void;
  onSay: (text: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [menu, setMenu] = useState<PageRecord | null>(null);
  const [mode, setMode] = useState<'menu' | 'title' | 'paper' | 'copy' | 'tags'>('menu');
  const [title, setTitle] = useState('');
  const [others, setOthers] = useState<Notebook[]>([]);
  const [drag, setDrag] = useState<{ id: string; over: number; x: number; y: number } | null>(null);
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const assets = useMemo(() => new Assets(notebook, () => setTick((t) => t + 1)), [notebook]);

  useEffect(() => () => assets.destroy(), [assets]);
  useEffect(() => doc.subscribe(() => setTick((t) => t + 1)), [doc]);
  useEffect(() => {
    listRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }, []);

  useEffect(() => {
    if (filter === 'outline') void notebookOutline(notebook).then(setOutline);
  }, [filter, notebook, menu]);
  useEffect(() => { void allTags().then((tags) => setKnownTags(tags.map((t) => t.name))); }, [menu]);

  const pages = doc.pages;
  const tagsHere = [...new Set(pages.flatMap((page) => page.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const tagged = (page: PageRecord) => !tagFilter || (page.tags ?? []).some((t) => t.toLowerCase() === tagFilter.toLowerCase());
  const shown = (filter === 'marked' ? pages.filter((page) => page.starred) : pages).filter(tagged);

  const saveTags = (page: PageRecord, tags: string[]) => {
    const { tags: _old, ...rest } = page;
    const after = { ...rest, ...(tags.length ? { tags } : {}), updatedAt: Date.now() };
    doc.apply([{ type: 'book', before: page, after }]);
    setMenu(after);
  };

  const openMenu = (page: PageRecord) => {
    setMenu(page);
    setMode('menu');
    setTitle(page.title ?? '');
  };

  const closeMenu = () => setMenu(null);

  const toggleBookmark = (page: PageRecord) => {
    const { starred: _starred, ...rest } = page;
    if (page.starred) doc.apply([{ type: 'book', before: page, after: { ...rest, updatedAt: Date.now() } }]);
    else doc.updatePage(page, { starred: true });
    closeMenu();
  };

  const saveTitle = (page: PageRecord) => {
    const { title: _old, ...rest } = page;
    const clean = title.trim();
    doc.apply([{ type: 'book', before: page, after: { ...rest, ...(clean ? { title: clean } : {}), updatedAt: Date.now() } }]);
    closeMenu();
  };

  // Drag a page by its handle. Where it lands is worked out from what's under the finger.
  const startDrag = (e: React.PointerEvent, page: PageRecord) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* It just isn't captured. */ }
    setDrag({ id: page.id, over: pages.findIndex((p) => p.id === page.id), x: e.clientX, y: e.clientY });
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-index]');
    const over = under ? Number(under.dataset.index) : drag.over;
    setDrag({ ...drag, over, x: e.clientX, y: e.clientY });
    const list = listRef.current;
    if (list) {
      const box = list.getBoundingClientRect();
      if (e.clientY < box.top + 50) list.scrollTop -= 12;
      if (e.clientY > box.bottom - 50) list.scrollTop += 12;
    }
  };

  const endDrag = () => {
    if (!drag) return;
    const page = pages.find((p) => p.id === drag.id);
    const from = pages.findIndex((p) => p.id === drag.id);
    if (page && drag.over !== from) doc.movePage(page, drag.over);
    setDrag(null);
  };

  return (
    <>
      <div className="nt-sheet-head">
        <strong>Pages</strong>
        <div className="nt-tabs is-small">
          <button type="button" className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>All</button>
          <button type="button" className={filter === 'marked' ? 'is-on' : ''} onClick={() => setFilter('marked')}>Bookmarks</button>
          <button type="button" className={filter === 'outline' ? 'is-on' : ''} onClick={() => setFilter('outline')}>Outline</button>
        </div>
        <span className="nt-grow" />
        <button type="button" className="nt-icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </div>
      {filter !== 'outline' && tagsHere.length > 0 && (
        <div className="nt-tag-filter">
          <Glyph name="tag" />
          {tagsHere.map((tag) => (
            <button type="button" key={tag} className={`nt-chip${tagFilter === tag ? ' is-on' : ''}`} aria-pressed={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>#{tag}</button>
          ))}
        </div>
      )}
      {filter === 'outline' ? (
        <div className="nt-sheet-body">
          {!outline.length && <p className="nt-empty">Give a page a title, or lasso some writing and make it a heading, and it’s listed here like a table of contents.</p>}
          {outline.map((entry, i) => (
            <button type="button" key={`${entry.page}/${i}`} className={`nt-outline is-level-${entry.level}`} onClick={() => onGo(entry.page, entry.box)}>
              <span>{entry.label}</span>
              <small>{entry.pageNumber}</small>
            </button>
          ))}
        </div>
      ) : (
      <ul className="nt-pages" ref={listRef}>
        {!shown.length && <li className="nt-empty is-wide">{filter === 'marked' ? 'Bookmark a page with the ribbon at the top of the screen.' : 'No page has that tag.'}</li>}
        {shown.map((page) => {
          const index = pages.findIndex((p) => p.id === page.id);
          return (
            <li key={page.id} data-index={index} className={`nt-page-card${page.id === current ? ' is-current' : ''}${drag?.id === page.id ? ' is-dragging' : ''}${drag && drag.over === index && drag.id !== page.id ? ' is-over' : ''}`}>
              <button type="button" className="nt-page-open" aria-label={`Go to page ${index + 1}`} onClick={() => onGo(page.id)}>
                <Thumb doc={doc} page={page} assets={assets} />
                {page.starred && <span className="nt-page-mark"><Icon name="bookmark" /></span>}
              </button>
              <div className="nt-page-meta">
                {filter === 'all' && (
                  <button
                    type="button" className="nt-page-grip" aria-label={`Drag page ${index + 1}`}
                    onPointerDown={(e) => startDrag(e, page)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
                  >
                    <Icon name="list" />
                  </button>
                )}
                <span className="nt-page-name">{index + 1}{page.title ? ` · ${page.title}` : ''}{page.tags?.length ? <small> {page.tags.map((t) => `#${t}`).join(' ')}</small> : null}</span>
                <button type="button" className="nt-icon-btn is-small" aria-label={`More about page ${index + 1}`} onClick={() => openMenu(page)}><Icon name="more" /></button>
              </div>
            </li>
          );
        })}
      </ul>
      )}

      {menu && (
        <div className="nt-sheet-wrap is-center" onClick={closeMenu}>
          <div className="nt-menu is-wide" role="dialog" aria-label={`Page ${pages.findIndex((p) => p.id === menu.id) + 1}`} onClick={(e) => e.stopPropagation()}>
            {mode === 'menu' && (
              <>
                <p className="nt-menu-title">Page {pages.findIndex((p) => p.id === menu.id) + 1}{menu.title ? `: ${menu.title}` : ''}</p>
                <button type="button" onClick={() => setMode('title')}><Icon name="text" /> {menu.title ? 'Change title' : 'Give it a title'}</button>
                <button type="button" onClick={() => setMode('tags')}><Glyph name="tag" /> {menu.tags?.length ? `Tags: ${menu.tags.map((t) => `#${t}`).join(' ')}` : 'Add tags'}</button>
                <button type="button" onClick={() => toggleBookmark(menu)}><Icon name="bookmark" /> {menu.starred ? 'Remove bookmark' : 'Bookmark'}</button>
                {!menu.pdf && <button type="button" onClick={() => setMode('paper')}><Icon name="grid" /> Change paper</button>}
                <button type="button" onClick={() => { void doc.duplicatePage(menu).then(() => onSay('Page duplicated')); closeMenu(); }}><Icon name="copy" /> Duplicate</button>
                <button type="button" onClick={() => { void listLibrary().then((records) => setOthers(records.filter(isNotebook).filter((n) => !n.trashedAt && n.id !== notebook))); setMode('copy'); }}><Icon name="book" /> Copy to another notebook</button>
                <button type="button" disabled={pages.findIndex((p) => p.id === menu.id) === 0} onClick={() => { doc.movePage(menu, pages.findIndex((p) => p.id === menu.id) - 1); closeMenu(); }}><Icon name="left" /> Move earlier</button>
                <button type="button" disabled={pages.findIndex((p) => p.id === menu.id) === pages.length - 1} onClick={() => { doc.movePage(menu, pages.findIndex((p) => p.id === menu.id) + 1); closeMenu(); }}><Icon name="right" /> Move later</button>
                <button type="button" className="is-danger" disabled={pages.length < 2} onClick={() => { if (doc.deletePage(menu)) onSay('Page deleted. Undo brings it back.'); closeMenu(); }}><Icon name="trash" /> Delete page</button>
              </>
            )}
            {mode === 'title' && (
              <>
                <label className="nt-menu-title">
                  Page title
                  <input className="nt-input" value={title} autoFocus placeholder="Cranial nerves" maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(menu); }} />
                </label>
                <p className="nt-hint">Titles make a table of contents for the notebook, and they’re what search finds on a handwritten page.</p>
                <div className="nt-row">
                  <button type="button" className="nt-btn" onClick={closeMenu}>Cancel</button>
                  <span className="nt-grow" />
                  <button type="button" className="nt-btn is-primary" onClick={() => saveTitle(menu)}>Save</button>
                </div>
              </>
            )}
            {mode === 'tags' && (
              <>
                <p className="nt-menu-title">Tags<small>Find every page with a tag, in any notebook, under Tags in your notebooks.</small></p>
                <TagEditor tags={menu.tags ?? []} known={knownTags} onChange={(tags) => saveTags(menu, tags)} />
                <div className="nt-row">
                  <span className="nt-grow" />
                  <button type="button" className="nt-btn is-primary" onClick={closeMenu}>Done</button>
                </div>
              </>
            )}
            {mode === 'paper' && (
              <>
                <p className="nt-menu-title">Change paper</p>
                <PaperSwatches value={menu.paper} onPick={(paper) => { doc.updatePage(menu, { paper }); setMenu({ ...menu, paper }); }} />
                <TemplateGrid value={menu.template} paper={menu.paper} w={menu.w} h={menu.h} onPick={(template: TemplateId) => { doc.updatePage(menu, { template }); setMenu({ ...menu, template }); }} />
                <div className="nt-row is-wrap">
                  <button
                    type="button" className="nt-btn"
                    onClick={() => { doc.updatePages(doc.pages.filter((p) => !p.pdf), { template: menu.template, paper: menu.paper }); onSay('Every page changed. Undo brings them back.'); closeMenu(); }}
                  >Use on every page</button>
                  <span className="nt-grow" />
                  <button type="button" className="nt-btn is-primary" onClick={closeMenu}>Done</button>
                </div>
              </>
            )}
            {mode === 'copy' && (
              <>
                <p className="nt-menu-title">Copy to…</p>
                <div className="nt-menu-list">
                  {others.map((other) => (
                    <button type="button" key={other.id} onClick={() => { void copyPageToNotebook(notebook, menu, other.id).then(() => onSay(`Copied to ${other.title}`)); closeMenu(); }}><Icon name="book" /> {other.title}</button>
                  ))}
                  {!others.length && <p className="nt-empty">There’s no other notebook yet.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
