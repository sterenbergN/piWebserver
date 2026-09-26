'use client';

import { useState } from 'react';
import type { Station } from '@/lib/workout/types';
import { finalizeStation, listFieldsFromStation } from '@/lib/workout/stations';
import { STATION_TYPE_META, describeStationWeights } from '@/lib/workout/station-summary';
import Sheet from './Sheet';
import { StationWeightFields } from './WeightFields';

type Row = { station: Station; remove: boolean; open: boolean };

type StationWeightsEditorProps = {
  stations: Station[];
  title?: string;
  intro?: string;
  saving?: boolean;
  onSave: (stations: Station[]) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Every station's weights on one screen — for checking a gym copied from
 * another one (same machines, different stacks and plates) or a quick
 * tune-up. Each station shows a one-line summary; tap to adjust it.
 * "Not here" drops a station.
 */
export default function StationWeightsEditor({ stations, title = 'Check the weights', intro, saving = false, onSave, onCancel }: StationWeightsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => stations.map((station) => ({ station: { ...station }, remove: false, open: false })));

  const patch = (i: number, fn: (row: Row) => Row) => setRows((prev) => prev.map((r, j) => (j === i ? fn(r) : r)));
  const save = () => onSave(rows.filter((r) => !r.remove && r.station.name.trim()).map((r) => finalizeStation(r.station, listFieldsFromStation(r.station))));
  const kept = rows.filter((r) => !r.remove).length;
  const removed = rows.length - kept;

  return (
    <Sheet
      title={title}
      subtitle={intro || 'Tap a station to change its weights. Untick anything this gym doesn’t have.'}
      onClose={onCancel}
      footer={
        <button className="workout-button is-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : removed ? `Save ${kept} · remove ${removed}` : `Save ${kept} station${kept === 1 ? '' : 's'}`}
        </button>
      }
    >
      <div className="workout-stack is-loose">
        {rows.map((row, i) => {
          const { station } = row;
          const meta = STATION_TYPE_META[station.type];
          return (
            <div key={station.id} className={`workout-station${row.open && !row.remove ? ' is-open' : ''}`} style={{ opacity: row.remove ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="workout-station-head" style={{ flex: 1, minWidth: 0 }} disabled={row.remove}
                  aria-expanded={row.open} onClick={() => patch(i, (r) => ({ ...r, open: !r.open }))}>
                  <span className="workout-avatar is-small" aria-hidden>{meta?.icon}</span>
                  <span className="workout-card-text">
                    <span className="workout-card-title" style={{ textDecoration: row.remove ? 'line-through' : undefined }}>{station.name}</span>
                    <span className="workout-card-meta">{row.remove ? 'Won’t be kept' : describeStationWeights(station)}</span>
                  </span>
                  {!row.remove && <span className={`workout-chevron${row.open ? ' is-open' : ''}`} aria-hidden>›</span>}
                </button>
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem', padding: '0 0.85rem 0 0.25rem', fontSize: '0.7rem', color: 'var(--muted)', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} checked={!row.remove}
                    aria-label={`${station.name} is at this gym`} onChange={(e) => patch(i, (r) => ({ ...r, remove: !e.target.checked, open: false }))} />
                  Here
                </label>
              </div>
              {row.open && !row.remove && (
                <div className="workout-station-body">
                  <label className="workout-field" style={{ display: 'block' }}>
                    <span className="workout-label">Name</span>
                    <input className="workout-input" value={station.name} onChange={(e) => patch(i, (r) => ({ ...r, station: { ...r.station, name: e.target.value } }))} />
                  </label>
                  <StationWeightFields station={station} onChange={(p) => patch(i, (r) => ({ ...r, station: { ...r.station, ...p } as Station }))} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
