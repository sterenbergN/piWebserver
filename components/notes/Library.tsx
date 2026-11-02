'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/study/Icon';
import { useTheme } from '@/components/ThemeProvider';
import { folderPath, wouldNest, type Folder, type Notebook, type TemplateId } from '@/lib/notes/items';
import { listBook, listLibrary, livePages } from './db';
import {
  COVER_COLORS, createFolder, createNotebook, deleteFolder, deleteNotebookForever, duplicateNotebook, emptyOldTrash, importPdfNotebook, importPictureNotebook, isFolder, isNotebook, moveFolder, moveNotebook,
  allTags, notebookThumb, renameFolder, restoreNotebook, searchEverything, trashNotebook, updateNotebook, type SearchHit,
} from './notebooks';
import { Glyph } from './Connect';
import { exportPdf, safeFileName, shareOrSave } from './export';
import { watchNews, watchSync, type SyncState } from './sync';
import { PaperPicker, type PaperChoice } from './TemplatePicker';

// Your notebooks, in folders that can go as deep as you like. Everything here works with no
// connection, and every device catches up when there is one. Deleting goes to the trash first,
// since a semester of notes shouldn't be one mistaken tap from gone.

type View = { kind: 'folder'; folder: string | null } | { kind: 'starred' } | { kind: 'trash' } | { kind: 'tags' };
type Sort = 'edited' | 'title' | 'created';
type Dialog =
  | { kind: 'new-notebook' }
  | { kind: 'new-folder'; moving?: Notebook | Folder }
  | { kind: 'notebook'; notebook: Notebook }
  | { kind: 'rename-notebook'; notebook: Notebook }
  | { kind: 'cover'; notebook: Notebook }
  | { kind: 'folder'; folder: Folder }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'confirm-delete'; notebook: Notebook }
  | { kind: 'move'; item: Notebook | Folder };

const SORT_KEY = 'notes-sort';
const INSTALL_KEY = 'notes-install-hint';
const LAST_PAPER_KEY = 'notes-new-paper';

const DEFAULT_PAPER: PaperChoice = { template: 'ruled', paper: '#ffffff', w: 612, h: 792 };

