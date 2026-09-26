'use client';

import { useState } from 'react';
import { isLoadStation, type Station } from '@/lib/workout/types';
import { finalizeStation, listFieldsFromStation, type StationListFields } from '@/lib/workout/stations';

type Row = { station: Station; lists: StationListFields; remove: boolean };

type StationWeightsEditorProps = {
  stations: Station[];
  title?: string;
  intro?: string;
  saving?: boolean;
  onSave: (stations: Station[]) => void | Promise<void>;
  onCancel: () => void;
};

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };

/**
 * Every station's weights on one screen — for checking a gym copied from
 * another one (same machines, different stacks and plates) or a quick tune-up.
 * "Not here" drops a station.
 */
export default function StationWeightsEditor({ stations, title = 'Check the weights', intro, saving = false, onSave, onCancel }: StationWeightsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => stations.map((station) => ({ station: { ...station }, lists: listFieldsFromStation(station), remove: false })));

  const patch = (i: number, fn: (row: Row) => Row) => setRows((prev) => prev.map((r, j) => (j === i ? fn(r) : r)));
  const setField = (i: number, field: keyof Station) => (e: React.ChangeEvent<HTMLInputElement>) =>
    patch(i, (r) => ({ ...r, station: { ...r.station, [field]: field === 'name' ? e.target.value : num(e.target.value) } }));
  const setList = (i: number, field: keyof StationListFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    patch(i, (r) => ({ ...r, lists: { ...r.lists, [field]: e.target.value } }));

  const save = () => onSave(rows.filter((r) => !r.remove && r.station.name.trim()).map((r) => finalizeStation(r.station, r.lists)));
  const small: React.CSSProperties = { marginBottom: 0, padding: '0.45rem 0.6rem', fontSize: '0.85rem' };
  const kept = rows.filter((r) => !r.remove).length;

  return (
    <div className="workout-form-panel animate-fade-in">
      <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <button className="workout-text-btn" onClick={onCancel}>Cancel</button>
      </div>
      {intro && <p className="workout-hint" style={{ marginTop: 0 }}>{intro}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {rows.map((row, i) => {
          const { station, lists } = row;
          return (
            <div key={station.id} style={{ border: '1px solid var(--surface-border)', borderRadius: 10, padding: '0.6rem', opacity: row.remove ? 0.45 : 1 }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="workout-input" style={{ ...small, flex: 1, fontWeight: 600 }} value={station.name} onChange={setField(i, 'name')} aria-label="Station name" disabled={row.remove} />
                <span className="workout-pill">{station.type}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                  <input type="checkbox" checked={row.remove} onChange={(e) => patch(i, (r) => ({ ...r, remove: e.target.checked }))} /> Not here
                </label>
              </div>
              {!row.remove && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '0.4rem', marginTop: '0.45rem' }}>
                  {station.type === 'plates' && (<>
                    <label className="workout-hint">Bar lb<input className="workout-input" style={small} type="number" inputMode="decimal" value={station.baseWeight ?? ''} onChange={setField(i, 'baseWeight')} /></label>
                    <label className="workout-hint" style={{ gridColumn: 'span 2' }}>Plates per side<input className="workout-input" style={small} value={lists.plates} onChange={setList(i, 'plates')} placeholder="45, 45, 25, 10, 5, 2.5" /></label>
                  </>)}
                  {isLoadStation(station.type) && (<>
                    <label className="workout-hint">Min<input className="workout-input" style={small} type="number" inputMode="decimal" value={station.minWeight ?? ''} onChange={setField(i, 'minWeight')} /></label>
                    <label className="workout-hint">Max<input className="workout-input" style={small} type="number" inputMode="decimal" value={station.maxWeight ?? ''} onChange={setField(i, 'maxWeight')} /></label>
                    <label className="workout-hint">Step<input className="workout-input" style={small} type="number" inputMode="decimal" value={station.increment ?? ''} onChange={setField(i, 'increment')} /></label>
                    <label className="workout-hint">Add-ons<input className="workout-input" style={small} value={lists.additionalWeights} onChange={setList(i, 'additionalWeights')} placeholder="2.5, 5" /></label>
                  </>)}
                  {station.type === 'dumbbells' && (
                    <label className="workout-hint" style={{ gridColumn: '1 / -1' }}>Dumbbells (lb)<input className="workout-input" style={small} value={lists.dumbbells} onChange={setList(i, 'dumbbells')} placeholder="5, 10, 15 … 100" /></label>
                  )}
                  {station.type === 'bodyweight' && (
                    <label className="workout-hint" style={{ gridColumn: '1 / -1' }}>Added weight options<input className="workout-input" style={small} value={lists.bodyWeight} onChange={setList(i, 'bodyWeight')} placeholder="10, 25, 45" /></label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="workout-btn-row" style={{ marginTop: '0.9rem' }}>
        <button className="workout-btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : `Save ${kept} station${kept === 1 ? '' : 's'}`}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
