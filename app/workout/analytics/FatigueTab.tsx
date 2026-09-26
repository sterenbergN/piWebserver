'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalyticsTabProps } from './types';

// Props are the analytics page's shared data and handlers this tab reads.
export default function FatigueTab({ achievedRatio, avgAchievedGrowth, avgTargetGrowth, intensityFactor, intensityInfo, muscleFatigue, overloadTracking, recoveryData, strengthWeight, targetRatioFor }: Pick<AnalyticsTabProps, 'achievedRatio' | 'avgAchievedGrowth' | 'avgTargetGrowth' | 'intensityFactor' | 'intensityInfo' | 'muscleFatigue' | 'overloadTracking' | 'recoveryData' | 'strengthWeight' | 'targetRatioFor'>) {
   const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
   const [overloadPage, setOverloadPage] = useState(0);
   const [expandedOverload, setExpandedOverload] = useState<string | null>(null);
   const listPageSize = 5;
   const overloadPageCount = Math.max(1, Math.ceil(overloadTracking.length / listPageSize));
   const safeOverloadPage = Math.min(overloadPage, overloadPageCount - 1);
   const overloadPageEntries = overloadTracking.slice(safeOverloadPage * listPageSize, (safeOverloadPage + 1) * listPageSize);
   const overloadRowRefs = useRef(new Map<string, HTMLDivElement>());
   const setOverloadRowRef = (key: string) => (el: HTMLDivElement | null) => {
      if (el) overloadRowRefs.current.set(key, el);
      else overloadRowRefs.current.delete(key);
   };
   useEffect(() => {
      if (!expandedOverload) return;
      overloadRowRefs.current.get(expandedOverload)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
   }, [expandedOverload]);

   return (
      <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* ═══ Muscle Fatigue Dashboard ═══ */}
                <div className="workout-tile">
                  <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>Muscle Fatigue Dashboard</h3>
                    <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'fatigue' ? null : 'fatigue')}>
                      {expandedInfo === 'fatigue' ? 'Hide ✕' : 'About ⓘ'}
                    </button>
                  </div>
                  
                  {expandedInfo === 'fatigue' && (
                     <div className="animate-fade-in" style={{ marginBottom: '1rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent)' }}>Fatigue Accumulation Math</h4>
                        <p>Muscle fatigue is an estimate of local fatigue designed to signal when a muscle needs a deload.</p>
                        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem', lineHeight: 1.8 }}>
                           <li><strong>Accumulation:</strong> Fatigue grows based on training volume (sets × reps × weight) scaled by the lift's intensity relative to your 1RM.</li>
                           <li><strong>Threshold:</strong> The baseline limit is <strong>40 points</strong>. If fatigue exceeds this, a deload is recommended.</li>
                           <li><strong>Decay:</strong> Fatigue naturally decays by approximately <strong>15%</strong> for every day of rest.</li>
                           <li><strong>Elevated:</strong> Yellow bars indicate that fatigue is high but has not yet crossed the deload threshold.</li>
                        </ul>
                     </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {muscleFatigue.map(f => (
                      <div key={f.muscle} style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', borderLeft: `3px solid ${f.recommendation === 'deload_recommended' ? 'var(--danger)' : f.recommendation === 'elevated' ? 'var(--warning)' : 'var(--success)'}` }}>
                        <div className="workout-flex-between">
                          <strong style={{ fontSize: '0.9rem' }}>{f.muscle}</strong>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: f.recommendation === 'deload_recommended' ? 'var(--danger)' : f.recommendation === 'elevated' ? 'var(--warning)' : 'var(--success)' }}>
                            {f.fatigueScore.toFixed(1)} / {f.threshold}
                          </span>
                        </div>
                        <div style={{ marginTop: '0.4rem', height: '6px', background: 'var(--surface-border)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, (f.fatigueScore / f.threshold) * 100)}%`,
                            height: '100%',
                            background: f.recommendation === 'deload_recommended' ? 'var(--danger)' : f.recommendation === 'elevated' ? 'var(--warning)' : 'var(--success)',
                            transition: 'width 0.5s ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem', fontSize: '0.7rem', color: 'var(--muted)' }}>
                          <span>{f.sessionsSinceRest} sessions tracked</span>
                          <span>{f.recommendation === 'deload_recommended' ? '🔴 Deload recommended' : f.recommendation === 'elevated' ? '🟡 Elevated' : '🟢 Normal'}</span>
                        </div>
                      </div>
                    ))}
                    {muscleFatigue.length === 0 && (
                      <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No fatigue data yet. Train at least 2 sessions.</p>
                    )}
                  </div>
                </div>

                {/* ═══ Recovery Analysis ═══ */}
                <div className="workout-tile">
                  <h3 style={{ margin: '0 0 1rem 0' }}>Recovery Analysis</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {recoveryData.slice(0, 5).map(r => (
                       <div key={r.muscle} className="workout-flex-between" style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '8px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.muscle}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                             {r.hoursSince < 48 ? '⚠️ <48h' : r.hoursSince > 168 ? '💤 >7d' : '✅ 48-72h'} ({Math.round(r.hoursSince)}h ago)
                          </span>
                       </div>
                    ))}
                  </div>
                </div>

                {/* ═══ Progressive Overload Factor Tile ═══ */}
                <div className="workout-tile">
                  <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>Progressive Overload Tracking</h3>
                    <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'overload' ? null : 'overload')}>
                      {expandedInfo === 'overload' ? 'Hide ✕' : 'About ⓘ'}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>
                     Intensity Factor: <strong style={{ color: intensityInfo.color }}>{intensityInfo.emoji} {intensityFactor.toFixed(2)}</strong>
                     <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>({intensityInfo.label})</span>
                  </p>

                  {expandedInfo === 'overload' && (
                     <div className="animate-fade-in" style={{ marginBottom: '1rem', background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent)' }}>How Progressive Overload Works</h4>
                        <p>Your intensity factor of <strong>{intensityFactor.toFixed(2)}</strong> controls how the progression engine selects your next workout:</p>
                        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem', lineHeight: 1.8 }}>
                            <li><strong>Target:</strong> <code style={{ color: 'var(--accent-light)' }}>1 + 5% × intensity × historyTrend + (perfScore − 1) × 0.5</code></li>
                            <li><strong>Progress:</strong> a blend of e1RM ratio and load ratio; higher intensity weighs e1RM more (currently {Math.round(strengthWeight * 100)}% e1RM)</li>
                            <li><strong>RIR Targeting:</strong> average RIR of 2 is neutral, 0-1 lowers the next progression, 3+ allows more aggressive overload</li>
                            <li><strong>Lift Eligibility:</strong> a lift appears only after at least 2 logged sessions with valid sets</li>
                        </ul>
                        <p>Each lift row shows load ratio and e1RM ratio, and compares their blend against the engine&apos;s target. When RIR is present, that session feedback also nudges the next target up or down.</p>
                      </div>
                   )}

                  {overloadTracking.length > 0 && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ background: 'var(--surface-border)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid var(--accent)' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Factor Analysis</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.2rem' }}>
                               <div>
                                  <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                                    {(avgAchievedGrowth * 100).toFixed(1)}%
                                  </div>
                                  <div style={{ fontSize: '0.75rem' }}>Avg Achieved Growth</div>
                               </div>
                                <div style={{ textAlign: 'right' }}>
                                   <div style={{ fontSize: '1.2rem', fontWeight: 600, color: intensityInfo.color }}>
                                    {(avgTargetGrowth * 100).toFixed(1)}%
                                   </div>
                                   <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Target Overload</div>
                                </div>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.5rem 0 0 0', fontStyle: 'italic' }}>
                               {avgAchievedGrowth > avgTargetGrowth
                                 ? 'You are outperforming your target. Consider increasing intensity if workouts feel too easy.'
                                 : avgAchievedGrowth > 0
                                    ? 'Progression is steady but below target. This is normal — trust the process.'
                                   : 'Growth is stalling. Consider a deload cycle or reducing intensity.'}
                            </p>
                        </div>
                        {overloadPageEntries.map((ol, i) => {
                           const targetRatio = targetRatioFor(ol);
                           const comparisonRatio = achievedRatio(ol);
                           const comparisonGrowth = comparisonRatio - 1;
                           const status = comparisonRatio >= targetRatio ? '🟢' : comparisonGrowth > 0 ? '🟡' : '🔴';
                           const comparisonLabel = 'Progress';
                           const rowId = `${ol.name}-${ol.date}-${safeOverloadPage * listPageSize + i}`;
                           const expanded = expandedOverload === rowId;
                            return (
                              <div key={rowId} ref={setOverloadRowRef(rowId)} style={{ background: 'var(--input-bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                 <div
                                   className="workout-flex-between"
                                   style={{ padding: '0.75rem', cursor: 'pointer', alignItems: 'center', gap: '0.75rem' }}
                                   onClick={() => setExpandedOverload(expanded ? null : rowId)}
                                 >
                                    <div style={{ minWidth: 0 }}>
                                       <strong style={{ fontSize: '0.85rem' }}>{ol.name}</strong>
                                       <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>
                                          {ol.prevWeight}×{ol.prevReps}×{ol.prevSets} → {ol.currWeight}×{ol.currReps}×{ol.currSets}
                                       </p>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                       <div style={{ fontSize: '1rem' }}>{status}</div>
                                       <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>
                                          {comparisonLabel} {(comparisonGrowth * 100).toFixed(1)}% {expanded ? '▴' : '▾'}
                                       </p>
                                    </div>
                                 </div>

                                 {expanded && (
                                   <div className="animate-fade-in" style={{ borderTop: '1px solid var(--surface-border)', padding: '0.65rem 0.75rem 0.75rem 0.75rem', background: 'var(--surface-glass)' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.05rem 0.35rem', borderRadius: '10px' }}>
                                          Expanded
                                        </span>
                                      </div>
                                       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                                          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.35rem 0.45rem' }}>
                                             <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Load Ratio</div>
                                             <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{((ol.overloadRatio - 1) * 100).toFixed(1)}%</div>
                                         </div>
                                         <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.35rem 0.45rem' }}>
                                            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>e1RM Ratio</div>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{((ol.intensityRatio - 1) * 100).toFixed(1)}%</div>
                                         </div>
                                          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.35rem 0.45rem' }}>
                                             <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Target Ratio</div>
                                             <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{((targetRatio - 1) * 100).toFixed(1)}%</div>
                                          </div>
                                          <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '0.35rem 0.45rem' }}>
                                            <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>Reps In Reserve</div>
                                            <div style={{ fontSize: '0.75rem', lineHeight: 1.45 }}>
                                              <div style={{ fontWeight: 600 }}>
                                                Last: {typeof ol.performanceMetrics?.lastSetRir === 'number' ? (ol.performanceMetrics.lastSetRir >= 5 ? '5+' : ol.performanceMetrics.lastSetRir) : 'N/A'}
                                              </div>
                                              <div style={{ color: 'var(--muted)' }}>
                                                Avg: {typeof ol.performanceMetrics?.avgRir === 'number' ? ol.performanceMetrics.avgRir.toFixed(1) : 'N/A'}
                                              </div>
                                              <div style={{ color: 'var(--muted)' }}>
                                                Adj: {typeof ol.performanceMetrics?.rirAdjustment === 'number' ? `${ol.performanceMetrics.rirAdjustment >= 0 ? '+' : ''}${ol.performanceMetrics.rirAdjustment.toFixed(2)}` : 'N/A'}
                                              </div>
                                              <div style={{ color: 'var(--muted)' }}>
                                                Coverage: {typeof ol.performanceMetrics?.rirCoverage === 'number' ? `${Math.round(ol.performanceMetrics.rirCoverage * 100)}%` : 'N/A'}
                                              </div>
                                            </div>
                                         </div>
                                       </div>
                                    </div>
                                  )}
                              </div>
                           );
                        })}
                        {overloadTracking.length > listPageSize && (
                          <div className="workout-flex-between" style={{ marginTop: '0.25rem' }}>
                            <button
                              className="btn btn-secondary"
                              disabled={safeOverloadPage === 0}
                              onClick={() => setOverloadPage(p => Math.max(0, p - 1))}
                              style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: safeOverloadPage === 0 ? 0.3 : 1 }}
                            >
                              ← Prev
                            </button>
                            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Page {safeOverloadPage + 1} of {overloadPageCount}</span>
                            <button
                              className="btn btn-secondary"
                              disabled={safeOverloadPage >= overloadPageCount - 1}
                              onClick={() => setOverloadPage(p => Math.min(overloadPageCount - 1, p + 1))}
                              style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: safeOverloadPage >= overloadPageCount - 1 ? 0.3 : 1 }}
                            >
                              Next →
                            </button>
                          </div>
                        )}
                     </div>
                  )}
                </div>
              </div>
      </>
   );
}
