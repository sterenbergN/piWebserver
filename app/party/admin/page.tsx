'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TriviaQuestion } from '@/lib/party/prompts';

type GameKey = 'quipClash' | 'theFaker' | 'triviaQuestions' | 'bracketBattles';

export default function AdminPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<{ quipClash: string[]; theFaker: string[]; bracketBattles: string[]; triviaQuestions: TriviaQuestion[] }>({ quipClash: [], theFaker: [], bracketBattles: [], triviaQuestions: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bulk Import state
  const [showImport, setShowImport] = useState<GameKey | null>(null);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState<'merge'|'replace'>('merge'); 

  useEffect(() => {
    fetch('/api/party/admin-check').then(r => r.json()).then(d => {
      if (!d.isAdmin) setUnauthorized(true);
      else {
        fetch('/api/party/prompts').then(res => res.json()).then(data => { setPrompts(data); setLoading(false); });
      }
    });
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/party/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prompts) });
    setSaving(false);
    showToast('✅ All changes saved!');
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
            parsed.push({ question: q, choices, answer: ans });
          }
        }
      }
      setPrompts(p => ({ ...p, triviaQuestions: importMode === 'merge' ? [...p.triviaQuestions, ...parsed] : parsed }));
    } else {
      setPrompts(p => ({ ...p, [showImport]: importMode === 'merge' ? [...p[showImport], ...lines] : lines }));
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
                <div className="mb-4 text-sm text-muted">Format: <code>Question | Choice A | Choice B | Choice C | Choice D | CorrectIndex(0-3)</code><br/>One question per line. Example:<br/><code style={{color:'var(--party-purple-lt)'}}>What is 2+2? | 3 | 4 | 5 | 6 | 1</code></div>
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
            <p>Add, edit, or remove prompts and tasks for your games.</p>
          </div>
          <div className="admin-header-actions">
            <button onClick={() => router.push('/party')} className="party-btn party-btn-outline party-btn-inline">← Back to Party</button>
            <button onClick={handleSave} disabled={saving} className="party-btn party-btn-green party-btn-inline">{saving ? '⏳ Saving...' : '💾 Save All'}</button>
          </div>
        </div>

        <div className="admin-columns" style={{ gridTemplateColumns: '1fr' }}>
          {/* QUIP CLASH & FAKER & BRACKET BATTLES */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
            {(['quipClash', 'theFaker', 'bracketBattles'] as const).map(k => (
              <div key={k} className={`admin-section ${ColorMap[k]}`}>
                <div className="admin-section-header">
                  <div className="admin-section-header-left"><span className="admin-section-title">{LabelMap[k]}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="admin-section-count">{prompts[k].length}</span>
                    <button onClick={() => setShowImport(k)} className="party-btn party-btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}>📋 Import</button>
                  </div>
                </div>
                <div className="admin-prompt-list">
                  {prompts[k].map((p, i) => (
                    <div key={i} className="admin-prompt-row">
                      <span className="admin-prompt-index">{i + 1}</span>
                      <input type="text" value={p} onChange={e => { const u=[...prompts[k]]; u[i]=e.target.value; setPrompts({...prompts, [k]:u}); }} className="admin-prompt-input" />
                      <button className="admin-delete-btn" onClick={() => { const u=[...prompts[k]]; u.splice(i,1); setPrompts({...prompts, [k]:u}); }}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="admin-section-footer">
                  <button className="admin-add-btn" onClick={() => { setPrompts({...prompts, [k]: [...prompts[k], '']}); }}>+ Add Prompt</button>
                </div>
              </div>
            ))}
          </div>

          {/* TRIVIA DEATH */}
          <div className="admin-section purple" style={{ marginTop: '1.5rem' }}>
            <div className="admin-section-header">
              <div className="admin-section-header-left"><span className="admin-section-title">{LabelMap.triviaQuestions}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="admin-section-count">{prompts.triviaQuestions.length}</span>
                <button onClick={() => setShowImport('triviaQuestions')} className="party-btn party-btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}>📋 Import</button>
              </div>
            </div>
            <div className="admin-prompt-list" style={{ maxHeight: '80vh' }}>
              {prompts.triviaQuestions.map((q, i) => (
                <div key={i} className="admin-prompt-row" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', gap: '0.5rem', background: 'rgba(0,0,0,0.4)', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800 }}>Question {i+1}</div>
                    <button className="admin-delete-btn" onClick={() => { const u=[...prompts.triviaQuestions]; u.splice(i,1); setPrompts({...prompts, triviaQuestions:u}); }}>✕ Delete</button>
                  </div>
                  <input type="text" value={q.question} onChange={e => { const u=[...prompts.triviaQuestions]; u[i].question=e.target.value; setPrompts({...prompts, triviaQuestions:u}); }} className="player-input" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.5rem', width: '100%' }} placeholder="Question?" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    {[0,1,2,3].map(cIdx => (
                      <div key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <input type="radio" checked={q.answer === cIdx} onChange={() => { const u=[...prompts.triviaQuestions]; u[i].answer=cIdx; setPrompts({...prompts, triviaQuestions:u}); }} />
                        <input type="text" value={q.choices[cIdx]} onChange={e => { const u=[...prompts.triviaQuestions]; u[i].choices[cIdx]=e.target.value; setPrompts({...prompts, triviaQuestions:u}); }} className="player-input" style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} placeholder={`Choice ${['A','B','C','D'][cIdx]}`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="admin-section-footer">
              <button className="admin-add-btn" onClick={() => setPrompts({...prompts, triviaQuestions: [...prompts.triviaQuestions, {question: '', choices: ['','','',''], answer: 0}]})}>+ Add Trivia Question</button>
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
