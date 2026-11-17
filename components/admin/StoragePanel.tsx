'use client';

import { useCallback, useEffect, useState } from 'react';
import ProgressBar from '@/components/ProgressBar';
import type { StorageReport } from '@/lib/storage-usage';

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

/** What each part of the site takes up on the Pi's disk, biggest first. */
export default function StoragePanel() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback((refresh = false) => {
    setBusy(true);
    return fetch(`/api/admin/storage${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d?.success) { setReport(d.data); setState('ok'); } else setState('error'); })
      .catch(() => setState('error'))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const site = report ? report.areas.filter((a) => !a.otherDrive).reduce((s, a) => s + a.bytes, 0) : 0;
  const rows = report ? [
    ...report.areas,
    ...(report.elsewhere ? [{ id: 'elsewhere', label: 'Everything else on the Pi', icon: '🐧', where: 'The operating system, other programs and their files', bytes: report.elsewhere, files: 0, items: [], otherDrive: false }] : []),
  ] : [];
  const biggest = Math.max(1, ...rows.map((r) => r.bytes));

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
                    <span className="adm-usage-track" aria-hidden><span className={area.id === 'elsewhere' ? 'is-other' : ''} style={{ width: `${pct(area.bytes, biggest)}%` }} /></span>
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
            </div>
            <p className="adm-muted" style={{ marginTop: '0.75rem' }}>Open a row to see what’s inside it. Bars are compared with the biggest row; inside a row, with that row’s total.</p>
          </>
        )}
    </section>
  );
}
