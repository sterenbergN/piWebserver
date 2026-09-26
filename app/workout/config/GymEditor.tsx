'use client';

import { useState, useEffect } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { GYM_EMOJIS, type Gym, type Lift, type Station } from '@/lib/workout/types';
import { newRecordId, upsertLift } from '@/lib/workout/stations';
import StationForm from '@/components/workout/StationForm';
import LiftForm, { describeLift } from '@/components/workout/LiftForm';
import EquipmentPicker from '@/components/workout/EquipmentPicker';
import QuickAddLifts from '@/components/workout/QuickAddLifts';
import { GYM_TEMPLATES, stationsFromTemplate, type EquipmentPreset } from '@/lib/workout/catalog';
import { copyStations, equipmentLibrary } from '@/lib/workout/equipment-library';
import StationWeightsEditor from '@/components/workout/StationWeightsEditor';

/** `copyFrom`: 'gym:<id>' or 'template:<key>' to start a new gym with that equipment. */
type GymDraft = { id: string | null; name: string; emoji: string; isPublic: boolean; copyFrom?: string };
const EMPTY_GYM_DRAFT: GymDraft = { id: null, name: '', emoji: '🏋️', isPublic: false, copyFrom: '' };

/** Which station/lift form is open inside the active gym. */
type EditorTarget =
  | { kind: 'pick-equipment' }
  | { kind: 'station'; stationId: string | 'new'; preset?: EquipmentPreset; copyFrom?: Station }
  | { kind: 'weights'; intro?: string }
  | { kind: 'quick-lifts'; stationId: string }
  | { kind: 'lift'; stationId: string; liftId: string | 'new' }
  | null;

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export default function GymEditor() {
  const { confirm, popup } = useSitePopup();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  const [gymDraft, setGymDraft] = useState<GymDraft | null>(null);
  const [target, setTarget] = useState<EditorTarget>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/gyms?scope=all').then(r => r.json()),
      fetch('/api/workout/auth').then(r => r.json()),
    ]).then(([dGyms, dAuth]) => {
      if (dGyms.success) {
        setGyms(dGyms.gyms);
        // Deep link from a station page: /workout/config?gym=ID opens that gym.
        const wanted = new URLSearchParams(window.location.search).get('gym');
        if (wanted && dGyms.gyms.some((g: Gym) => g.id === wanted)) setActiveGymId(wanted);
      }
      if (dAuth.authenticated && dAuth.user) setUserId(dAuth.user.id);
    }).catch(() => setError('Could not load gyms.'))
      .finally(() => setLoading(false));
  }, []);

  const activeGym = gyms.find(g => g.id === activeGymId) || null;

  /** Run a save and surface failures instead of silently ignoring them. */
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const replaceGym = (gym: Gym) => setGyms(prev => prev.map(g => (g.id === gym.id ? gym : g)));

  const saveActiveGym = (stations: Station[]) => run(async () => {
    if (!activeGym) return;
    const data = await requestJson('/api/workout/gyms', { method: 'PUT', body: JSON.stringify({ ...activeGym, stations }) });
    replaceGym(data.gym);
    setTarget(null);
  });

  // ─── Gym CRUD ──────────────────────────────────────────────────────────────

  const handleSubmitGym = () => run(async () => {
    if (!gymDraft?.name.trim()) return;
    const fields = { name: gymDraft.name, emoji: gymDraft.emoji, isPublic: gymDraft.isPublic };
    if (gymDraft.id) {
      const existing = gyms.find(g => g.id === gymDraft.id);
      const data = await requestJson('/api/workout/gyms', { method: 'PUT', body: JSON.stringify({ ...existing, ...fields }) });
      replaceGym(data.gym);
    } else {
      // Start from another gym's equipment (fresh ids) or a template, then check the weights.
      const source = gymDraft.copyFrom || '';
      const stations = source.startsWith('gym:')
        ? copyStations(gyms.find(g => g.id === source.slice(4))?.stations || [])
        : source.startsWith('template:') ? stationsFromTemplate(source.slice(9)) : [];
      const data = await requestJson('/api/workout/gyms', { method: 'POST', body: JSON.stringify({ ...fields, stations }) });
      setGyms(prev => [...prev, data.gym]);
      setActiveGymId(data.gym.id);
      if (stations.length > 0) {
        setTarget({ kind: 'weights', intro: 'Same equipment, new gym: fix any weights that differ here and tick “Not here” for anything this gym doesn’t have.' });
      }
    }
    setGymDraft(null);
  });

  const handleDeleteGym = async (gym: Gym) => {
    const ok = await confirm({ title: 'Delete Gym', message: `Delete ${gym.name} and all of its stations?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    run(async () => {
      await requestJson(`/api/workout/gyms?id=${encodeURIComponent(gym.id)}`, { method: 'DELETE' });
      setGyms(prev => prev.filter(g => g.id !== gym.id));
      if (activeGymId === gym.id) setActiveGymId(null);
    });
  };

  const handleImportGym = async (gym: Gym) => {
    const ok = await confirm({ title: 'Import Gym', message: `Import all stations & lifts from ${gym.name}?`, confirmLabel: 'Import' });
    if (!ok) return;
    run(async () => {
      const data = await requestJson('/api/workout/gyms', {
        method: 'POST',
        body: JSON.stringify({ name: `${gym.name} (Copy)`, emoji: gym.emoji, stations: gym.stations, isPublic: false }),
      });
      setGyms(prev => [...prev, data.gym]);
    });
  };

  // ─── Stations & lifts ──────────────────────────────────────────────────────

  const saveStation = (station: Station) => {
    if (!activeGym) return;
    const exists = activeGym.stations.some(s => s.id === station.id);
    saveActiveGym(exists ? activeGym.stations.map(s => (s.id === station.id ? station : s)) : [...activeGym.stations, station]);
  };

  const deleteStation = async (station: Station) => {
    if (!activeGym) return;
    const ok = await confirm({ title: 'Delete Station', message: `Delete ${station.name} and its ${station.lifts.length} lift(s)?`, confirmLabel: 'Delete', danger: true });
    if (ok) saveActiveGym(activeGym.stations.filter(s => s.id !== station.id));
  };

  const saveLift = (station: Station, lift: Lift) => {
    if (!activeGym) return;
    saveActiveGym(activeGym.stations.map(s => (s.id === station.id ? upsertLift(s, lift) : s)));
  };

  const addLifts = (station: Station, lifts: Lift[]) => {
    if (!activeGym || lifts.length === 0) return;
    saveActiveGym(activeGym.stations.map(s => (s.id === station.id ? { ...s, lifts: [...s.lifts, ...lifts] } : s)));
  };

  const applyTemplate = async (templateKey: string) => {
    if (!activeGym) return;
    const stations = stationsFromTemplate(templateKey, activeGym.stations);
    const lifts = stations.reduce((n, st) => n + st.lifts.length, 0);
    const ok = await confirm({ title: 'Add starter equipment', message: `Add ${stations.length} stations with ${lifts} lifts? You can edit or remove any of them afterwards.`, confirmLabel: 'Add' });
    if (ok) saveActiveGym([...activeGym.stations, ...stations]);
  };

  const shareUrl = activeGym?.shareToken ? `${window.location.origin}/workout/shared-gym?token=${activeGym.shareToken}` : '';

  const createShareLink = (regenerate = false) => run(async () => {
    if (!activeGym) return;
    const data = await requestJson('/api/workout/gyms/share', { method: 'POST', body: JSON.stringify({ id: activeGym.id, regenerate }) });
    replaceGym({ ...activeGym, shareToken: data.token });
  });

  const stopSharing = () => run(async () => {
    if (!activeGym) return;
    await requestJson(`/api/workout/gyms/share?id=${encodeURIComponent(activeGym.id)}`, { method: 'DELETE' });
    const { shareToken: _token, ...rest } = activeGym;
    replaceGym(rest as Gym);
  });

  const copyShareLink = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: `${activeGym?.name} gym`, url: shareUrl }); return; } catch { /* fall back to copy */ }
    }
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deleteLift = async (station: Station, lift: Lift) => {
    if (!activeGym) return;
    const ok = await confirm({ title: 'Delete Lift', message: `Delete ${lift.name}?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    saveActiveGym(activeGym.stations.map(s => (s.id === station.id ? { ...s, lifts: s.lifts.filter(l => l.id !== lift.id) } : s)));
  };

  if (loading) return <div style={{ padding: '1.5rem' }}>Loading Gyms...</div>;

  const myGyms = gyms.filter(g => g.ownerId === userId);
  const otherGyms = gyms.filter(g => g.ownerId !== userId);

  // Your stations (and published gyms') that this gym doesn't have yet.
  const library = equipmentLibrary(gyms, activeGym);

  const renderGymForm = () => gymDraft && (
    <div className="workout-form-panel">
      {gymDraft.id && <span className="workout-pill" style={{ marginBottom: '0.5rem' }}>Editing</span>}
      <input className="workout-input" style={{ marginTop: '0.5rem' }} placeholder="Gym Name (e.g. Planet Fitness)" value={gymDraft.name} onChange={e => setGymDraft({ ...gymDraft, name: e.target.value })} />

      <label className="workout-label">Choose Emoji</label>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {GYM_EMOJIS.map(em => (
          <button
            key={em}
            onClick={() => setGymDraft({ ...gymDraft, emoji: em })}
            aria-pressed={gymDraft.emoji === em}
            style={{ fontSize: '1.5rem', width: '40px', height: '40px', border: gymDraft.emoji === em ? '2px solid var(--accent)' : '1px solid var(--surface-border)', borderRadius: '8px', background: gymDraft.emoji === em ? 'rgba(var(--accent-rgb),0.15)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {em}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--surface-border)', borderRadius: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={gymDraft.isPublic} onChange={e => setGymDraft({ ...gymDraft, isPublic: e.target.checked })} style={{ marginTop: '0.15rem' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Publish this gym for others to import</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Published gyms appear in the public import list. Private gyms are visible only to you.</div>
        </div>
      </label>

      {!gymDraft.id && (
        <>
          <label className="workout-label">Start with equipment from</label>
          <select className="workout-input" value={gymDraft.copyFrom || ''} onChange={e => setGymDraft({ ...gymDraft, copyFrom: e.target.value })}>
            <option value="">Nothing — I&apos;ll add it as I go</option>
            {myGyms.length > 0 && (
              <optgroup label="One of my gyms (you'll check the weights next)">
                {myGyms.map(g => <option key={g.id} value={`gym:${g.id}`}>{g.emoji} {g.name} ({g.stations.length} stations)</option>)}
              </optgroup>
            )}
            <optgroup label="A starter template">
              {GYM_TEMPLATES.map(t => <option key={t.key} value={`template:${t.key}`}>{t.name}</option>)}
            </optgroup>
          </select>
        </>
      )}

      <div className="workout-btn-row">
        <button className="workout-btn-primary" disabled={!gymDraft.name.trim() || saving} onClick={handleSubmitGym}>{gymDraft.id ? 'Save Gym' : 'Create'}</button>
        <button className="btn btn-secondary" onClick={() => setGymDraft(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      {error && <p className="workout-error" style={{ marginBottom: '1rem' }}>{error}</p>}

      {!activeGym ? (
        <div>
          <h3 style={{ margin: '0 0 1rem 0' }}>Your Gyms</h3>
          {myGyms.length === 0 && <p style={{ opacity: 0.6 }}>No gyms created yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {myGyms.map(g => (
              <div key={g.id} style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" style={{ textAlign: 'left', padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }} onClick={() => { setActiveGymId(g.id); setTarget(null); }}>
                  <strong>{g.emoji || '🏋️'} {g.name}</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{g.stations?.length || 0} Stations • {g.isPublic ? 'Published' : 'Private'}</span>
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.65rem 0.9rem', fontSize: '0.8rem', borderRadius: '12px' }} onClick={() => setGymDraft({ id: g.id, name: g.name, emoji: g.emoji || '🏋️', isPublic: g.isPublic === true })}>
                    Edit
                  </button>
                  <button className="workout-btn-danger" onClick={() => handleDeleteGym(g)}>Delete</button>
                </div>
              </div>
            ))}
          </div>

          {gymDraft ? renderGymForm() : (
            <button className="workout-btn-primary" onClick={() => setGymDraft(EMPTY_GYM_DRAFT)}>+ Create New Gym</button>
          )}

          {otherGyms.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ margin: '0 0 1rem 0' }}>Import Public Gyms</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {otherGyms.map(g => (
                  <div key={g.id} className="workout-list-row" style={{ padding: '0.75rem 1rem', borderRadius: '12px' }}>
                    <span>{g.emoji || '🏋️'} {g.name} <small style={{ color: 'var(--muted)' }}>({g.stations?.length || 0} stations)</small></span>
                    <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => handleImportGym(g)}>Import</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="animate-fade-in">
          {gymDraft ? (
            <div style={{ marginBottom: '1.5rem' }}>{renderGymForm()}</div>
          ) : (
            <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>{activeGym.emoji || '🏋️'} {activeGym.name}</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {activeGym.stations.length > 0 && (
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => setTarget({ kind: 'weights' })} title="Edit every station's weights on one screen">
                    ⚖️ Weights
                  </button>
                )}
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => setGymDraft({ id: activeGym.id, name: activeGym.name, emoji: activeGym.emoji || '🏋️', isPublic: activeGym.isPublic === true })}>
                  Edit Gym
                </button>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => { setShareOpen(v => !v); if (!activeGym.shareToken) createShareLink(); }}>
                  🔗 Share
                </button>
                {activeGym.stations.length > 0 && (
                  <a className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} href={`/workout/config/qr?gym=${encodeURIComponent(activeGym.id)}`} title="Print QR stickers for your equipment">
                    🖨 QR
                  </a>
                )}
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => { setActiveGymId(null); setTarget(null); }}>
                  Exit Gym
                </button>
              </div>
            </div>
          )}

          {shareOpen && (
            <div className="workout-form-panel" style={{ marginBottom: '1rem' }}>
              <strong>Share this gym</strong>
              <p className="workout-hint" style={{ margin: '0.25rem 0 0.5rem' }}>Anyone with the link (and a workout login) can preview it and import their own copy. Your history stays private.</p>
              {shareUrl ? (
                <>
                  <input className="workout-input" readOnly value={shareUrl} onFocus={e => e.target.select()} aria-label="Share link" />
                  <div className="workout-btn-row">
                    <button className="workout-btn-primary" onClick={copyShareLink}>{copied ? '✅ Copied' : 'Copy / share link'}</button>
                    <button className="btn btn-secondary" disabled={saving} onClick={() => createShareLink(true)}>New link</button>
                    <button className="btn btn-secondary" disabled={saving} onClick={stopSharing}>Turn off</button>
                  </div>
                </>
              ) : <p className="workout-hint">{saving ? 'Creating link…' : 'No link yet.'}</p>}
            </div>
          )}

          {target?.kind === 'weights' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <StationWeightsEditor
                stations={activeGym.stations}
                intro={target.intro}
                saving={saving}
                onSave={stations => saveActiveGym(stations)}
                onCancel={() => setTarget(null)}
              />
            </div>
          )}

          {target?.kind !== 'weights' && (<>
          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--accent-light)' }}>Stations & Equipment</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            {activeGym.stations.map(st => {
              const editingStation = target?.kind === 'station' && target.stationId === st.id;
              return (
                <div key={st.id} style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--surface-border)', padding: '1rem', borderRadius: '12px' }}>
                  <div className="workout-flex-between" style={{ marginBottom: '0.5rem', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <strong style={{ flex: 1 }}>
                      {st.name} <span className="workout-pill">{st.type}</span>
                    </strong>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="workout-text-btn" onClick={() => setTarget(editingStation ? null : { kind: 'station', stationId: st.id })}>
                        {editingStation ? 'Close' : 'Edit'}
                      </button>
                      <button className="workout-text-btn danger" onClick={() => deleteStation(st)}>Delete Station</button>
                    </div>
                  </div>

                  {editingStation && <StationForm initial={st} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} />}

                  {st.type === 'cable' && st.attachments && st.attachments.length > 0 && (
                    <div className="workout-hint" style={{ marginBottom: '0.5rem' }}>Attachments: {st.attachments.join(', ')}</div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {st.lifts.map(l => {
                      const editingLift = target?.kind === 'lift' && target.stationId === st.id && target.liftId === l.id;
                      return (
                        <div key={l.id}>
                          <div className="workout-list-row">
                            <div>
                              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{l.name}</span>
                              <div className="workout-hint">{describeLift(l)}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                              <button className="workout-text-btn" onClick={() => setTarget(editingLift ? null : { kind: 'lift', stationId: st.id, liftId: l.id })}>
                                {editingLift ? 'Close' : 'Edit'}
                              </button>
                              <button className="workout-text-btn danger" onClick={() => deleteLift(st, l)}>Delete</button>
                            </div>
                          </div>
                          {editingLift && <LiftForm station={st} initial={l} saving={saving} onSave={lift => saveLift(st, lift)} onCancel={() => setTarget(null)} />}
                        </div>
                      );
                    })}
                    {st.lifts.length === 0 && <p className="workout-hint" style={{ margin: '0.25rem 0' }}>No lifts configured.</p>}
                  </div>

                  {target?.kind === 'lift' && target.stationId === st.id && target.liftId === 'new' ? (
                    <LiftForm station={st} saving={saving} onSave={lift => saveLift(st, lift)} onCancel={() => setTarget(null)} />
                  ) : target?.kind === 'quick-lifts' && target.stationId === st.id ? (
                    <QuickAddLifts station={st} saving={saving} onSave={lifts => addLifts(st, lifts)} onCancel={() => setTarget(null)}
                      onCustom={() => setTarget({ kind: 'lift', stationId: st.id, liftId: 'new' })} />
                  ) : (
                    <button className="btn btn-secondary" style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem', marginTop: '0.5rem' }} onClick={() => setTarget({ kind: 'quick-lifts', stationId: st.id })}>
                      + Add Lifts to {st.name}
                    </button>
                  )}
                </div>
              );
            })}
            {activeGym.stations.length === 0 && (
              <div className="workout-form-panel">
                <strong>Start from a template</strong>
                <p className="workout-hint" style={{ margin: '0.25rem 0 0.75rem' }}>Adds typical equipment with its lifts in one go — edit or delete anything afterwards.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {GYM_TEMPLATES.map(t => (
                    <button key={t.key} className="btn btn-secondary" disabled={saving} style={{ textAlign: 'left', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }} onClick={() => applyTemplate(t.key)}>
                      <strong>{t.name}</strong>
                      <span className="workout-hint">{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          </>)}

          {target?.kind === 'pick-equipment' ? (
            <EquipmentPicker
              existingNames={activeGym.stations.map(s => s.name)}
              library={library}
              onPickStation={station => setTarget({ kind: 'station', stationId: 'new', copyFrom: station })}
              onPick={preset => setTarget({ kind: 'station', stationId: 'new', preset: preset || undefined })}
              onCancel={() => setTarget(null)}
            />
          ) : target?.kind === 'station' && target.stationId === 'new' ? (
            <StationForm preset={target.preset} copyFrom={target.copyFrom} saving={saving} onSave={saveStation} onCancel={() => setTarget(null)} />
          ) : (
            <div className="workout-btn-row">
              <button className="workout-btn-primary" onClick={() => setTarget({ kind: 'pick-equipment' })} style={{ background: 'transparent', border: '1px dashed var(--accent)', color: 'var(--accent)', boxShadow: 'none', fontSize: '0.95rem', padding: '0.75rem' }}>
                + Add Equipment Station
              </button>
            </div>
          )}
        </div>
      )}

      {popup}
    </div>
  );
}
