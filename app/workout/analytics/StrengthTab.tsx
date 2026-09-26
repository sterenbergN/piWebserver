'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalyticsTabProps } from './types';
import { STRENGTH_STANDARDS } from './shared';

// Props are the analytics page's shared data and handlers this tab reads.
export default function StrengthTab({ experience, history, lbm, missingWilks, oneRMs, prTimeline, user, wilks }: Pick<AnalyticsTabProps, 'experience' | 'history' | 'lbm' | 'missingWilks' | 'oneRMs' | 'prTimeline' | 'user' | 'wilks'>) {
   const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
   const [prPage, setPrPage] = useState(0);
   const [rmsPage, setRmsPage] = useState(0);
   const [expandedRM, setExpandedRM] = useState<string | null>(null);
   const [expandedPrGroup, setExpandedPrGroup] = useState<string | null>(null);
   const listPageSize = 5;
   const rmsPageCount = Math.max(1, Math.ceil(oneRMs.length / listPageSize));
   const safeRmsPage = Math.min(rmsPage, rmsPageCount - 1);
   const oneRMsPage = oneRMs.slice(safeRmsPage * listPageSize, (safeRmsPage + 1) * listPageSize);
   const rmCardRefs = useRef(new Map<string, HTMLDivElement>());
   const setRmCardRef = (key: string) => (el: HTMLDivElement | null) => {
      if (el) rmCardRefs.current.set(key, el);
      else rmCardRefs.current.delete(key);
   };
   useEffect(() => {
      if (!expandedRM) return;
      rmCardRefs.current.get(expandedRM)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
   }, [expandedRM]);

   return (
      <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* ═══ Strength Standards Comparison ═══ */}
                <div className="workout-tile">
                   <h3 style={{ margin: '0 0 1rem 0' }}>Strength Standards Comparison</h3>
                   <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0 0 1rem 0' }}>Based on your bodyweight ({user?.weight || '---'} lbs). Values are e1RM multiples of BW.</p>
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {Object.keys(STRENGTH_STANDARDS).map(liftName => {
                         // Exact name first, else the strongest lift containing it ("Back Squat" → Squat).
                         const key = liftName.toLowerCase();
                         const match = oneRMs.find(r => r.name.toLowerCase() === key)
                            || oneRMs.filter(r => r.name.toLowerCase().includes(key)).sort((a, b) => b.avg - a.avg)[0];
                         const userRm = match ? match.avg : 0;
                         const bw = user?.weight || 150;
                         const userMult = userRm / bw;
                         const std = STRENGTH_STANDARDS[liftName];
                         
                         let progress = 0;
                         let label = 'Untrained';
                         let nextTarget = std.beginner * bw;
                         let nextLabel = 'Beginner';
                         
                         if (userMult >= std.elite) { progress = 100; label = 'Elite'; nextTarget = 0; }
                         else if (userMult >= std.advanced) { progress = 80 + ((userMult - std.advanced) / (std.elite - std.advanced) * 20); label = 'Advanced'; nextTarget = std.elite * bw; nextLabel = 'Elite'; }
                         else if (userMult >= std.intermediate) { progress = 60 + ((userMult - std.intermediate) / (std.advanced - std.intermediate) * 20); label = 'Intermediate'; nextTarget = std.advanced * bw; nextLabel = 'Advanced'; }
                         else if (userMult >= std.novice) { progress = 40 + ((userMult - std.novice) / (std.intermediate - std.novice) * 20); label = 'Novice'; nextTarget = std.intermediate * bw; nextLabel = 'Intermediate'; }
                         else if (userMult >= std.beginner) { progress = 20 + ((userMult - std.beginner) / (std.novice - std.beginner) * 20); label = 'Beginner'; nextTarget = std.novice * bw; nextLabel = 'Novice'; }
                         else { progress = (userMult / std.beginner) * 20; label = 'Untrained'; }

                         return (
                            <div key={liftName} style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
                                  <strong style={{ fontSize: '0.9rem' }}>{liftName}</strong>
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent)' }}>{userRm > 0 ? `${userMult.toFixed(2)}x BW` : '---'}</span>
                               </div>
                               <div style={{ height: '8px', background: 'var(--surface-border)', borderRadius: '4px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, progress))}%`, background: 'var(--accent)', transition: 'width 0.5s ease' }} />
                               </div>
                               <div className="workout-flex-between" style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                                  <span>Level: <span style={{ color: 'var(--foreground)' }}>{label}</span></span>
                                  {nextTarget > 0 && <span>Next: {Math.round(nextTarget)} lbs ({nextLabel})</span>}
                               </div>
                            </div>
                         );
                      })}
                   </div>
                </div>

                {/* ═══ Formula Breakdown Summary ═══ */}
                <div className="workout-tile">
                   <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0 }}>1RM Formula Comparison</h3>
                      <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Global Avg</div>
                   </div>
                   {(() => {
                      const eSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.epley||0), 0) / (oneRMs.length || 1);
                      const bSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.brzycki||0), 0) / (oneRMs.length || 1);
                      const lSum = (oneRMs || []).reduce((s:number, r:any) => s + (r.lombardi||0), 0) / (oneRMs.length || 1);
                      return (
                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', textAlign: 'center' }}>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Epley</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(eSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×(1+r/30)</div>
                            </div>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Brzycki</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(bSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×36/(37-r)</div>
                            </div>
                            <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px' }}>
                               <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>Lombardi</div>
                               <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Math.round(lSum)}</div>
                               <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>w×r^0.10</div>
                            </div>
                         </div>
                      );
                   })()}
                </div>

               {/* ═══ Ranking Tile ═══ */}
               {experience && (
               <div className="workout-tile" style={{ textAlign: 'center', background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.1) 0%, rgba(0,0,0,0.2) 100%)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem', textAlign: 'left' }}>
                     <h3 style={{ margin: 0, lineHeight: 1.2, flex: '1 1 160px' }}>Lifter Experience</h3>
                     <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem', flexShrink: 0 }} onClick={() => setExpandedInfo(expandedInfo === 'rank' ? null : 'rank')}>
                    {expandedInfo === 'rank' ? 'Hide Breakdown ✕' : 'Score Breakdown ⓘ'}
                     </button>
                  </div>

                  <div style={{ fontSize: '3rem', margin: '1rem 0' }}>{experience.symbol} {experience.level}</div>
                  <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: 0 }}>Experience Score (E): <strong>{experience.score.toFixed(2)}</strong></p>

                  {expandedInfo === 'rank' && (
                     <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--background)', padding: '1rem', borderRadius: '8px', textAlign: 'left', fontSize: '0.85rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--accent)' }}>Score Computation Breakdown</h4>
                        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>E = (0.2 × Time) + (0.3 × Consistency) + (0.3 × Strength) + (0.2 × Progression)</p>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Time (T) Weight 20%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.time.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Consistency (C) Weight 30%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.consistency.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Strength (S) Weight 30%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.strength.toFixed(2)}</div>
                           </div>
                           <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px' }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Progression (P) Weight 20%</div>
                              <div style={{ fontSize: '1rem', fontWeight: 600 }}>{experience.breakdown.progression.toFixed(2)}</div>
                           </div>
                        </div>

                        <ul style={{ margin: '1rem 0 0 1rem', padding: 0, fontSize: '0.8rem' }}>
                           <li>⚪ Beginner: &lt; 2</li>
                           <li>🟢 Novice: 2 - 4</li>
                           <li>🔵 Intermediate: 4 - 6</li>
                           <li>🟣 Advanced: 6 - 8</li>
                           <li>🟡 Elite: 8+</li>
                        </ul>
                     </div>
                  )}
               </div>
               )}

               {/* ═══ 1RM Extrapolation ═══ */}
               <div className="workout-tile" style={{ position: 'relative' }}>
                  <h3 style={{ margin: '0 0 1rem 0' }}>Top 1RM Extrapolations</h3>
                  
                  {oneRMs.length > 0 ? (
                      <div>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {oneRMsPage.map((rm, i) => (
                               <div key={i} ref={setRmCardRef(rm.name)} style={{ background: 'var(--input-bg)', borderRadius: '12px', overflow: 'hidden' }}>
                                  <div 
                                    className="workout-flex-between" 
                                    style={{ padding: '0.75rem 1rem', cursor: 'pointer' }}
                                    onClick={() => setExpandedRM(expandedRM === rm.name ? null : rm.name)}
                                  >
                                     <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                          <div style={{ width: '30px', height: '30px', background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--background)' }}>
                                           {safeRmsPage * listPageSize + i + 1}
                                          </div>
                                        <strong style={{ fontSize: '0.9rem' }}>{rm.name}</strong>
                                     </div>
                                     <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>{Math.round(rm.avg)} <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 400 }}>lbs</span></div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '-2px' }}>
                                          Avg 1RM {expandedRM === rm.name ? '▴' : '▾'}
                                          {expandedRM === rm.name && (
                                            <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '0.05rem 0.35rem', borderRadius: '10px' }}>
                                              Expanded
                                            </span>
                                          )}
                                        </div>
                                     </div>
                                  </div>
                                  
                                   {expandedRM === rm.name && (
                                      <div className="animate-fade-in" style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--surface-border)', background: 'var(--surface-glass)' }}>
                                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', textAlign: 'center' }}>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Epley</div><div style={{ fontWeight: 600 }}>{Math.round(rm.epley)}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Brzycki</div><div style={{ fontWeight: 600 }}>{Math.round(rm.brzycki)}</div></div>
                                            <div><div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Lombardi</div><div style={{ fontWeight: 600 }}>{Math.round(rm.lombardi)}</div></div>
                                         </div>
                                         {rm.scaleFactor && rm.scaleFactor !== 1 && (
                                           <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)', textAlign: 'center' }}>
                                             Scale applied: ×{rm.scaleFactor.toFixed(2)}
                                           </div>
                                         )}
                                      </div>
                                   )}
                               </div>
                            ))}
                         </div>
                         {oneRMs.length > listPageSize && (
                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', gap: '0.5rem' }}>
                                <button
                                  className="btn btn-secondary"
                                  disabled={safeRmsPage === 0}
                                  onClick={() => setRmsPage(p => Math.max(0, p - 1))}
                                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.9rem', opacity: safeRmsPage === 0 ? 0.3 : 1, flexShrink: 0 }}
                                >
                                  &larr;
                                </button>
                                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>{safeRmsPage + 1} / {rmsPageCount}</span>
                                <button
                                  className="btn btn-secondary"
                                  disabled={safeRmsPage >= rmsPageCount - 1}
                                  onClick={() => setRmsPage(p => Math.min(rmsPageCount - 1, p + 1))}
                                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.9rem', opacity: safeRmsPage >= rmsPageCount - 1 ? 0.3 : 1, flexShrink: 0 }}
                                >
                                  &rarr;
                                </button>
                             </div>
                          )}
                      </div>
                   ) : <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No lifting history available yet.</p>}

                  {/* Powerlifting Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                      <div className="workout-tile" style={{ textAlign: 'center', position: 'relative' }}>
                          <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem', borderRadius: '8px', fontSize: '0.7rem' }} onClick={() => setExpandedInfo(expandedInfo === 'wilks' ? null : 'wilks')}>ⓘ</button>
                          <h4 style={{ margin: '0 0 0.5rem 0' }}>Wilks Score</h4>
                          {wilks > 0 ? (
                              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{wilks}</div>
                          ) : (
                              <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                                  Missing minimum requirements:<br/>
                                  {missingWilks.map(m => <span key={m}>• {m}<br/></span>)}
                                  {!user?.weight && <span>• Bodyweight Setup</span>}
                              </div>
                          )}
                          {expandedInfo === 'wilks' && (
                              <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.75rem', textAlign: 'left' }}>
                                  Wilks measures strength relative to bodyweight across S/B/D. It utilizes a 5th order polynomial adjusted exclusively for Men/Women.
                              </div>
                          )}
                      </div>
                      
                      <div className="workout-tile" style={{ textAlign: 'center', position: 'relative' }}>
                           <button className="btn btn-secondary" style={{ position:'absolute', top: '10px', right: '10px', padding: '0.2rem', borderRadius: '8px', fontSize: '0.7rem' }} onClick={() => setExpandedInfo(expandedInfo === 'lbm' ? null : 'lbm')}>ⓘ</button>
                          <h4 style={{ margin: '0 0 0.5rem 0' }}>Lean Mass</h4>
                          {lbm > 0 ? (
                              <><div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{lbm}</div><span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>lbs</span></>
                          ) : (
                              <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Requires Height and Weight configured.</p>
                          )}
                          {expandedInfo === 'lbm' && (
                              <div className="animate-fade-in" style={{ marginTop: '1rem', background: 'var(--input-bg)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.75rem', textAlign: 'left' }}>
                                  Lean Body Mass (LBM) excludes fat weight. <br/>M: (0.407 * W) + (0.267 * H) - 19.2<br/>F: (0.252 * W) + (0.473 * H) - 48.3
                              </div>
                          )}
                      </div>
                  </div>


                   {/* A3: Grouped PR Timeline */}
                   <div className="workout-tile" style={{ marginTop: '1rem' }}>
                     <h3 style={{ margin: '0 0 1rem 0' }}>PR Timeline</h3>
                     {prTimeline.length === 0 ? (
                       <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>No PRs logged yet.</p>
                     ) : (() => {
                       const grouped = new Map<string, typeof prTimeline>();
                       [...prTimeline].forEach(pr => {
                         if (!grouped.has(pr.liftName)) grouped.set(pr.liftName, []);
                         grouped.get(pr.liftName)!.push(pr);
                       });
                       
                       const sortedGroups = Array.from(grouped.entries()).sort((a, b) => b[1][0].rm - a[1][0].rm);
                       const paginatedGroups = sortedGroups.slice(prPage * 5, (prPage + 1) * 5);
                       
                       return (
                         <>
                           {paginatedGroups.map(([liftName, prs]) => {
                             const latest = prs[0];
                             const isExpanded = expandedPrGroup === liftName;
                             const gain = latest.prevRM > 0 ? Math.round(latest.rm - latest.prevRM) : null;
                             return (
                               <div key={liftName} style={{ marginBottom: '0.6rem', border: '1px solid var(--surface-border)', borderRadius: '10px', overflow: 'hidden' }}>
                                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.85rem', background: 'var(--input-bg)' }}>
                                   <div style={{ flex: 1, minWidth: 0 }}>
                                     <div style={{ fontWeight: 700, fontSize: '0.9rem', wordWrap: 'break-word', whiteSpace: 'normal', lineHeight: '1.2' }}>{liftName}</div>
                                     <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{latest.date} &bull; {prs.length} PR{prs.length !== 1 ? 's' : ''}</div>
                                   </div>
                                   <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                     <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent)' }}>{latest.rm} lbs</div>
                                     {gain !== null && gain > 0 && (
                                       <div style={{ fontSize: '0.7rem', color: 'var(--success)' }}>+{gain} lbs</div>
                                     )}
                                   </div>
                                   {prs.length > 1 && (
                                     <button
                                       style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0, padding: '0.2rem 0.4rem' }}
                                       onClick={() => setExpandedPrGroup(isExpanded ? null : liftName)}
                                     >
                                       {isExpanded ? '▲' : '▼'}
                                     </button>
                                   )}
                                 </div>
                                 {isExpanded && prs.slice(1).map((pr: any, idx: number) => (
                                   <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.85rem', borderTop: '1px solid var(--surface-border)', fontSize: '0.8rem' }}>
                                     <span style={{ color: 'var(--muted)' }}>{pr.date}</span>
                                     <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                       <span style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>{pr.prevRM}</span>
                                       <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{pr.rm}</span>
                                     </span>
                                   </div>
                                 ))}
                               </div>
                             );
                           })}
                           {sortedGroups.length > 5 && (
                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', gap: '0.5rem' }}>
                                <button
                                  className="btn btn-secondary"
                                  disabled={prPage === 0}
                                  onClick={() => setPrPage(p => Math.max(0, p - 1))}
                                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.9rem', opacity: prPage === 0 ? 0.3 : 1, flexShrink: 0 }}
                                >
                                  &larr;
                                </button>
                                <span style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>{prPage + 1} / {Math.ceil(sortedGroups.length / 5)}</span>
                                <button
                                  className="btn btn-secondary"
                                  disabled={prPage >= Math.ceil(sortedGroups.length / 5) - 1}
                                  onClick={() => setPrPage(p => Math.min(Math.ceil(sortedGroups.length / 5) - 1, p + 1))}
                                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.9rem', opacity: prPage >= Math.ceil(sortedGroups.length / 5) - 1 ? 0.3 : 1, flexShrink: 0 }}
                                >
                                  &rarr;
                                </button>
                             </div>
                           )}
                         </>
                       );
                     })()}
                   </div>
                 </div>
               </div>
      </>
   );
}
