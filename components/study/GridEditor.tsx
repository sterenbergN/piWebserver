'use client';

import { useRef, useState } from 'react';
import type { CompareGrid } from '@/lib/study/practice';
import { practicePost } from './api';
import { Icon } from './Icon';

// A grid as a table of boxes. Rows and columns remember where they started, so what
// she's missed stays with the right cell when things move.

type Column = { key: number; name: string; from: number | null };
type Row = { key: number; name: string; from: number | null; cells: Record<number, string> };

export function GridEditor({ grid, onDone, onCancel }: { grid: CompareGrid; onDone: () => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(grid.title);
  const [course, setCourse] = useState(grid.course);
  const [columns, setColumns] = useState<Column[]>(() => grid.columns.map((name, i) => ({ key: i, name, from: i })));
  const [rows, setRows] = useState<Row[]>(() => grid.rows.map((row, r) => ({ key: r, name: row.name, from: r, cells: Object.fromEntries(row.cells.map((cell, c) => [c, cell])) })));
  const nextColumn = useRef(grid.columns.length);
  const nextRow = useRef(grid.rows.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setCell = (rowKey: number, columnKey: number, text: string) => setRows((list) => list.map((r) => (r.key === rowKey ? { ...r, cells: { ...r.cells, [columnKey]: text } } : r)));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await practicePost('edit-grid', {
        id: grid.id, title, course,
        columns: columns.map((c) => ({ name: c.name, ...(c.from === null ? {} : { from: c.from }) })),
        rows: rows.map((r) => ({ name: r.name, ...(r.from === null ? {} : { from: r.from }), cells: columns.map((c) => r.cells[c.key] ?? '') })),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <section className="sd-card">
      <h2>Edit this grid</h2>
      <div className="sd-fields">
        <label>Name
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>Class or module
          <input value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
        </label>
      </div>
      <div className="pr-grid-wrap" tabIndex={0} role="region" aria-label="The grid">
        <table className="pr-grid ed-grid">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Row name</span></th>
              {columns.map((column, c) => (
                <th key={column.key} scope="col">
                  <span className="ed-cell-head">
                    <input value={column.name} aria-label={`Column ${c + 1} heading`} placeholder="Heading" onChange={(e) => setColumns((list) => list.map((x) => (x.key === column.key ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="hb-small-btn ed-remove" aria-label={`Remove column ${column.name || c + 1}`} disabled={columns.length <= 2} onClick={() => setColumns((list) => list.filter((x) => x.key !== column.key))}><Icon name="x" /></button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="ed-cell-head">
                    <input value={row.name} aria-label={`Row ${r + 1} name`} placeholder="Name" onChange={(e) => setRows((list) => list.map((x) => (x.key === row.key ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="hb-small-btn ed-remove" aria-label={`Remove row ${row.name || r + 1}`} disabled={rows.length <= 2} onClick={() => setRows((list) => list.filter((x) => x.key !== row.key))}><Icon name="x" /></button>
                  </span>
                </th>
                {columns.map((column) => (
                  <td key={column.key}>
                    <textarea rows={2} value={row.cells[column.key] ?? ''} aria-label={`${row.name}: ${column.name}`} onChange={(e) => setCell(row.key, column.key, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sd-actions">
        <button type="button" className="hb-small-btn" disabled={rows.length >= 24} onClick={() => setRows((list) => [...list, { key: nextRow.current++, name: '', from: null, cells: {} }])}><Icon name="plus" /> Add a row</button>
        <button type="button" className="hb-small-btn" disabled={columns.length >= 8} onClick={() => setColumns((list) => [...list, { key: nextColumn.current++, name: '', from: null }])}><Icon name="plus" /> Add a column</button>
      </div>
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
