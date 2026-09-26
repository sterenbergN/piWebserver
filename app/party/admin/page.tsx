'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { PromptLists, PromptsData, TriviaQuestion } from '@/lib/party/prompts';

type GameKey = 'quipClash' | 'theFaker' | 'triviaQuestions' | 'bracketBattles';

export default function AdminPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PromptsData>({ quipClash: [], theFaker: [], bracketBattles: [], triviaQuestions: [], packs: [] });
  // 'classic' edits the top-level lists; any other id edits that themed pack.
  const [activePack, setActivePack] = useState('classic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bulk Import state
  const [showImport, setShowImport] = useState<GameKey | null>(null);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge'|'replace'>('merge');
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');

  const pack = activePack === 'classic' ? null : prompts.packs?.find(p => p.id === activePack) || null;
  const lists: PromptLists = pack || prompts;

  // Every edit goes through here so the page knows there is something to save.
  const edit = (updater: (l: PromptLists) => PromptLists) => {
    setPrompts(p => activePack === 'classic'
      ? { ...p, ...updater(p) }
      : { ...p, packs: (p.packs || []).map(pk => pk.id === activePack ? { ...pk, ...updater(pk) } : pk) });
    setDirty(true);
  };
  const editPackMeta = (patch: { name?: string; emoji?: string }) => {
    setPrompts(p => ({ ...p, packs: (p.packs || []).map(pk => pk.id === activePack ? { ...pk, ...patch } : pk) }));
    setDirty(true);
  };
  const addPack = () => {
    const id = `pack-${Date.now().toString(36)}`;
    setPrompts(p => ({ ...p, packs: [...(p.packs || []), { id, name: 'New Pack', emoji: '🎲', quipClash: [], theFaker: [], bracketBattles: [], triviaQuestions: [] }] }));
    setActivePack(id);
    setDirty(true);
  };
  const deletePack = () => {
    if (!pack || !window.confirm(`Delete the "${pack.name}" pack and all its prompts?`)) return;
    setPrompts(p => ({ ...p, packs: (p.packs || []).filter(pk => pk.id !== activePack) }));
    setActivePack('classic');
    setDirty(true);
  };
  const totalEntries = (d: PromptsData) => [d, ...(d.packs || [])]
    .reduce((n, l) => n + l.quipClash.length + l.theFaker.length + l.bracketBattles.length + l.triviaQuestions.length, 0);
  const updateTrivia = (i: number, patch: Partial<TriviaQuestion>) =>
    edit(p => ({ ...p, triviaQuestions: p.triviaQuestions.map((q, j) => j === i ? { ...q, ...patch } : q) }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    fetch('/api/party/admin-check').then(r => r.json()).then(d => {
      if (!d.isAdmin) setUnauthorized(true);
      else {
        fetch('/api/party/prompts').then(res => res.json()).then(data => { setPrompts(data); setLoading(false); });
      }
    }).catch(() => setUnauthorized(true));
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/party/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prompts) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      // The server trims, de-duplicates and drops blank or incomplete entries.
      const before = totalEntries(prompts);
      const after = totalEntries(data.prompts);
      setPrompts(data.prompts);
      // Pack ids can be normalized on save; fall back to Classic if ours changed.
      if (!data.prompts.packs?.some((pk: { id: string }) => pk.id === activePack)) setActivePack('classic');
      setDirty(false);
      showToast(before > after ? `✅ Saved — removed ${before - after} blank/duplicate entr${before - after === 1 ? 'y' : 'ies'}` : '✅ All changes saved!');
    } catch (err) {
      showToast(`⚠️ ${err instanceof Error ? err.message : 'Save failed'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = () => {
    if (!showImport) return;
    const lines = importText.split('\n').map(l => l.trim()).filter(l => l);
    if (showImport === 'triviaQuestions') {
      const parsed: TriviaQuestion[] = [];
      for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 6) {
          const q = parts[0];
          const choices = [parts[1], parts[2], parts[3], parts[4]] as [string,string,string,string];
          const ans = parseInt(parts[5], 10);
          if (!isNaN(ans) && ans >= 0 && ans <= 3) {
            parsed.push({ question: q, choices, answer: ans, ...(parts[6] ? { category: parts[6] } : {}) });
          }
        }
      }
      edit(p => ({ ...p, triviaQuestions: importMode === 'merge' ? [...p.triviaQuestions, ...parsed] : parsed }));
    } else {
      edit(p => ({ ...p, [showImport]: importMode === 'merge' ? [...p[showImport], ...lines] : lines }));
    }
    setShowImport(null);
    setImportText('');
    showToast('📦 Import added! Remember to save.');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result && typeof ev.target.result === 'string') {
        setImportText(ev.target.result);
      }
    };
    reader.readAsText(file);
  };

  if (unauthorized) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--party-bg)' }}>
      <div className="party-card text-center">
        <h2 className="text-red font-black text-3xl mb-4">Unauthorized</h2>
        <p className="mb-4">You need admin privileges to manage prompts.</p>
        <button onClick={() => router.push('/party')} className="party-btn party-btn-outline">Return to Party</button>
      </div>
    </div>
  );

  if (loading) return <div style={{ minHeight: '100vh', background: 'var(--party-bg)' }} />;

  const LabelMap = { quipClash: '⚡ Quip Clash', theFaker: '🕵️ The Faker', bracketBattles: '🏆 Bracket Battles', triviaQuestions: '💀 Trivia Death' };
  const ColorMap = { quipClash: 'yellow', theFaker: 'red', bracketBattles: 'cyan', triviaQuestions: 'purple-lt' };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--party-bg)', position: 'relative' }}>
      {toast && <div className="admin-toast">{toast}</div>}

      {/* IMPORT MODAL */}
      {showImport && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Bulk Import - {LabelMap[showImport]}</h2>
              <button className="admin-modal-close" onClick={() => setShowImport(null)}>✕</button>
            </div>
            <div className="admin-modal-body">
              {showImport === 'triviaQuestions' ? (
                <div className="mb-4 text-sm text-muted">Format: <code>Question | Choice A | Choice B | Choice C | Choice D | CorrectIndex(0-3) | Category (optional)</code><br/>One question per line. Example:<br/><code style={{color:'var(--party-purple-lt)'}}>What is 2+2? | 3 | 4 | 5 | 6 | 1</code></div>
              ) : (
                <div className="mb-4 text-sm text-muted">Format: One prompt per line.</div>
              )}
              
              <label className="admin-file-label">
                <div>📁 Click to upload a .txt or .csv file</div>
                <input type="file" accept=".txt,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
              </label>
              <div className="text-center text-muted mb-4 text-sm font-bold">OR PASTE TEXT</div>
              
              <textarea className="admin-textarea" value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste prompts here..." />
              
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
                  <strong>Merge</strong> (Append to existing)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                  <strong className="text-red">Replace</strong> (Overwrite existing)
                </label>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button className="party-btn party-btn-outline" style={{width:'auto'}} onClick={() => setShowImport(null)}>Cancel</button>
              <button className={`party-btn bg-${ColorMap[showImport]}`} style={{width:'auto', color: '#fff'}} onClick={handleImport}>Import Prompts</button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-page party-content">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1>🎛 Prompt Manager</h1>
            <p>Add, edit, or remove prompts and tasks for your games.{dirty && <strong style={{ color: 'var(--party-yellow)' }}> • Unsaved changes</strong>}</p>
          </div>
          <div className="admin-header-actions">
            <button onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) router.push('/party'); }} className="party-btn party-btn-outline party-btn-inline">← Back to Party</button>
            <button onClick={handleSave} disabled={saving} className="party-btn party-btn-green party-btn-inline">{saving ? '⏳ Saving...' : '💾 Save All'}</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 800, color: 'var(--party-text-muted)' }}>Pack:</span>
          {[{ id: 'classic', name: 'Classic', emoji: '🎉' }, ...(prompts.packs || [])].map(pk => (
            <button key={pk.id} onClick={() => { setActivePack(pk.id); setFilter(''); }} aria-pressed={activePack === pk.id}
              className={activePack === pk.id ? 'party-btn party-btn-primary party-btn-inline' : 'party-btn party-btn-outline party-btn-inline'}
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>
              {pk.emoji} {pk.name}
            </button>
          ))}
          <button onClick={addPack} className="party-btn party-btn-outline party-btn-inline" style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>+ New pack</button>
        </div>
        {pack && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input className="party-input" style={{ width: '4.5rem', textAlign: 'center' }} value={pack.emoji} maxLength={8} aria-label="Pack emoji" onChange={e => editPackMeta({ emoji: e.target.value })} />
            <input className="party-input" style={{ flex: 1, minWidth: 180 }} value={pack.name} maxLength={40} aria-label="Pack name" onChange={e => editPackMeta({ name: e.target.value })} />
            <button onClick={deletePack} className="party-btn party-btn-outline party-btn-inline" style={{ color: 'var(--party-red)', borderColor: 'var(--party-red)' }}>Delete pack</button>
          </div>
        )}

        <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="🔍 Filter prompts and questions…" className="party-input"
          style={{ width: '100%', marginBottom: '1.5rem' }} />

        <div className="admin-columns" style={{ gridTemplateColumns: '1fr' }}>
          {/* QUIP CLASH & FAKER & BRACKET BATTLES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1.5rem' }}>
            {(['quipClash', 'theFaker', 'bracketBattles'] as const).map(k => (
              <div key={k} className={`admin-section ${ColorMap[k]}`}>
                <div className="admin-section-header">
                  <div className="admin-section-header-left"><span className="admin-section-title">{LabelMap[k]}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="admin-section-count">{lists[k].length}</span>
                    <button onClick={() => setShowImport(k)} className="party-btn party-btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}>📋 Import</button>
                  </div>
                </div>
                <div className="admin-prompt-list">
                  {lists[k].map((p, i) => (!filter || p.toLowerCase().includes(filter.toLowerCase())) && (
                    <div key={i} className="admin-prompt-row">
                      <span className="admin-prompt-index">{i + 1}</span>
                      <input type="text" value={p} onChange={e => edit(p => ({ ...p, [k]: p[k].map((x, j) => j === i ? e.target.value : x) }))} className="admin-prompt-input" />
                      <button className="admin-delete-btn" aria-label="Delete prompt" onClick={() => edit(p => ({ ...p, [k]: p[k].filter((_, j) => j !== i) }))}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="admin-section-footer">
                  <button className="admin-add-btn" onClick={() => { setFilter(''); edit(p => ({ ...p, [k]: [...p[k], ''] })); }}>+ Add Prompt</button>
                </div>
              </div>
            ))}
          </div>

          {/* TRIVIA DEATH */}
          <div className="admin-section purple" style={{ marginTop: '1.5rem' }}>
            <div className="admin-section-header">
              <div className="admin-section-header-left"><span className="admin-section-title">{LabelMap.triviaQuestions}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="admin-section-count">{lists.triviaQuestions.length}</span>
                <button onClick={() => setShowImport('triviaQuestions')} className="party-btn party-btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}>📋 Import</button>
              </div>
            </div>
            <div className="admin-prompt-list" style={{ maxHeight: '80vh' }}>
              {lists.triviaQuestions.map((q, i) => (!filter || [q.question, ...q.choices, q.category || ''].some(t => t.toLowerCase().includes(filter.toLowerCase()))) && (
                <div key={i} className="admin-prompt-row" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', gap: '0.5rem', background: 'rgba(0,0,0,0.4)', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800 }}>Question {i+1}</div>
                    <button className="admin-delete-btn" onClick={() => edit(p => ({ ...p, triviaQuestions: p.triviaQuestions.filter((_, j) => j !== i) }))}>✕ Delete</button>
                  </div>
                  <input type="text" value={q.question} onChange={e => updateTrivia(i, { question: e.target.value })} className="player-input" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.5rem', width: '100%' }} placeholder="Question?" />
                  <input type="text" value={q.category || ''} onChange={e => updateTrivia(i, { category: e.target.value })} className="player-input" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%' }} placeholder="Category (optional)" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    {[0,1,2,3].map(cIdx => (
                      <div key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <input type="radio" checked={q.answer === cIdx} aria-label={`Choice ${['A','B','C','D'][cIdx]} is correct`} onChange={() => updateTrivia(i, { answer: cIdx })} />
                        <input type="text" value={q.choices[cIdx]} onChange={e => updateTrivia(i, { choices: q.choices.map((c, j) => j === cIdx ? e.target.value : c) as TriviaQuestion['choices'] })} className="player-input" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} placeholder={`Choice ${['A','B','C','D'][cIdx]}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="admin-section-footer">
              <button className="admin-add-btn" onClick={() => { setFilter(''); edit(p => ({ ...p, triviaQuestions: [...p.triviaQuestions, { question: '', choices: ['','','',''], answer: 0 }] })); }}>+ Add Trivia Question</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '1rem', background: 'var(--party-bg)', borderTop: '1px solid var(--party-border)', display: 'flex', justifyContent: 'center', zIndex: 10 }}>
        <button onClick={handleSave} disabled={saving} className="party-btn party-btn-green party-btn-inline" style={{ width: '100%', maxWidth: '400px', padding: '1rem', fontSize: '1.2rem', boxShadow: '0 8px 32px rgba(34,197,94,0.4), 0 6px 0 rgba(22,101,52,0.8)' }}>
          {saving ? '⏳ Saving...' : '💾 Save All Changes'}
        </button>
      </div>
    </div>
  );
}
