'use client';

import { useState } from 'react';
import type { AnalyticsTabProps } from './types';
import { getTargetRir } from '@/lib/workout/progression';
import IntensitySlider from '@/components/workout/IntensitySlider';

// Props are the analytics page's shared data and handlers this tab reads.
export default function OverviewTab({ experience, handleSaveIntensity, intensityFactor, intensityInfo, intensitySaved, intensitySaving, setIntensityFactor, setIntensitySaved }: Pick<AnalyticsTabProps, 'experience' | 'handleSaveIntensity' | 'intensityFactor' | 'intensityInfo' | 'intensitySaved' | 'intensitySaving' | 'setIntensityFactor' | 'setIntensitySaved'>) {
   const [expandedInfo, setExpandedInfo] = useState<string | null>(null);
   const targetRir = getTargetRir(intensityFactor);
   const enduranceTargetRir = getTargetRir(intensityFactor, 60);

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

                {/* ═══ Progression Engine ═══ */}
                <div className="workout-tile">
                   <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0 }}>Progression Engine</h3>
                      <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.8rem' }} onClick={() => setExpandedInfo(expandedInfo === 'scoring' ? null : 'scoring')}>
                        {expandedInfo === 'scoring' ? 'Hide ✕' : 'How It Works ⓘ'}
                      </button>
                   </div>
                   <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 0.75rem 0' }}>
                      Reps-in-reserve autoregulation with double progression
                   </p>

                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pipeline</div>
                         <div style={{ fontSize: '0.85rem', fontWeight: 700, marginTop: '0.15rem' }}>e1RM → Target RIR → Pick</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Intensity</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, color: intensityInfo.color, marginTop: '0.15rem' }}>{intensityFactor.toFixed(2)}</div>
                      </div>
                      <div style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '10px', textAlign: 'center' }}>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Target RIR</div>
                         <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.15rem' }}>{targetRir}</div>
                         <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{enduranceTargetRir} for ≤60% 1RM</div>
                      </div>
                   </div>

                   {expandedInfo === 'scoring' && (
                      <div className="animate-fade-in" style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: '8px', fontSize: '0.82rem', lineHeight: 1.7 }}>
                         <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--accent)' }}>How the Progression Engine Works</h4>

                         <p style={{ margin: '0 0 0.75rem 0' }}>
                            There is no fixed rule like &quot;add 5 lbs&quot;. The engine estimates your strength from the reps and
                            reps in reserve (RIR) you log, then picks the heaviest weight × reps your equipment allows that should
                            still leave the target RIR in the tank.
                         </p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>1. Strength Estimate</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>
                            Each working set (within 90% of the session&apos;s top weight) gives an estimated 1RM from reps + RIR:
                            8 reps @ RIR 3 counts as an 11-rep max, 8 @ RIR 0 as an 8-rep max. The session estimate is the mean
                            over its working sets, weighted 60 / 25 / 15% with up to two earlier sessions from the last 6 weeks,
                            so one off day doesn&apos;t swing the plan. A set without a logged RIR is assumed at the planned RIR,
                            plus or minus the reps you went over or under plan.
                         </p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>2. Target RIR</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>
                            2 reps in reserve by default, 3 for workout types at or below 60% of 1RM. The intensity slider moves it
                            by up to one rep in half-rep steps: 0.5 → one rep further from failure, 1.5 → one rep closer.
                            At {intensityFactor.toFixed(2)} the target is <strong>{targetRir}</strong> ({enduranceTargetRir} for endurance types).
                         </p>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>3. Formulas</h5>
                         <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', margin: '0.3rem 0 0.5rem 0' }}>
                            <div>e1RM = weight × f(reps + RIR)  <span style={{ color: 'var(--muted)' }}>// mean of Epley, Brzycki, Lombardi</span></div>
                            <div>estimate = 0.6 × e1RM₀ + 0.25 × e1RM₋₁ + 0.15 × e1RM₋₂</div>
                            <div>rirAdjustment = 0.1 × (working-set RIR − target RIR)</div>
                            <div>score = 1 + rirAdjustment + 0.05 per extra set − 0.08 if weight dropped</div>
                            <div>expected = estimate × (1 + gain)  <span style={{ color: 'var(--muted)' }}>// gain = 0 if score &lt; 0.95</span></div>
                            <div>predicted RIR = reps to failure at weight − reps</div>
                         </div>

                         <h5 style={{ margin: '0 0 0.3rem 0', color: 'var(--foreground)' }}>4. Effort Score</h5>
                         <p style={{ margin: '0 0 0.5rem 0' }}>
                            Normalized around <strong>1.0</strong>: each rep in reserve above or below the target moves it by 0.1,
                            so finishing within half a rep of the target counts as right. Unless the last session was too hard,
                            the engine assumes a small gain since then: <strong>+2.5%</strong> for standard lifts, +2% high-rep,
                            +1.5% endurance (about one more rep).
                         </p>
                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.3rem', fontSize: '0.75rem', textAlign: 'center' }}>
                            <div style={{ background: 'rgba(var(--success-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--success)' }}>&gt; 1.05 = Too Easy</div>
                            <div style={{ background: 'var(--surface-border)', padding: '0.3rem', borderRadius: '4px', color: 'var(--warning)' }}>0.95–1.05 = Right</div>
                            <div style={{ background: 'rgba(var(--danger-rgb), 0.15)', padding: '0.3rem', borderRadius: '4px', color: 'var(--danger)' }}>&lt; 0.95 = Too Hard</div>
                         </div>

                         <h5 style={{ margin: '0.75rem 0 0.3rem 0', color: 'var(--foreground)' }}>5. Picking the Next Workout</h5>
                         <p style={{ margin: '0 0 0.3rem 0' }}>
                            Options are your equipment&apos;s real weights from 20% lighter to 10% heavier (5% for high-rep and
                            endurance lifts, always at least one step each way) × every rep count in the range × your sets ±1.
                            The engine takes the heaviest weight, then the most reps, predicted at no less than the target RIR − 0.5:
                         </p>
                         <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.2rem' }}>
                            <li><strong>In the rep range:</strong> same weight, one more rep (double progression). Standard lifts can go heavier sooner when the estimate supports it.</li>
                            <li><strong>Every set at the top:</strong> heavier weight with reps reset below the top. Endurance lifts add a set first.</li>
                            <li><strong>Too hard or below the range:</strong> the weight holds or comes down.</li>
                         </ul>
                         <p style={{ margin: '0' }}>
                            Set count only changes with a reason: extra sets done last time, steep fatigue (1.5+ reps lost per set),
                            or falling well short. Deload sessions are about 15% lighter with one fewer set.
                         </p>
                      </div>
                   )}
                </div>
              </div>
      </>
   );
}
