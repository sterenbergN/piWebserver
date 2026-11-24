'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CONVERSIONS, conversionsFor, extensionOf, kindOf, type Conversion, type FileKind } from '@/lib/convert/formats';
import type { OfficeOptions } from '@/lib/convert/office-options';
import { FilePreview, KIND_ICON, Thumb } from './converter/FilePreview';
import { DEFAULT_OPTIONS, runInBrowser, type ConvertOptions, type Output } from './converter/run-browser';
import { loadPiTools, runOnPi, type PiTools } from './converter/run-pi';

// Tools › File converter: the conversions people otherwise hand to a random website.
// Most run right here (nothing is uploaded); audio, video and Office files go to
// the Pi for signed-in accounts, and are deleted there afterwards.

type Picked = { id: string; file: File; kind: FileKind };
type Result = Output & { url: string };

const GROUPS: Conversion['group'][] = ['Images', 'PDF', 'Audio & video', 'Office', 'Data & files'];
const MAX_SIDES = [0, 4000, 2000, 1200, 800];

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
let nextId = 0;

export default function ConverterTool() {
  const [files, setFiles] = useState<Picked[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [pi, setPi] = useState<PiTools | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [dragging, setDragging] = useState(false);
  const [office, setOffice] = useState<OfficeOptions>({});
  /** The file or result whose bigger preview is open. */
  const [open, setOpen] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const run = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadPiTools().then(setPi);
    return () => run.current?.abort();
  }, []);
  // Results are object URLs: let them go when they're replaced.
  useEffect(() => () => results.forEach((r) => URL.revokeObjectURL(r.url)), [results]);

  const kinds = useMemo(() => [...new Set(files.map((f) => f.kind))], [files]);
  const choices = useMemo(() => conversionsFor(kinds), [kinds]);
  const conversion = choices.find((c) => c.id === chosen) ?? null;

  const unavailable = (c: Conversion): string | null => {
    if (c.where !== 'pi') return null;
    if (!pi) return 'Checking the Pi…';
    if (!pi.signedIn) return 'Sign in to use the Pi for this';
    if (c.tool === 'ffmpeg' && !pi.ffmpeg) return 'Needs ffmpeg on the Pi';
    if (c.tool === 'office' && !pi.office) return 'Needs LibreOffice on the Pi';
    return null;
  };

  const add = (list: FileList | File[] | null) => {
    if (!list?.length) return;
    setResults([]);
    setError('');
    // Copied now: a FileList empties when its input is cleared, before React gets to the update.
    const added = [...list].map((file) => ({ id: `f${nextId++}`, file, kind: kindOf(file.name, file.type) }));
    setFiles((prev) => [...prev, ...added]);
  };
  const move = (i: number, by: number) => setFiles((prev) => {
    const next = [...prev];
    const [f] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, f);
    return next;
  });
  const set = <K extends keyof ConvertOptions>(key: K, value: ConvertOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  const convert = async () => {
    if (!conversion || !files.length) return;
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setBusy(true);
    setError('');
    setResults([]);
    try {
      let out: Output[];
      if (conversion.where === 'pi') {
        out = [];
        for (const f of files) out.push(await runOnPi(conversion, f.file, setStatus, controller.signal, conversion.id === 'office-pdf' ? office : {}));
      } else {
        setStatus(conversion.combine ? 'Working…' : `Converting 1 of ${files.length}…`);
        out = await runInBrowser(conversion, files.map((f) => f.file), options, (done) => setStatus(done < files.length ? `Converting ${done + 1} of ${files.length}…` : 'Finishing…'));
      }
      if (!controller.signal.aborted) setResults(out.map((o) => ({ ...o, url: URL.createObjectURL(o.blob) })));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      if (run.current === controller) { run.current = null; setBusy(false); setStatus(''); }
    }
  };

  const downloadAll = async () => {
    const { zipSync } = await import('fflate');
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
    for (const r of results) entries[r.name] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }];
    const url = URL.createObjectURL(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const usesPages = conversion && ['pdf-jpeg', 'pdf-png', 'pdf-pages', 'pdf-rotate', 'pdf-text'].includes(conversion.id);
  const usesQuality = conversion && ['img-jpeg', 'img-webp', 'pdf-jpeg', 'to-pdf'].includes(conversion.id);
  const usesMaxSide = conversion && ['img-jpeg', 'img-png', 'img-webp', 'to-pdf'].includes(conversion.id);
  const reason = conversion ? unavailable(conversion) : null;

  return (
    <section className="tl-card tl-conv">
      <h2>File converter</h2>
      <p className="tl-conv-intro">
        For the conversions you’d otherwise give to some random website. Most happen right here in your browser, so the file never leaves your device.
        Audio, video and Office files go to the Pi (signed in), and are deleted there once you have the result.
      </p>

      <div
        className={`tl-conv-drop${dragging ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
      >
        <input ref={picker} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <button type="button" className="btn btn-primary" onClick={() => picker.current?.click()} disabled={busy}>Choose files</button>
        <span>or drop them here</span>
      </div>

      {files.length > 0 && (
        <ul className="tl-conv-files" aria-label="Files to convert">
          {files.map((f, i) => (
            <li key={f.id} className="tl-conv-item">
              <div className="tl-conv-row">
              <Thumb blob={f.file} name={f.file.name} />
              <span className="tl-conv-name">{f.file.name}</span>
              <button type="button" className="tl-conv-link" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Hide' : 'Preview'}</button>
              <span className="tl-conv-size">{size(f.file.size)}</span>
              {files.length > 1 && (
                <>
                  <button type="button" aria-label={`Move ${f.file.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${f.file.name} down`} disabled={busy || i === files.length - 1} onClick={() => move(i, 1)}>↓</button>
                </>
              )}
              <button type="button" aria-label={`Remove ${f.file.name}`} disabled={busy} onClick={() => { setFiles((prev) => prev.filter((x) => x.id !== f.id)); setResults([]); }}>×</button>
              </div>
              {open === f.id && <FilePreview blob={f.file} name={f.file.name} />}
            </li>
          ))}
          <li className="tl-conv-files-foot">
            <button type="button" className="tl-conv-link" disabled={busy} onClick={() => { setFiles([]); setResults([]); setChosen(null); setError(''); }}>Clear all</button>
          </li>
        </ul>
      )}

      {files.length > 0 && (choices.length === 0 ? (
        <p className="tl-conv-note">Nothing here converts {kinds.length > 1 ? 'all of these files together. Try them one kind at a time' : `${files[0].file.name.split('.').pop()?.toUpperCase() ?? 'this'} files yet`}.</p>
      ) : (
        <div className="tl-conv-choices">
          {GROUPS.map((group) => {
            const list = choices.filter((c) => c.group === group);
            if (!list.length) return null;
            return (
              <div key={group}>
                <p className="tl-conv-group">{group}</p>
                <div className="tl-chips">
                  {list.map((c) => {
                    const why = unavailable(c);
                    return (
                      <button key={c.id} type="button" className="tl-chip" aria-pressed={chosen === c.id} disabled={busy} title={why ?? c.hint} onClick={() => { setChosen(c.id); setResults([]); setError(''); }}>
                        {c.label}{c.where === 'pi' && <span className="tl-conv-pi" aria-label="on the Pi"> · Pi</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {conversion && (
        <div className="tl-conv-options">
          {conversion.hint && <p className="tl-conv-note">{conversion.hint}{conversion.combine && files.length > 1 ? '. Use the arrows to set the order.' : '.'}</p>}
          {usesQuality && (
            <label>Quality <strong>{Math.round(options.quality * 100)}%</strong>
              <input type="range" min={0.5} max={1} step={0.05} value={options.quality} onChange={(e) => set('quality', Number(e.target.value))} />
            </label>
          )}
          {usesMaxSide && (
            <label>Size
              <select value={options.maxSide} onChange={(e) => set('maxSide', Number(e.target.value))}>
                {MAX_SIDES.map((s) => <option key={s} value={s}>{s ? `At most ${s} px` : 'Keep the size'}</option>)}
              </select>
            </label>
          )}
          {conversion.id === 'to-pdf' && (
            <label>Pages
              <select value={options.pageSize} onChange={(e) => set('pageSize', e.target.value as ConvertOptions['pageSize'])}>
                <option value="fit">Each the size of its photo</option>
                <option value="letter">Letter paper</option>
                <option value="a4">A4 paper</option>
              </select>
            </label>
          )}
          {(conversion.id === 'pdf-jpeg' || conversion.id === 'pdf-png') && (
            <label>Sharpness
              <select value={options.scale} onChange={(e) => set('scale', Number(e.target.value))}>
                <option value={1}>Screen (72 dpi)</option>
                <option value={2}>Clear (144 dpi)</option>
                <option value={4}>Print (288 dpi)</option>
              </select>
            </label>
          )}
          {usesPages && (
            <label>Pages <input value={options.pages} placeholder="All, or like 1-3, 5" onChange={(e) => set('pages', e.target.value)} /></label>
          )}
          {conversion.id === 'pdf-pages' && (
            <label className="tl-conv-check"><input type="checkbox" checked={options.split} onChange={(e) => set('split', e.target.checked)} /> A separate PDF for each page</label>
          )}
          {conversion.id === 'pdf-rotate' && (
            <label>Turn
              <select value={options.rotate} onChange={(e) => set('rotate', Number(e.target.value) as ConvertOptions['rotate'])}>
                <option value={90}>Right (90°)</option>
                <option value={180}>Upside down (180°)</option>
                <option value={270}>Left (90°)</option>
              </select>
            </label>
          )}
          {conversion.id === 'office-pdf' && (() => {
            const xlsx = files.some((f) => extensionOf(f.file.name) === 'xlsx');
            const otherSheets = files.some((f) => f.kind === 'sheet' && extensionOf(f.file.name) !== 'xlsx');
            const slides = files.some((f) => f.kind === 'slides');
            const setO = <K extends keyof OfficeOptions>(key: K, value: OfficeOptions[K]) => setOffice((o) => ({ ...o, [key]: value }));
            return (
              <>
                <label>Pages <input value={office.pages ?? ''} placeholder="All, or like 1-3, 5" onChange={(e) => setO('pages', e.target.value)} /></label>
                {slides && (
                  <label className="tl-conv-check"><input type="checkbox" checked={!!office.notes} onChange={(e) => setO('notes', e.target.checked)} /> Add a page of speaker notes for each slide</label>
                )}
                {xlsx && (<>
                  <label>Orientation
                    <select value={office.orientation ?? 'keep'} onChange={(e) => setO('orientation', e.target.value === 'keep' ? undefined : e.target.value as OfficeOptions['orientation'])}>
                      <option value="keep">As the spreadsheet says</option>
                      <option value="portrait">Portrait (tall)</option>
                      <option value="landscape">Landscape (wide)</option>
                    </select>
                  </label>
                  <label>Fit
                    <select value={office.fit ?? 'keep'} onChange={(e) => setO('fit', e.target.value === 'keep' ? undefined : e.target.value as OfficeOptions['fit'])}>
                      <option value="keep">As the spreadsheet says</option>
                      <option value="width">All columns on one page width</option>
                      <option value="page">Each sheet on one page</option>
                      <option value="scale">Scale to a percentage</option>
                    </select>
                  </label>
                  {office.fit === 'scale' && (
                    <label>Scale <strong>{office.scale ?? 100}%</strong>
                      <input type="range" min={25} max={200} step={5} value={office.scale ?? 100} onChange={(e) => setO('scale', Number(e.target.value))} />
                    </label>
                  )}
                  <label>Paper
                    <select value={office.paper ?? 'keep'} onChange={(e) => setO('paper', e.target.value === 'keep' ? undefined : e.target.value as OfficeOptions['paper'])}>
                      <option value="keep">As the spreadsheet says</option>
                      <option value="letter">Letter</option>
                      <option value="legal">Legal</option>
                      <option value="a4">A4</option>
                    </select>
                  </label>
                  <label className="tl-conv-check"><input type="checkbox" checked={!!office.gridlines} onChange={(e) => setO('gridlines', e.target.checked)} /> Print the gridlines</label>
                </>)}
                {otherSheets && <p className="tl-conv-note">Orientation, fitting and paper can be set for .xlsx files. Older .xls and .ods files print as they’re set up.</p>}
              </>
            );
          })()}
          <div className="tl-conv-go">
            <button type="button" className="btn btn-primary tl-btn" disabled={busy || !!reason} onClick={() => void convert()}>
              {busy ? 'Working…' : `${conversion.label}${files.length > 1 && !conversion.combine ? ` (${files.length} files)` : ''}`}
            </button>
            {busy && <button type="button" className="tl-conv-link" onClick={() => run.current?.abort()}>Stop</button>}
            <span className="tl-conv-where">{reason ?? (conversion.where === 'pi' ? 'On the Pi: uploaded, then deleted after' : 'On this device: nothing is uploaded')}</span>
          </div>
          {status && <p className="tl-conv-status" role="status">{status}</p>}
          {error && <p className="tl-conv-error" role="alert">{error}</p>}
        </div>
      )}

      {results.length > 0 && (
        <div className="tl-conv-results">
          <p className="tl-conv-group">Ready</p>
          <ul>
            {results.map((r) => (
              <li key={r.url} className="tl-conv-item">
                <div className="tl-conv-row">
                  <Thumb blob={r.blob} name={r.name} />
                  <span className="tl-conv-name">{r.name}</span>
                  <button type="button" className="tl-conv-link" aria-expanded={open === r.url} onClick={() => setOpen(open === r.url ? null : r.url)}>{open === r.url ? 'Hide' : 'Preview'}</button>
                  <span className="tl-conv-size">{size(r.blob.size)}</span>
                  <a className="btn btn-secondary" href={r.url} download={r.name}>Download</a>
                </div>
                {open === r.url && <FilePreview blob={r.blob} name={r.name} />}
              </li>
            ))}
          </ul>
          {results.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => void downloadAll()}>Download all as a zip</button>}
        </div>
      )}

      {!files.length && (
        <details className="tl-conv-list">
          <summary>What it can do</summary>
          <ul>
            {GROUPS.map((g) => <li key={g}><strong>{g}:</strong> {CONVERSIONS.filter((c) => c.group === g).map((c) => c.label.replace(/^To /, '')).join(', ')}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
