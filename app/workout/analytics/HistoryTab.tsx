'use client';

import { useState } from 'react';
import type { AnalyticsTabProps } from './types';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { titleCase } from './shared';

// Props are the analytics page's shared data and handlers this tab reads.
export default function HistoryTab({ allLiftsMap, calibrationByLift, calibrations, getScaleFactorForLiftDisplay, gymNameMap, handleDeleteLog, history }: Pick<AnalyticsTabProps, 'allLiftsMap' | 'calibrationByLift' | 'calibrations' | 'getScaleFactorForLiftDisplay' | 'gymNameMap' | 'handleDeleteLog' | 'history'>) {
   const [auditPage, setAuditPage] = useState(0);
   const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
   const [linkLiftModal, setLinkLiftModal] = useState<{ gymId: string; liftKey: string; stationType: string } | null>(null);
   const [linkLiftNewKey, setLinkLiftNewKey] = useState('');
   const [linkLiftSaving, setLinkLiftSaving] = useState(false);
   const [linkLiftSaved, setLinkLiftSaved] = useState(false);


   return (
      <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* ═══ Calibration History ═══ */}
                <div className="workout-tile">
                   <h3 style={{ margin: '0 0 1rem 0' }}>Calibration History</h3>
                   {calibrations.length === 0 ? (
                     <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No calibration data yet. This appears after you use a stack/cable lift in a new gym.</p>
                   ) : (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {Object.keys(calibrationByLift).map((liftKey) => {
                           const entries = calibrationByLift[liftKey];
                           return (
                             <div key={liftKey} style={{ background: 'var(--input-bg)', borderRadius: '10px', padding: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                   <strong style={{ fontSize: '0.9rem' }}>{titleCase(liftKey)}</strong>
                                   <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{entries.length} gym{entries.length !== 1 ? 's' : ''}</span>
                                      <button
                                         className="btn btn-secondary"
                                         style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem', borderRadius: '6px' }}
                                         onClick={() => {
                                            setLinkLiftModal({ gymId: entries[0]?.gymId || '', liftKey, stationType: entries[0]?.stationType || 'stack' });
                                            setLinkLiftNewKey(liftKey);
                                            setLinkLiftSaved(false);
                                         }}
                                      >Link Lift</button>
                                   </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                   {entries.map((entry: any) => {
                                      const gymName = gymNameMap.get(entry.gymId) || 'Unknown Gym';
                                      const updatedDate = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : 'Unknown';
                                      const confidencePct = entry.confidence ? Math.round(entry.confidence * 100) : 0;
                                      return (
                                        <div key={`${entry.gymId}-${entry.updatedAt}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.8rem' }}>
                                           <span style={{ color: 'var(--muted)' }}>{gymName}</span>
                                           <span>
                                              Scale ×{Number(entry.scaleFactor || 1).toFixed(2)}
                                              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
                                                 {entry.stationType || 'station'} • {updatedDate} • {confidencePct}% conf
                                              </span>
                                           </span>
                                        </div>
                                      );
                                   })}
                                </div>
                                {/* Inline Link Lift Form */}
                                {linkLiftModal?.liftKey === liftKey && (
                                  <div className="animate-fade-in" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--background)', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                                    <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                                       <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Link Lift Key</h4>
                                       <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setLinkLiftModal(null)}>✕</button>
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>
                                       Manually set the lift name that this calibration entry matches. Used for fuzzy-matching when equipment names differ between gyms.
                                    </p>
                                    <div style={{ marginBottom: '0.5rem' }}>
                                       <label style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block', marginBottom: '0.25rem' }}>New lift name</label>
                                       <input
                                          className="workout-input"
                                          style={{ marginBottom: 0, fontSize: '0.85rem', padding: '0.5rem' }}
                                          placeholder="e.g. chest press, lat pulldown..."
                                          value={linkLiftNewKey}
                                          onChange={e => setLinkLiftNewKey(e.target.value)}
                                       />
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                       <button
                                          className="workout-btn-primary"
                                          style={{ margin: 0, flex: 1, opacity: linkLiftSaving ? 0.5 : 1, padding: '0.4rem', fontSize: '0.85rem' }}
                                          disabled={linkLiftSaving || !linkLiftNewKey.trim()}
                                          onClick={async () => {
                                             if (!linkLiftModal || !linkLiftNewKey.trim()) return;
                                             setLinkLiftSaving(true);
                                             try {
                                                const res = await fetch('/api/workout/calibration', {
                                                   method: 'PATCH',
                                                   headers: { 'Content-Type': 'application/json' },
                                                   body: JSON.stringify({
                                                      gymId: linkLiftModal.gymId,
                                                      liftKey: linkLiftNewKey.trim(),
                                                      stationType: linkLiftModal.stationType,
                                                      scaleFactor: calibrations.find(c => c.gymId === linkLiftModal.gymId && c.liftKey === linkLiftModal.liftKey)?.scaleFactor ?? 1,
                                                      confidence: calibrations.find(c => c.gymId === linkLiftModal.gymId && c.liftKey === linkLiftModal.liftKey)?.confidence ?? 0.5,
                                                   }),
                                                });
                                                if ((await res.json()).success) {
                                                   setLinkLiftSaved(true);
                                                   setTimeout(() => { setLinkLiftModal(null); setLinkLiftSaved(false); window.location.reload(); }, 1200);
                                                }
                                             } catch { /* silent */ }
                                             setLinkLiftSaving(false);
                                          }}
                                       >
                                          {linkLiftSaving ? 'Saving...' : linkLiftSaved ? '✓ Saved!' : 'Save Link'}
                                       </button>
                                       <button className="btn btn-secondary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem' }} onClick={() => setLinkLiftModal(null)}>Cancel</button>
                                    </div>
                                  </div>
                                )}
                             </div>
                           );
                        })}
                     </div>
                   )}
                </div>

                {/* ═══ Raw History Audit Log ═══ */}
                <div className="workout-tile">
                  <h3 style={{ margin: '0 0 1rem 0' }}>Raw Audit Log</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {history.slice().reverse().slice(auditPage * 5, (auditPage + 1) * 5).map((h, i) => (
                         <div key={h.id} style={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '8px' }}>
                             <div className="workout-flex-between" style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => setExpandedAudit(expandedAudit === h.id ? null : h.id)}>
                                <div>
                                   <strong style={{ fontSize: '0.9rem' }}>{h.type?.name || 'Workout'}</strong>
                                   <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>{new Date(h.timestamp).toLocaleDateString()} • {h.calories} kcal</p>
                                </div>
                                <span style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>{expandedAudit === h.id ? '▴' : '▾'}</span>
                             </div>
                             
                             {expandedAudit === h.id && (
                                <div className="animate-fade-in" style={{ padding: '0.75rem', borderTop: '1px solid var(--surface-border)', background: 'var(--input-bg)', borderRadius: '0 0 8px 8px' }}>
                                   {h.logs && Object.keys(h.logs).length > 0 ? (
                                     <>
                                       {/* Per-workout summary */}
                                        {(() => {
                                           let totalW = 0, totalR = 0, totalSets = 0, totalVol = 0;
                                           Object.keys(h.logs).forEach((liftId) => {
                                              const scaleFactor = getScaleFactorForLiftDisplay(h, liftId);
                                              h.logs[liftId].forEach((s: any) => {
                                                 const scaledWeight = s.weight * scaleFactor;
                                                 totalW += scaledWeight;
                                                 totalR += s.reps;
                                                 totalSets++;
                                                 totalVol += scaledWeight * s.reps;
                                              });
                                           });
                                           return (
                                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.7rem', textAlign: 'center' }}>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalSets > 0 ? Math.round(totalW / totalSets) : 0}</div>Avg Weight</div>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalSets > 0 ? (totalR / totalSets).toFixed(1) : 0}</div>Avg Reps</div>
                                                <div style={{ background: 'var(--background)', padding: '0.4rem', borderRadius: '6px' }}><div style={{ fontWeight: 700 }}>{totalVol.toLocaleString()}</div>Total Vol</div>
                                             </div>
                                          );
                                       })()}
                                        {Object.keys(h.logs).map(liftId => {
                                            const sets = h.logs[liftId];
                                            const scaleFactor = getScaleFactorForLiftDisplay(h, liftId);
                                            const liftName = allLiftsMap.get(liftId) || liftId;
                                            const topSet = sets.reduce((best: any, s: any) => (s.weight > (best?.weight || 0) ? s : best), null);
                                            const top1RM = topSet ? Math.round(calcAverage1RM(topSet.weight * scaleFactor, topSet.reps)) : 0;
                                            const scaledVolume = sets.reduce((sum: number, s: any) => sum + ((s.weight * scaleFactor) * s.reps), 0);
                                            return (
                                               <div key={liftId} style={{ marginBottom: '0.75rem' }}>
                                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                     <strong style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>{liftName}</strong>
                                                     {top1RM > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Est. 1RM: {top1RM}</span>}
                                                  </div>
                                                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                                                     {sets.length} sets • {scaledVolume.toFixed(0)} lbs volume
                                                     {scaleFactor !== 1 && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>Scale ×{scaleFactor.toFixed(2)}</span>}
                                                     {sets.map((s:any, idx:number) => (
                                                       <div key={idx} style={{ paddingLeft: '0.5rem' }}>
                                                         {idx+1}. {s.weight} lbs × {s.reps}
                                                         {typeof s.rir === 'number' ? ` • RIR ${s.rir >= 5 ? '5+' : s.rir}` : ''}
                                                       </div>
                                                     ))}
                                                   </div>
                                                </div>
                                            );
                                        })}
                                     </>
                                   ) : <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>No detailed set logs.</p>}
                                   
                                   <button onClick={() => handleDeleteLog(h.id)} style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem' }}>✕ Delete Workout</button>
                                </div>
                             )}
                         </div>
                      ))}
                      {history.length > 5 && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={auditPage === 0} onClick={() => setAuditPage(prev => Math.max(0, prev - 1))}>Prev</button>
                              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={(auditPage + 1) * 5 >= history.length} onClick={() => setAuditPage(prev => prev + 1)}>Next</button>
                          </div>
                      )}
                      {history.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No workouts tracked yet.</p>}
                  </div>
               </div>
               </div>
      </>
   );
}