function lastPaper(): PaperChoice {
  try {
    return { ...DEFAULT_PAPER, ...JSON.parse(localStorage.getItem(LAST_PAPER_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PAPER;
  }
}

function fmtWhen(ms: number, now = Date.now()) {
  const startOf = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(now) - startOf(ms)) / 86_400_000);
  if (days <= 0) return `Today, ${new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Cover({ notebook }: { notebook: Notebook }) {
  const [url, setUrl] = useState<string | null>(null);
  const stamp = Math.max(notebook.editedAt ?? 0, notebook.updatedAt);
  useEffect(() => {
    if (notebook.cover) return;
    let live = true;
    let made: string | null = null;
    void notebookThumb(notebook).then((blob) => {
      if (!blob || !live) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // A new thumbnail only when the notebook has actually changed.
  }, [notebook.id, notebook.cover, stamp]);
  if (notebook.cover) {
    return (
      <div className="nt-cover is-plain" style={{ background: notebook.cover }}>
        <span>{notebook.title}</span>
      </div>
    );
  }
  return url ? <img className="nt-cover" src={url} alt="" /> : <div className="nt-cover is-empty" />;
}

/** How to put the app on a home screen. Only shown where it isn't there yet. */
function InstallHint() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem(INSTALL_KEY) === 'no'; } catch { /* Private browsing. */ }
    if (installed || dismissed) return;
    const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIos(appleTouch);
    if (appleTouch) setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(INSTALL_KEY, 'no'); } catch { /* Private browsing. */ }
  };
  return (
    <div className="nt-banner">
      <Icon name="device" />
      <p>{ios ? <>To write full screen with no connection, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</> : 'Add Notes to your home screen to write full screen with no connection.'}</p>
      {prompt && <button type="button" className="nt-btn is-primary" onClick={() => { void prompt.prompt(); dismiss(); }}>Add</button>}
      <button type="button" className="nt-icon-btn" aria-label="Dismiss" onClick={dismiss}><Icon name="x" /></button>
    </div>
  );
}

function NameDialog({ title, placeholder, initial, action, onSave, onCancel }: { title: string; placeholder: string; initial: string; action: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="nt-menu" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <label className="nt-menu-title">
        {title}
        <input className="nt-input" value={name} autoFocus placeholder={placeholder} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSave(name); }} />
      </label>
      <div className="nt-row">
        <button type="button" className="nt-btn" onClick={onCancel}>Cancel</button>
        <span className="nt-grow" />
        <button type="button" className="nt-btn is-primary" onClick={() => onSave(name)}>{action}</button>
      </div>
    </div>
  );
}

function NewNotebookDialog({ folder, onCreate, onCancel }: { folder: string | null; onCreate: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [choice, setChoice] = useState<PaperChoice>(lastPaper);
  const [cover, setCover] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { localStorage.setItem(LAST_PAPER_KEY, JSON.stringify(choice)); } catch { /* It just won't remember. */ }
    onCreate(await createNotebook({ title, folder: folder ?? undefined, cover, template: choice.template as TemplateId, paper: choice.paper, w: choice.w, h: choice.h }));
  };
  return (
    <div className="nt-menu is-wide" role="dialog" aria-label="New notebook" onClick={(e) => e.stopPropagation()}>
      <label className="nt-menu-title">
        New notebook
        <input className="nt-input" value={title} autoFocus placeholder="Name it, or leave it for later" maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
      </label>
      <div className="nt-label">Cover</div>
      <div className="nt-swatches">
        <button type="button" className={`nt-chip${!cover ? ' is-on' : ''}`} aria-pressed={!cover} onClick={() => setCover(undefined)}>First page</button>
        {COVER_COLORS.map((color) => (
          <button key={color} type="button" className={`nt-swatch${cover === color ? ' is-on' : ''}`} aria-label={`Cover ${color}`} aria-pressed={cover === color} style={{ background: color }} onClick={() => setCover(color)} />
        ))}
      </div>
      <PaperPicker value={choice} onChange={setChoice} />
      <div className="nt-row">
        <button type="button" className="nt-btn" onClick={onCancel}>Cancel</button>
        <span className="nt-grow" />
        <button type="button" className="nt-btn is-primary" disabled={busy} onClick={() => void create()}>Create</button>
      </div>
    </div>
  );
}

const WHERE: Record<SearchHit['where'], string> = { title: '', page: ' · page title', text: '', pdf: ' · in the PDF', ink: ' · handwriting', mark: ' · link, heading or keyword', tag: ' · tag' };

/** Every tag in every notebook: pick one to see its pages. */
function TagsView({ onOpen }: { onOpen: (notebook: string, page?: string | null) => void }) {
  const [tags, setTags] = useState<Awaited<ReturnType<typeof allTags>> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { void allTags().then(setTags); }, []);
  if (!tags) return <p className="nt-empty">Gathering tags…</p>;
  if (!tags.length) return <p className="nt-empty">No tags yet. Tag a page from its menu in the Pages panel, or lasso a word you wrote and make it a keyword.</p>;
  const chosen = tags.find((tag) => tag.name === picked);
  return (
    <section>
      <div className="nt-tag-list">
        {tags.map((tag) => (
          <button type="button" key={tag.name} className={`nt-chip${picked === tag.name ? ' is-on' : ''}`} aria-pressed={picked === tag.name} onClick={() => setPicked(picked === tag.name ? null : tag.name)}>
            #{tag.name} <small>{tag.places.length}</small>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="nt-results">
          {chosen.places.map((place) => (
            <button type="button" key={`${place.notebook}/${place.page}`} className="nt-result" onClick={() => onOpen(place.notebook, place.page)}>
              <strong>{place.title}</strong>
              <small>Page {place.pageNumber}{place.label ? ` · ${place.label}` : ''}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Results({ query, onOpen }: { query: string; onOpen: (notebook: string, page: string | null) => void }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    setHits([]);
    setDone(false);
    const timer = setTimeout(() => {
      void searchEverything(query, (more) => setHits((held) => [...held, ...more]), () => live).then(() => { if (live) setDone(true); });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);
  return (
    <section className="nt-results">
      {hits.map((hit, i) => (
        <button type="button" key={`${hit.notebook}/${hit.page}/${i}`} className="nt-result" onClick={() => onOpen(hit.notebook, hit.page)}>
          <strong>{hit.title}</strong>
          {hit.page && <small>Page {hit.pageNumber}{WHERE[hit.where]}</small>}
          {hit.snippet && <span>{hit.snippet}</span>}
        </button>
      ))}
      {done && !hits.length && <p className="nt-empty">Nothing found. Search reads titles, typed text and imported PDFs. Handwriting can’t be searched, so giving a page a title is what makes it findable.</p>}
      {!done && !hits.length && <p className="nt-empty">Searching…</p>}
    </section>
  );
}

export default function Library({ online, signedOut, onOpen, onSignIn }: {
  online: boolean;
  signedOut: boolean;
  onOpen: (notebook: string, page?: string | null) => void;
  onSignIn: () => void;
}) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ kind: 'folder', folder: null });
  const [sort, setSort] = useState<Sort>('edited');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [sync, setSync] = useState<SyncState>('idle');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme } = useTheme();

  const load = useCallback(async () => {
    const records = await listLibrary();
    const list = records.filter(isNotebook);
    setNotebooks(list);
    setFolders(records.filter(isFolder));
    setLoaded(true);
    void emptyOldTrash(list);
  }, []);

  useEffect(() => {
    void load();
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved === 'title' || saved === 'created' || saved === 'edited') setSort(saved);
    } catch { /* Private browsing. */ }
    const stopNews = watchNews((news) => { if (news.library || news.notebook) void load(); });
    const stopSync = watchSync(setSync);
    return () => { stopNews(); stopSync(); };
  }, [load]);

  const currentFolder = view.kind === 'folder' ? view.folder : null;
  const crumbs = useMemo(() => folderPath(folders, currentFolder ?? undefined), [folders, currentFolder]);

  const sortBy = useCallback((a: Notebook, b: Notebook) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'created') return b.createdAt - a.createdAt;
    return Math.max(b.editedAt ?? 0, b.updatedAt) - Math.max(a.editedAt ?? 0, a.updatedAt);
  }, [sort]);

  const shown = useMemo(() => {
    const live = notebooks.filter((notebook) => !notebook.trashedAt);
    if (view.kind === 'trash') return notebooks.filter((notebook) => notebook.trashedAt).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    if (view.kind === 'starred') return live.filter((notebook) => notebook.starred).sort(sortBy);
    if (view.kind === 'tags') return [];
    // A folder that went away on another device mustn't strand what's in it.
    const known = new Set(folders.map((f) => f.id));
    return live.filter((notebook) => (notebook.folder && known.has(notebook.folder) ? notebook.folder : null) === view.folder).sort(sortBy);
  }, [notebooks, folders, view, sortBy]);

  const shownFolders = useMemo(() => {
    if (view.kind !== 'folder') return [];
    const known = new Set(folders.map((f) => f.id));
    return folders.filter((f) => (f.parent && known.has(f.parent) ? f.parent : null) === view.folder).sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, view]);

  const countIn = (folder: string) => notebooks.filter((n) => !n.trashedAt && n.folder === folder).length + folders.filter((f) => f.parent === folder).length;

  const act = async (work: () => Promise<unknown>) => {
    setDialog(null);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That didn’t work. Try again.');
    }
    await load();
  };

  const importFiles = async (files: FileList | File[]) => {
    setMessage('');
    let lastId = '';
    let count = 0;
    for (const file of [...files]) {
      setBusy(`Adding ${file.name}…`);
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf && !file.type.startsWith('image/')) throw new Error(`${file.name} isn’t a PDF or a picture.`);
        lastId = isPdf ? await importPdfNotebook(file, currentFolder ?? undefined) : await importPictureNotebook(file, currentFolder ?? undefined);
        count += 1;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `${file.name} wouldn’t open.`);
      }
    }
    setBusy('');
    await load();
    if (count === 1 && lastId) onOpen(lastId);
  };

  const quickNote = async () => {
    setAdding(false);
    const choice = lastPaper();
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    onOpen(await createNotebook({ title: `Quick note, ${today}`, folder: currentFolder ?? undefined, template: choice.template as TemplateId, paper: choice.paper, w: choice.w, h: choice.h }));
  };

  const exportNotebook = async (notebook: Notebook) => {
    setDialog(null);
    setMessage('');
    try {
      setBusy(`Making a PDF of ${notebook.title}…`);
      const pages = livePages(await listBook(notebook.id));
      const blob = await exportPdf(notebook.id, notebook.title, pages, { templates: true }, (done) => setBusy(`Making a PDF of ${notebook.title}: page ${done} of ${pages.length}`));
      setBusy('');
      setReady({ blob, name: `${safeFileName(notebook.title)}.pdf` });
    } catch (error) {
      setBusy('');
      setMessage(error instanceof Error ? error.message : 'That PDF wouldn’t make.');
    }
  };
  const [ready, setReady] = useState<{ blob: Blob; name: string } | null>(null);

  const moveTarget = (item: Notebook | Folder, folder: string | undefined) => (item.kind === 'notebook' ? moveNotebook(item, folder) : moveFolder(item, folder));

  const title = view.kind === 'tags' ? 'Tags' : view.kind === 'trash' ? 'Recently deleted' : view.kind === 'starred' ? 'Starred' : crumbs[crumbs.length - 1]?.name ?? 'Notes';

  return (
    <div
      className={`nt-library${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files); }}
    >
      <header className="nt-lib-head">
        <div className="nt-lib-title">
          <Link className="nt-site-link" href="/"><Icon name="left" size="0.9em" /> Site</Link>
          <h1>{title}</h1>
        </div>
        <span className="nt-grow" />
        {sync === 'syncing' && <span className="nt-sync">Saving…</span>}
        {!online && <span className="nt-sync"><Icon name="offline" /> Offline</span>}
        <button type="button" className="nt-icon-btn" aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}><Icon name="moon" /></button>
        <button type="button" className="nt-btn is-primary" onClick={() => setAdding(true)}><Icon name="plus" /> New</button>
      </header>

      <InstallHint />

      {signedOut && (
        <div className="nt-banner">
          <p>You’re signed out. Your notes are safe here, and they’ll save to your account when you sign back in.</p>
          <button type="button" className="nt-btn" onClick={onSignIn}>Sign in</button>
        </div>
      )}
      {message && (
        <div className="nt-banner is-error">
          <p>{message}</p>
          <button type="button" className="nt-icon-btn" aria-label="Dismiss" onClick={() => setMessage('')}><Icon name="x" /></button>
        </div>
      )}
      {busy && <div className="nt-banner"><p>{busy}</p></div>}
      {ready && (
        <div className="nt-banner">
          <p>{ready.name} is ready.</p>
          <button type="button" className="nt-btn is-primary" onClick={() => { void shareOrSave(ready.blob, ready.name); setReady(null); }}><Icon name="share" /> Share or save</button>
          <button type="button" className="nt-icon-btn" aria-label="Dismiss" onClick={() => setReady(null)}><Icon name="x" /></button>
        </div>
      )}

      <div className="nt-search">
        <Icon name="search" />
        <input type="search" placeholder="Search titles, typed text and PDFs" aria-label="Search your notes" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {query.trim() ? (
        <Results query={query} onOpen={(notebook, page) => onOpen(notebook, page)} />
      ) : (
        <>
          <div className="nt-filter">
            <button type="button" className={view.kind === 'folder' && !view.folder ? 'is-on' : ''} onClick={() => setView({ kind: 'folder', folder: null })}>All notebooks</button>
            <button type="button" className={view.kind === 'starred' ? 'is-on' : ''} onClick={() => setView({ kind: 'starred' })}><Icon name="star" /> Starred</button>
            <button type="button" className={view.kind === 'trash' ? 'is-on' : ''} onClick={() => setView({ kind: 'trash' })}><Icon name="trash" /> Recently deleted</button>
            <button type="button" className={view.kind === 'tags' ? 'is-on' : ''} onClick={() => setView({ kind: 'tags' })}><Glyph name="tag" /> Tags</button>
            <span className="nt-grow" />
            <label className="nt-sort">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => { const next = e.target.value as Sort; setSort(next); try { localStorage.setItem(SORT_KEY, next); } catch { /* Just for now, then. */ } }}>
                <option value="edited">Last edited</option>
                <option value="title">Name</option>
                <option value="created">Date made</option>
              </select>
            </label>
          </div>

          {view.kind === 'folder' && crumbs.length > 0 && (
            <nav className="nt-crumbs" aria-label="Folders">
              <button type="button" onClick={() => setView({ kind: 'folder', folder: null })}>All notebooks</button>
              {crumbs.map((crumb, i) => (
                <span key={crumb.id}>
                  <Icon name="chevron" size="0.8em" />
                  {i === crumbs.length - 1 ? (
                    <button type="button" className="is-here" onClick={() => setDialog({ kind: 'folder', folder: crumb })}>{crumb.name} <Icon name="more" size="0.9em" /></button>
                  ) : (
                    <button type="button" onClick={() => setView({ kind: 'folder', folder: crumb.id })}>{crumb.name}</button>
                  )}
                </span>
              ))}
            </nav>
          )}

          {view.kind === 'trash' && shown.length > 0 && <p className="nt-hint">Things here are deleted for good after 30 days.</p>}

          {view.kind === 'tags' && <TagsView onOpen={onOpen} />}

          {loaded && view.kind !== 'tags' && !shown.length && !shownFolders.length && (
            view.kind === 'folder' && !view.folder ? (
              <div className="nt-welcome">
                <Icon name="pencil" size="2.4rem" />
                <h2>Your first notebook</h2>
                <p>Make a notebook to write in, or bring in a PDF to write on. It all saves as you go, and works with no connection.</p>
                <button type="button" className="nt-btn is-primary" onClick={() => setAdding(true)}><Icon name="plus" /> New</button>
              </div>
            ) : (
              <p className="nt-empty">{view.kind === 'trash' ? 'Nothing’s been deleted.' : view.kind === 'starred' ? 'Star a notebook to keep it here.' : 'This folder is empty.'}</p>
            )
          )}

          <ul className="nt-shelf">
            {shownFolders.map((folder) => (
              <li key={folder.id} className="nt-card">
                <button type="button" className="nt-card-open" onClick={() => setView({ kind: 'folder', folder: folder.id })} aria-label={`Open folder ${folder.name}`}>
                  <div className="nt-cover is-folder"><Icon name="folder" size="3.2rem" /></div>
                </button>
                <div className="nt-card-meta">
                  <div>
                    <strong>{folder.name}</strong>
                    <span>{countIn(folder.id)} inside</span>
                  </div>
                  <button type="button" className="nt-icon-btn" aria-label={`More about ${folder.name}`} onClick={() => setDialog({ kind: 'folder', folder })}><Icon name="more" /></button>
                </div>
              </li>
            ))}
            {shown.map((notebook) => (
              <li key={notebook.id} className="nt-card">
                <button type="button" className="nt-card-open" disabled={view.kind === 'trash'} onClick={() => onOpen(notebook.id)} aria-label={`Open ${notebook.title}`}>
                  <Cover notebook={notebook} />
                  {notebook.starred && <span className="nt-card-star"><Icon name="star" /></span>}
                </button>
                <div className="nt-card-meta">
                  <div>
                    <strong>{notebook.title}</strong>
                    <span>{view.kind === 'trash' ? `Deleted ${fmtWhen(notebook.trashedAt ?? 0)}` : fmtWhen(Math.max(notebook.editedAt ?? 0, notebook.createdAt))}</span>
                  </div>
                  <button type="button" className="nt-icon-btn" aria-label={`More about ${notebook.title}`} onClick={() => setDialog({ kind: 'notebook', notebook })}><Icon name="more" /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <input
        ref={fileRef} type="file" hidden multiple accept="application/pdf,.pdf,image/*"
        onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }}
      />

      {adding && (
        <div className="nt-sheet-wrap is-center" onClick={() => setAdding(false)}>
          <div className="nt-menu" role="dialog" aria-label="New" onClick={(e) => e.stopPropagation()}>
            <p className="nt-menu-title">New</p>
            <button type="button" onClick={() => { setAdding(false); setDialog({ kind: 'new-notebook' }); }}><Icon name="book" /> Notebook</button>
            <button type="button" onClick={() => void quickNote()}><Icon name="pencil" /> Quick note</button>
            <button type="button" onClick={() => { setAdding(false); setDialog({ kind: 'new-folder' }); }}><Icon name="folder" /> Folder</button>
            <button type="button" onClick={() => { setAdding(false); fileRef.current?.click(); }}><Icon name="file" /> Import a PDF or picture</button>
          </div>
        </div>
      )}

      {dialog && (
        <div className="nt-sheet-wrap is-center" onClick={() => setDialog(null)}>
          {dialog.kind === 'new-notebook' && (
            <NewNotebookDialog folder={currentFolder} onCreate={(id) => { setDialog(null); onOpen(id); }} onCancel={() => setDialog(null)} />
          )}
          {dialog.kind === 'new-folder' && (
            <NameDialog
              title="New folder" placeholder="Anatomy, Semester 2…" initial="" action="Make it" onCancel={() => setDialog(null)}
              onSave={(name) => void act(async () => {
                const folder = await createFolder(name, dialog.moving ? undefined : currentFolder ?? undefined);
                if (dialog.moving) await moveTarget(dialog.moving, folder.id);
              })}
            />
          )}
          {dialog.kind === 'rename-notebook' && (
            <NameDialog title="Rename" placeholder="A name" initial={dialog.notebook.title} action="Save" onCancel={() => setDialog(null)} onSave={(name) => void act(() => updateNotebook(dialog.notebook, { title: name.trim() || dialog.notebook.title }))} />
          )}
          {dialog.kind === 'rename-folder' && (
            <NameDialog title="Rename folder" placeholder="A name" initial={dialog.folder.name} action="Save" onCancel={() => setDialog(null)} onSave={(name) => void act(() => renameFolder(dialog.folder, name))} />
          )}
          {dialog.kind === 'cover' && (
            <div className="nt-menu" role="dialog" aria-label="Cover" onClick={(e) => e.stopPropagation()}>
              <p className="nt-menu-title">Cover</p>
              <div className="nt-swatches">
                <button type="button" className={`nt-chip${!dialog.notebook.cover ? ' is-on' : ''}`} onClick={() => { const { cover: _cover, ...rest } = dialog.notebook; void act(() => updateNotebook(rest as Notebook, {})); }}>First page</button>
                {COVER_COLORS.map((color) => (
                  <button key={color} type="button" className={`nt-swatch${dialog.notebook.cover === color ? ' is-on' : ''}`} aria-label={`Cover ${color}`} style={{ background: color }} onClick={() => void act(() => updateNotebook(dialog.notebook, { cover: color }))} />
                ))}
              </div>
            </div>
          )}
          {dialog.kind === 'notebook' && (
            <div className="nt-menu" role="dialog" aria-label={dialog.notebook.title} onClick={(e) => e.stopPropagation()}>
              <p className="nt-menu-title">{dialog.notebook.title}</p>
              {dialog.notebook.trashedAt ? (
                <>
                  <button type="button" onClick={() => void act(() => restoreNotebook(dialog.notebook))}><Icon name="restore" /> Put back</button>
                  <button type="button" className="is-danger" onClick={() => setDialog({ kind: 'confirm-delete', notebook: dialog.notebook })}><Icon name="trash" /> Delete for good</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setDialog({ kind: 'rename-notebook', notebook: dialog.notebook })}><Icon name="pencil" /> Rename</button>
                  <button type="button" onClick={() => void act(() => updateNotebook(dialog.notebook, { starred: !dialog.notebook.starred }))}><Icon name="star" /> {dialog.notebook.starred ? 'Remove star' : 'Star'}</button>
                  <button type="button" onClick={() => setDialog({ kind: 'cover', notebook: dialog.notebook })}><Icon name="book" /> Change cover</button>
                  <button type="button" onClick={() => setDialog({ kind: 'move', item: dialog.notebook })}><Icon name="folder" /> Move to a folder</button>
                  <button type="button" onClick={() => void act(() => duplicateNotebook(dialog.notebook))}><Icon name="copy" /> Duplicate</button>
                  <button type="button" onClick={() => void exportNotebook(dialog.notebook)}><Icon name="share" /> Export as PDF</button>
                  <button type="button" className="is-danger" onClick={() => void act(() => trashNotebook(dialog.notebook))}><Icon name="trash" /> Delete</button>
                </>
              )}
            </div>
          )}
          {dialog.kind === 'confirm-delete' && (
            <div className="nt-menu" role="dialog" aria-label="Delete for good" onClick={(e) => e.stopPropagation()}>
              <p className="nt-menu-title">Delete “{dialog.notebook.title}” for good?<small>It goes from every device, and can’t be brought back.</small></p>
              <div className="nt-row">
                <button type="button" className="nt-btn" onClick={() => setDialog(null)}>Keep it</button>
                <span className="nt-grow" />
                <button type="button" className="nt-btn is-danger" onClick={() => void act(() => deleteNotebookForever(dialog.notebook))}>Delete for good</button>
              </div>
            </div>
          )}
          {dialog.kind === 'folder' && (
            <div className="nt-menu" role="dialog" aria-label={dialog.folder.name} onClick={(e) => e.stopPropagation()}>
              <p className="nt-menu-title">{dialog.folder.name}</p>
              <button type="button" onClick={() => setDialog({ kind: 'rename-folder', folder: dialog.folder })}><Icon name="pencil" /> Rename</button>
              <button type="button" onClick={() => setDialog({ kind: 'move', item: dialog.folder })}><Icon name="folder" /> Move into another folder</button>
              <button type="button" className="is-danger" onClick={() => void act(async () => { await deleteFolder(dialog.folder); if (currentFolder === dialog.folder.id) setView({ kind: 'folder', folder: dialog.folder.parent ?? null }); })}><Icon name="trash" /> Delete folder, keep what’s inside</button>
            </div>
          )}
          {dialog.kind === 'move' && (
            <div className="nt-menu" role="dialog" aria-label="Move" onClick={(e) => e.stopPropagation()}>
              <p className="nt-menu-title">Move “{dialog.item.kind === 'notebook' ? dialog.item.title : dialog.item.name}”</p>
              <div className="nt-menu-list">
                <button type="button" onClick={() => void act(() => moveTarget(dialog.item, undefined))}><Icon name="book" /> All notebooks</button>
                {folders
                  .filter((folder) => dialog.item.kind === 'notebook' || !wouldNest(folders, dialog.item.id, folder.id))
                  .map((folder) => ({ folder, depth: folderPath(folders, folder.id) }))
                  .sort((a, b) => a.depth.map((f) => f.name).join('/').localeCompare(b.depth.map((f) => f.name).join('/')))
                  .map(({ folder, depth }) => (
                    <button type="button" key={folder.id} style={{ paddingLeft: `${0.4 + (depth.length - 1) * 1}rem` }} onClick={() => void act(() => moveTarget(dialog.item, folder.id))}><Icon name="folder" /> {folder.name}</button>
                  ))}
              </div>
              <button type="button" onClick={() => setDialog({ kind: 'new-folder', moving: dialog.item })}><Icon name="plus" /> New folder</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
