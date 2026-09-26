'use client';

import { useState } from 'react';
import type { AnalyticsTabProps } from './types';
import { computeTargetOverload } from '@/lib/workout/progression';
import IntensitySlider from '@/components/workout/IntensitySlider';

// Props are the analytics page's shared data and handlers this tab reads.
export default function OverviewTab({ experience, handleSaveIntensity, intensityFactor, intensityInfo, intensitySaved, intensitySaving, setIntensityFactor, setIntensitySaved }: Pick<AnalyticsTabProps, 'experience' | 'handleSaveIntensity' | 'intensityFactor' | 'intensityInfo' | 'intensitySaved' | 'intensitySaving' | 'setIntensityFactor' | 'setIntensitySaved'>) {
   const [expandedInfo, setExpandedInfo] = useState<string | null>(null);


   return (
      <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* ═══ Experience Rank ═══ */}
                {experience && (
                   <div className="workout-tile" style={{ textAlign: 'center', background: 'linear-gradient(135deg, var(--tile-bg), rgba(var(--accent-rgb), 0.1))' }}>
                      <h3 style={{ margin: '0 0 0.5rem 0' }}>Lifter Rank</h3>
                      <div style={{ fontSize: '3rem', margin: '0.5rem 0' }}>{experience.symbol}</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)' }}>{experience.level}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.5rem' }}>Experience Score: {experience.score.toFixed(0)}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.5rem', marginTop: '1rem', fontSize: '0.75rem' }}>
                         <div><strong style={{ color: 'var(--foreground)' }}>{(experience.breakdown.time * 25).toFixed(0)}</strong><br/>Time</div>
                         <div><strong style={{ color: 'var(--foreground)' }}>{(experience.breakdown.consistency * 25).toFixed(0)}</strong><br/>Consist.</div>
                         <div><strong style={{ color: 'var(--foreground)' }}>{(experience.breakdown.strength * 25).toFixed(0)}</strong><br/>Str</div>
                         <div><strong style={{ color: 'var(--foreground)' }}>{(experience.breakdown.progression * 25).toFixed(0)}</strong><br/>Prog</div>
                      </div>
                   </div>
                )}

                {/* ═══ Training Intensity Profile ═══ */}
                <div className="workout-tile" style={{ borderLeft: `3px solid ${intensityInfo.color}` }}>
                   <div className="workout-flex-between" style={{ marginBottom: '0.75rem' }}>
                      <h3 style={{ margin: 0 }}>Training Intensity Profile</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                         {intensitySaved && (
                            <span className="animate-fade-in" style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                               ✓ Saved
                            </span>
                         )}
                         <button 
                            className="workout-btn-primary" 
                            style={{ width: 'auto', margin: 0, padding: '0.4rem 1rem', fontSize: '0.8rem', opacity: intensitySaving ? 0.5 : 1 }}
                            onClick={handleSaveIntensity}
                            disabled={intensitySaving}
                         >
                            {intensitySaving ? 'Saving...' : 'Save'}
                         </button>
                      </div>
                   </div>

                   <IntensitySlider
                      title="Default Workout Intensity"
                      prominent
                      value={intensityFactor}
                      onChange={(value) => { setIntensityFactor(value); setIntensitySaved(false); }}
                   />

                   <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.75rem 0 0 0', lineHeight: 1.5 }}>
                      This sets the <strong style={{ color: 'var(--foreground)' }}>default intensity</strong> for the progression engine. 
                      You can override it per-workout using the slider in the active tracker.
                   </p>
                </div>

                {/* ═══ Progression Engine Scoring ═══ */}
                <div className="workout-tile">
                   <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0 }}>Progression Engine</h3>
                      <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'scoring' ? null : 'scoring')}>
                        {expandedInfo === 'scoring' ? 'Hide ✕' : 'How It Works ⓘ'}
                      </button>
                   </div>
                   <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 0.75rem 0' }}>
                      Constraint-based candidate generation + scoring system
                   </p>

                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pipeline</div>
                         <div style={{ fontSize: '0.85rem', fontWeight: 700, marginTop: '0.15rem' }}>Generate → Filter → Score</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intensity</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, color: intensityInfo.color, marginTop: '0.15rem' }}>{intensityFactor.toFixed(2)}</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Overload Target</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.15rem' }}>{(computeTargetOverload(intensityFactor, 1, 1) * 100).toFixed(1)}%</div>
                      </div>
                   </div>

                   {expandedInfo === 'scoring' && (
                      <div className="animate-fade-in" style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.82rem', lineHeight: 1.7 }}>
                         <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--accent)' }}>How the Progression Engine Works</h4>
                         
                         <p style={{ margin: '0 0 0.75rem 0' }}>
                            The system does <strong>NOT</strong> use fixed rules like "add 5 lbs". Instead, it generates many possible next workouts, 
                             filters out invalid ones, and scores each candidate to find the optimal progression.
                          </p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>1. Candidate Generation</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>Weight ±2 equipment steps, Reps ±2, Sets ±1 from your last session.</p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>2. Filtering</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>Rejects candidates that use invalid weights, exceed rep/set bounds, or violate time limits.</p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>3. Scoring Formulas</h5>
                         <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', margin: '0.3rem 0 0.5rem 0' }}>
                            <div>load = Σ(weight × reps) across sets</div>
                            <div>e1RM = weight × (1 + reps/30)  <span style={{ color: 'var(--muted)' }}>// Epley</span></div>
                            <div>volumeRatio = (weight × reps) / last session&apos;s per-set load</div>
                            <div>progress = w × e1RMRatio + (1 − w) × volumeRatio</div>
                            <div>target = 5% × intensity × trend + (perfScore − 1) × 0.5</div>
                            <div>rirAdjustment = clamp(((avgRIR - 2)×0.04)+((lastRIR - 2)×0.02))</div>
                          </div>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>4. Performance Score</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>
                            Normalized around <strong>1.0</strong>. Factors: completion ratio (actual vs planned reps), 
                            intensity deviation (actual vs planned weight), fatigue slope (rep drop across sets), 
                            weight drops, extra sets, and reps in reserve. An average RIR of <strong>2</strong> is neutral,
                            <strong>0-1</strong> means the lift ran hard, and <strong>3+</strong> means you likely had more headroom.
                          </p>
                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.3rem', fontSize: '0.75rem', textAlign: 'center' }}>
                            <div style={{ background: 'rgba(var(--success-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--success)' }}>&gt; 1.05 = Too Easy</div>
                            <div style={{ background: 'var(--surface-border)', padding: '0.3rem', borderRadius: '4px', color: 'var(--warning)' }}>0.95–1.05 = Right</div>
                            <div style={{ background: 'rgba(var(--danger-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--danger)' }}>&lt; 0.95 = Too Hard</div>
                         </div>

                         <h5 style={{ margin: '0.75rem 0 0.3rem 0', color: 'var(--foreground)' }}>5. Intensity Factor Effect</h5>
                         <p style={{ margin: '0' }}>
                            <strong>Higher:</strong> raises the target and the strength weight <code>w</code>, so heavier weight is favored.<br/>
                            <strong>Lower:</strong> lowers both, so the engine progresses through reps and holds weight steady.<br/>
                            <strong>Adaptive:</strong> a hard session (perfScore &lt; 1) can make the target negative, which backs the weight off.
                            Set count only changes with a reason: extra sets done, steep fatigue, or a back-off.
                          </p>
                      </div>
                   )}
                </div>
              </div>
      </>
   );
}
