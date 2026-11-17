'use client';

import { useCallback, useEffect, useState } from 'react';
import ProgressBar from '@/components/ProgressBar';
import type { StorageReport, SystemFolder, SystemReport } from '@/lib/storage-usage';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 1)} ${sizes[i]}`;
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : mins < 60 ? `${mins} minutes ago` : `${Math.round(mins / 60)} h ago`;
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);
const files = (n: number) => `${n.toLocaleString()} file${n === 1 ? '' : 's'}`;

/** One folder from the drive scan, with what it is and how to free it when that's safe. */
function FolderRow({ folder, of, nested, summary }: { folder: SystemFolder; of: number; nested?: boolean; summary?: boolean }) {
  const Row = summary ? 'summary' : 'div';
  return (
    <Row className={`adm-usage-row is-item${nested ? ' is-deep' : ''}`} title={`${folder.path || folder.label}: ${formatBytes(folder.bytes)} · ${files(folder.files)}`}>
      <span className="adm-usage-name">
        {folder.label ?? <code>{folder.path}</code>}
        {folder.label && folder.path && <small className="adm-usage-path">{folder.path}</small>}
        {folder.hint && <small className="adm-usage-hint">{folder.hint}</small>}
      </span>
      <span className="adm-usage-track" aria-hidden><span className="is-other" style={{ width: `${pct(folder.bytes, of)}%` }} /></span>
      <span className="adm-usage-size">{formatBytes(folder.bytes)}</span>
    </Row>
  );
}

/** The drive outside the site: the OS, other programs, logs and caches. */
function Elsewhere({ bytes, biggest, system, state, onScan }: {
  bytes: number;
  biggest: number;
  system: SystemReport | null;
  state: 'idle' | 'busy' | 'error';
  onScan: (refresh?: boolean) => void;
}) {
  const topFolder = Math.max(1, ...(system?.folders.map((f) => f.bytes) ?? []));
  // What the scan couldn't see: folders only root can open, and the filesystem's own bookkeeping.
  const unseen = system ? Math.max(0, bytes - system.bytes) : 0;
  return (
    <details className="adm-usage-group">
      <summary className="adm-usage-row" title={formatBytes(bytes)}>
        <span className="adm-usage-name"><span aria-hidden>🐧</span> Everything else on the Pi</span>
        <span className="adm-usage-track" aria-hidden><span className="is-other" style={{ width: `${pct(bytes, biggest)}%` }} /></span>
        <span className="adm-usage-size">{formatBytes(bytes)}</span>
      </summary>
      {state === 'busy' ? (
        <div className="adm-usage-where"><ProgressBar label="Going through the whole drive… this can take a minute or two on the Pi." /></div>
      ) : !system ? (
        <div className="adm-usage-where adm-usage-scan">
          <span>The operating system, other programs, logs and caches. Going through every folder on the drive takes a minute or two.</span>
          <button type="button" className="btn btn-secondary" onClick={() => onScan()}>Break it down</button>
          {state === 'error' && <span className="adm-usage-error">That didn’t work. Try again.</span>}
        </div>
      ) : (
        <>
          <p className="adm-usage-where">
            {files(system.files)} under <code>{system.root}</code>, measured {ago(system.scannedAt)} in {(system.tookMs / 1000).toFixed(0)} s ·{' '}
            <button type="button" className="adm-link-btn" onClick={() => onScan(true)}>Scan again</button>
            {system.partial && <><br />Stopped at the time limit, so some folders are only partly counted.</>}
          </p>
          {system.folders.map((folder) => folder.inside?.length ? (
            <details key={folder.path || folder.label} className="adm-usage-sub">
              <FolderRow folder={folder} of={topFolder} summary />
              {folder.inside.map((inner) => <FolderRow key={inner.path} folder={inner} of={folder.bytes} nested />)}
            </details>
          ) : <FolderRow key={folder.path || folder.label} folder={folder} of={topFolder} />)}
          {unseen > 0 && (
            <FolderRow of={topFolder} folder={{
              path: '',
              label: 'Couldn’t be measured',
              hint: system.unreadable.count
                ? `${system.unreadable.count} folder${system.unreadable.count === 1 ? '' : 's'} only root can open (${system.unreadable.examples.join(', ')}), plus the filesystem’s own bookkeeping.`
                : 'The filesystem’s own bookkeeping, and files that changed while measuring.',
              bytes: unseen, files: 0,
            }} />
          )}
        </>
      )}
    </details>
  );
}

/** What each part of the site takes up on the Pi's disk, biggest first. */
export default function StoragePanel() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [system, setSystem] = useState<SystemReport | null>(null);
  const [systemState, setSystemState] = useState<'idle' | 'busy' | 'error'>('idle');

  const load = useCallback((refresh = false) => {
    setBusy(true);
    return fetch(`/api/admin/storage${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) { setState('error'); return; }
        setReport(d.data);
        setState('ok');
        if (d.system) setSystem(d.system);
      })
      .catch(() => setState('error'))
      .finally(() => setBusy(false));
  }, []);

  // The whole drive: slow, so only when asked.
  const scanDrive = (refresh = false) => {
    setSystemState('busy');
    fetch(`/api/admin/storage?system=1${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d?.success) { setSystem(d.data); setSystemState('idle'); } else setSystemState('error'); })
      .catch(() => setSystemState('error'));
  };

  useEffect(() => { void load(); }, [load]);

  const site = report ? report.areas.filter((a) => !a.otherDrive).reduce((s, a) => s + a.bytes, 0) : 0;
  const rows = report?.areas ?? [];
  const biggest = Math.max(1, report?.elsewhere ?? 0, ...rows.map((r) => r.bytes));

  return (
    <section className="adm-card" aria-labelledby="storage-title">
      <div className="adm-card-head">
        <div>
          <h2 id="storage-title">💽 Where the space goes</h2>
          <p>{report ? `Measured ${ago(report.scannedAt)} · took ${(report.tookMs / 1000).toFixed(1)} s` : 'Adds up every file the site keeps'}</p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => load(true)}>{busy && report ? 'Measuring…' : 'Measure again'}</button>
      </div>

      {state === 'loading' && !report ? <ProgressBar label="Adding up the files…" />
        : state === 'error' && !report ? <div className="adm-notice is-error">Could not measure the disk.</div>
        : report && (
          <>
            {report.disk && (
              <div className="adm-disk">
                <div className="adm-disk-bar" role="img"
                  aria-label={`${formatBytes(site)} used by the site, ${formatBytes(report.elsewhere ?? 0)} by everything else, ${formatBytes(report.disk.free)} free of ${formatBytes(report.disk.total)}`}>
                  <span className="is-site" style={{ width: `${pct(site, report.disk.total)}%` }} title={`This site: ${formatBytes(site)}`} />
                  <span className="is-other" style={{ width: `${pct(report.elsewhere ?? 0, report.disk.total)}%` }} title={`Everything else: ${formatBytes(report.elsewhere ?? 0)}`} />
                </div>
                <ul className="adm-disk-key">
                  <li><i className="is-site" aria-hidden />This site <strong>{formatBytes(site)}</strong></li>
                  <li><i className="is-other" aria-hidden />Everything else <strong>{formatBytes(report.elsewhere ?? 0)}</strong></li>
                  <li><i aria-hidden />Free <strong>{formatBytes(report.disk.free)}</strong> of {formatBytes(report.disk.total)}</li>
                </ul>
              </div>
            )}

            <div className="adm-usage">
              {rows.map((area) => {
                const head = (
                  <>
                    <span className="adm-usage-name"><span aria-hidden>{area.icon}</span> {area.label}</span>
                    <span className="adm-usage-track" aria-hidden><span style={{ width: `${pct(area.bytes, biggest)}%` }} /></span>
                    <span className="adm-usage-size">{formatBytes(area.bytes)}</span>
                  </>
                );
                if (!area.items.length) {
                  return <div key={area.id} className="adm-usage-row is-flat" title={area.where}>{head}</div>;
                }
                return (
                  <details key={area.id} className="adm-usage-group">
                    <summary className="adm-usage-row" title={`${formatBytes(area.bytes)} · ${files(area.files)}`}>{head}</summary>
                    <p className="adm-usage-where">
                      {files(area.files)} · <code>{area.where}</code>
                      {area.otherDrive && <> · on another drive, so not part of this disk</>}
                    </p>
                    {area.items.map((item) => (
                      <div key={item.name || item.label} className="adm-usage-row is-item" title={`${item.name || item.label}: ${formatBytes(item.bytes)} · ${files(item.files)}`}>
                        <span className="adm-usage-name">{item.label}</span>
                        <span className="adm-usage-track" aria-hidden><span style={{ width: `${pct(item.bytes, area.bytes)}%` }} /></span>
                        <span className="adm-usage-size">{formatBytes(item.bytes)}</span>
                      </div>
                    ))}
                  </details>
                );
              })}
              {!!report.elsewhere && (
                <Elsewhere bytes={report.elsewhere} biggest={biggest} system={system} state={systemState} onScan={scanDrive} />
              )}
            </div>
            <p className="adm-muted" style={{ marginTop: '0.75rem' }}>Open a row to see what’s inside it. Bars are compared with the biggest row; inside a row, with that row’s total.</p>
          </>
        )}
    </section>
  );
}
