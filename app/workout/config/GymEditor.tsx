'use client';

import { useState, useEffect } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { GYM_EMOJIS, type Gym, type Station } from '@/lib/workout/types';
import { GYM_TEMPLATES, stationsFromTemplate } from '@/lib/workout/catalog';
import { copyStations, equipmentLibrary } from '@/lib/workout/equipment-library';
import GymStations, { type WeightsCheck } from '@/components/workout/GymStations';
import Sheet from '@/components/workout/Sheet';

/** `copyFrom`: 'gym:<id>' or 'template:<key>' to start a new gym with that equipment. */
type GymDraft = { id: string | null; name: string; emoji: string; isPublic: boolean; copyFrom: string };
const EMPTY_GYM_DRAFT: GymDraft = { id: null, name: '', emoji: '🏋️', isPublic: false, copyFrom: '' };
const TEMPLATE_ICONS: Record<string, string> = { commercial: '🏢', home: '🏠', hotel: '🧳' };

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const liftCount = (gym: Gym) => gym.stations.reduce((n, s) => n + (s.lifts?.length || 0), 0);
const gymMeta = (gym: Gym) => `${plural(gym.stations?.length || 0, 'piece')} of equipment · ${plural(liftCount(gym), 'lift')}`;

export default function GymEditor() {
  const { confirm, popup } = useSitePopup();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  const [gymDraft, setGymDraft] = useState<GymDraft | null>(null);
  const [weightsCheck, setWeightsCheck] = useState<WeightsCheck | null>(null);
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

  /** Run a save and surface failures instead of silently ignoring them. Resolves true on success. */
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const replaceGym = (gym: Gym) => setGyms(prev => prev.map(g => (g.id === gym.id ? gym : g)));
  const openGym = (id: string | null) => {
    setActiveGymId(id);
    setWeightsCheck(null);
    setShareOpen(false);
    window.scrollTo({ top: 0 });
  };

  const saveStations = (stations: Station[]) => run(async () => {
    if (!activeGym) return;
    const data = await requestJson('/api/workout/gyms', { method: 'PUT', body: JSON.stringify({ ...activeGym, stations }) });
    replaceGym(data.gym);
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
      const source = gymDraft.copyFrom;
      const stations = source.startsWith('gym:')
        ? copyStations(gyms.find(g => g.id === source.slice(4))?.stations || [])
        : source.startsWith('template:') ? stationsFromTemplate(source.slice(9)) : [];
      const data = await requestJson('/api/workout/gyms', { method: 'POST', body: JSON.stringify({ ...fields, stations }) });
      setGyms(prev => [...prev, data.gym]);
      openGym(data.gym.id);
      if (stations.length > 0) {
        setWeightsCheck({
          intro: source.startsWith('gym:')
            ? 'Same equipment, new gym: fix any weights that differ here and untick anything this gym doesn’t have.'
            : 'Typical weights are filled in. Change anything that differs and untick what this gym doesn’t have.',
        });
      }
    }
    setGymDraft(null);
  });

  const handleDeleteGym = async (gym: Gym) => {
    const ok = await confirm({ title: 'Delete gym', message: `Delete ${gym.name} and all of its equipment? Past workouts keep their history.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    run(async () => {
      await requestJson(`/api/workout/gyms?id=${encodeURIComponent(gym.id)}`, { method: 'DELETE' });
      setGyms(prev => prev.filter(g => g.id !== gym.id));
      setGymDraft(null);
      if (activeGymId === gym.id) openGym(null);
    });
  };

  const handleImportGym = async (gym: Gym) => {
    const ok = await confirm({ title: 'Import gym', message: `Copy all of ${gym.name}'s equipment and lifts into a new gym of your own?`, confirmLabel: 'Import' });
    if (!ok) return;
    run(async () => {
      const data = await requestJson('/api/workout/gyms', {
        method: 'POST',
        body: JSON.stringify({ name: `${gym.name} (Copy)`, emoji: gym.emoji, stations: copyStations(gym.stations), isPublic: false }),
      });
      setGyms(prev => [...prev, data.gym]);
      openGym(data.gym.id);
    });
  };

  // ─── Sharing ───────────────────────────────────────────────────────────────

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

  if (loading) return <p className="workout-hint" style={{ padding: '1rem 0' }}>Loading gyms…</p>;

  const myGyms = gyms.filter(g => g.ownerId === userId);
  const otherGyms = gyms.filter(g => g.ownerId !== userId);
  // Your stations (and published gyms') that this gym doesn't have yet.
  const library = equipmentLibrary(gyms, activeGym);

  const gymSheet = gymDraft && (() => {
    const editing = gyms.find(g => g.id === gymDraft.id);
    const startOptions = [
      { value: '', icon: '📝', title: 'Nothing yet', hint: 'Add equipment as you go' },
      ...GYM_TEMPLATES.map(t => ({ value: `template:${t.key}`, icon: TEMPLATE_ICONS[t.key] || '🏋️', title: t.name, hint: t.description })),
      ...myGyms.filter(g => g.stations.length > 0).map(g => ({ value: `gym:${g.id}`, icon: g.emoji || '🏋️', title: `Copy ${g.name}`, hint: `${gymMeta(g)} — you’ll check the weights next` })),
    ];
    return (
      <Sheet
        title={editing ? 'Gym settings' : 'New gym'}
        onClose={() => setGymDraft(null)}
        footer={
          <button className="workout-button is-primary" disabled={!gymDraft.name.trim() || saving} onClick={handleSubmitGym}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Create gym'}
          </button>
        }
      >
        {error && <p className="workout-error" style={{ marginBottom: '0.75rem' }}>{error}</p>}
        <label className="workout-field" style={{ display: 'block' }}>
          <span className="workout-label">Name</span>
          <input className="workout-input" placeholder="e.g. Planet Fitness downtown" autoFocus={!editing} value={gymDraft.name} onChange={e => setGymDraft({ ...gymDraft, name: e.target.value })} />
        </label>

        <div className="workout-field">
          <span className="workout-label">Icon</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0.4rem' }}>
            {GYM_EMOJIS.map(em => (
              <button key={em} type="button" className="workout-choice" style={{ minHeight: 48, fontSize: '1.4rem' }} aria-pressed={gymDraft.emoji === em} aria-label={`Icon ${em}`} onClick={() => setGymDraft({ ...gymDraft, emoji: em })}>
                {em}
              </button>
            ))}
          </div>
        </div>

        {!editing && (
          <div className="workout-field">
            <span className="workout-label">Start with</span>
            <div className="workout-stack" role="radiogroup" aria-label="Start with">
              {startOptions.map(o => (
                <button key={o.value || 'empty'} type="button" role="radio" aria-checked={gymDraft.copyFrom === o.value} className="workout-choice is-row" onClick={() => setGymDraft({ ...gymDraft, copyFrom: o.value })}>
                  <span aria-hidden>{o.icon}</span>
                  <span className="workout-card-text">
                    <span className="workout-card-title">{o.title}</span>
                    <small style={{ display: 'block' }}>{o.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="workout-switch-row">
          <span>
            <strong style={{ display: 'block', fontSize: '0.92rem' }}>Let other people import it</strong>
            <span className="workout-hint">Lists this gym for other workout users to copy. Your workouts stay private.</span>
          </span>
          <input type="checkbox" checked={gymDraft.isPublic} onChange={e => setGymDraft({ ...gymDraft, isPublic: e.target.checked })} />
        </label>

        {editing && (
          <button type="button" className="workout-button is-danger is-block" onClick={() => handleDeleteGym(editing)}>Delete this gym</button>
        )}
      </Sheet>
    );
  })();

  if (!activeGym) {
    return (
      <div>
        {error && <p className="workout-error" style={{ marginBottom: '1rem' }}>{error}</p>}
        <div className="workout-section-title">Your gyms</div>
        {myGyms.length === 0 && (
          <p className="workout-hint" style={{ marginBottom: '0.75rem' }}>No gyms yet. Make one for each place you train — it only takes a minute.</p>
        )}
        <div className="workout-stack is-loose">
          {myGyms.map(g => (
            <button key={g.id} className="workout-gym-card" onClick={() => openGym(g.id)}>
              <span className="workout-avatar" aria-hidden>{g.emoji || '🏋️'}</span>
              <span className="workout-card-text">
                <span className="workout-card-title">{g.name}</span>
                <span className="workout-card-meta">{gymMeta(g)}</span>
                <span className="workout-card-meta">{g.isPublic ? '🌐 Others can import' : '🔒 Private'}</span>
              </span>
              <span className="workout-chevron" aria-hidden>›</span>
            </button>
          ))}
          <button className="workout-button is-primary is-block" style={{ minHeight: 52 }} onClick={() => { setError(''); setGymDraft(EMPTY_GYM_DRAFT); }}>+ New gym</button>
        </div>

        {otherGyms.length > 0 && (<>
          <div className="workout-section-title" style={{ marginTop: '2rem' }}>Other people&apos;s gyms</div>
          <div className="workout-stack">
            {otherGyms.map(g => (
              <div key={g.id} className="workout-gym-card" style={{ cursor: 'default' }}>
                <span className="workout-avatar is-small" aria-hidden>{g.emoji || '🏋️'}</span>
                <span className="workout-card-text">
                  <span className="workout-card-title">{g.name}</span>
                  <span className="workout-card-meta">{gymMeta(g)}</span>
                </span>
                <button className="workout-button is-small" disabled={saving} onClick={() => handleImportGym(g)}>Import</button>
              </div>
            ))}
          </div>
        </>)}
        {gymSheet}
        {popup}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <button className="workout-button is-small" style={{ marginBottom: '0.9rem' }} onClick={() => openGym(null)}>‹ All gyms</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        <span className="workout-avatar" aria-hidden>{activeGym.emoji || '🏋️'}</span>
        <div className="workout-card-text">
          <h2 style={{ margin: 0, fontSize: '1.25rem', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{activeGym.name}</h2>
          <span className="workout-card-meta">{gymMeta(activeGym)} · {activeGym.isPublic ? 'others can import' : 'private'}</span>
        </div>
      </div>

      <div className="workout-action-bar">
        <button className="workout-action-tile" disabled={activeGym.stations.length === 0} onClick={() => setWeightsCheck({})}>
          <span aria-hidden>⚖️</span><span>Weights</span>
        </button>
        <button className="workout-action-tile" onClick={() => { setShareOpen(true); if (!activeGym.shareToken) createShareLink(); }}>
          <span aria-hidden>🔗</span><span>Share</span>
        </button>
        {activeGym.stations.length > 0 ? (
          <a className="workout-action-tile" href={`/workout/config/qr?gym=${encodeURIComponent(activeGym.id)}`}>
            <span aria-hidden>🖨️</span><span>QR labels</span>
          </a>
        ) : (
          <button className="workout-action-tile" disabled><span aria-hidden>🖨️</span><span>QR labels</span></button>
        )}
        <button className="workout-action-tile" onClick={() => { setError(''); setGymDraft({ id: activeGym.id, name: activeGym.name, emoji: activeGym.emoji || '🏋️', isPublic: activeGym.isPublic === true, copyFrom: '' }); }}>
          <span aria-hidden>⚙️</span><span>Settings</span>
        </button>
      </div>

      {error && !gymDraft && <p className="workout-error" style={{ marginTop: '0.75rem' }}>{error}</p>}

      <div className="workout-section-title">
        Equipment
        {activeGym.stations.length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>tap one to see its lifts</span>}
      </div>
      <GymStations
        // Re-mount per gym so open cards and sheets don't carry over.
        key={activeGym.id}
        gym={activeGym}
        library={library}
        saving={saving}
        saveStations={saveStations}
        weightsCheck={weightsCheck}
        setWeightsCheck={setWeightsCheck}
      />

      {shareOpen && (
        <Sheet title="Share this gym" subtitle={activeGym.name} onClose={() => setShareOpen(false)}
          footer={shareUrl ? <button className="workout-button is-primary" onClick={copyShareLink}>{copied ? '✅ Copied' : 'Copy / share link'}</button> : undefined}>
          <p className="workout-hint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Anyone with the link (and a workout login) can preview this gym and import their own copy. Your workout history stays private.
          </p>
          {error && <p className="workout-error">{error}</p>}
          {shareUrl ? (<>
            <input className="workout-input" readOnly value={shareUrl} onFocus={e => e.target.select()} aria-label="Share link" />
            <div className="workout-grid-2">
              <button className="workout-button" disabled={saving} onClick={() => createShareLink(true)}>New link</button>
              <button className="workout-button is-danger" disabled={saving} onClick={stopSharing}>Turn off</button>
            </div>
            <p className="workout-hint">“New link” stops the old one working.</p>
          </>) : <p className="workout-hint">{saving ? 'Creating link…' : 'No link yet.'}</p>}
        </Sheet>
      )}
      {gymSheet}
      {popup}
    </div>
  );
}
