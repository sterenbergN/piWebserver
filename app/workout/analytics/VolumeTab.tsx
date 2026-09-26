'use client';

import { useState } from 'react';
import type { AnalyticsTabProps } from './types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Props are the analytics page's shared data and handlers this tab reads.
export default function VolumeTab({ calorieTimeline, muscleVolumeData, trainingHeatmap, volumeTimeline }: Pick<AnalyticsTabProps, 'calorieTimeline' | 'muscleVolumeData' | 'trainingHeatmap' | 'volumeTimeline'>) {
   const [expandVolume, setExpandVolume] = useState(false);
   const [selectedHeatmapDate, setSelectedHeatmapDate] = useState<string | null>(null);
   const [chartSeries, setChartSeries] = useState<'volume' | 'calories' | 'intensity'>('volume');


   return (
      <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

               {/* ═══ Performance Timeline ═══ */}
               <div className="workout-tile">
                    <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
                       <h3 style={{ margin: 0 }}>Performance Over Time</h3>
                       <select 
                         className="workout-input" 
                         style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.8rem', margin: 0 }}
                         value={chartSeries}
                         onChange={e => setChartSeries(e.target.value as any)}
                       >
                          <option value="volume">Volume (lbs)</option>
                          <option value="intensity">Intensity (1RM-lbs)</option>
                          <option value="calories">Calories (kcal)</option>
                       </select>
                    </div>

                    <div style={{ width: '100%', height: expandVolume ? '300px' : '150px', transition: 'height 0.3s' }} onClick={() => setExpandVolume(!expandVolume)}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartSeries === 'volume' ? volumeTimeline : chartSeries === 'intensity' ? volumeTimeline : calorieTimeline}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
                            <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} />
                            <YAxis stroke="var(--muted)" fontSize={10} />
                            <Tooltip contentStyle={{ background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: '8px' }} />
                            <Line 
                              type="monotone" 
                              dataKey={chartSeries === 'volume' ? 'volume' : chartSeries === 'intensity' ? 'intensity' : 'calories'} 
                              stroke="var(--accent)" 
                              strokeWidth={3} 
                              dot={{ r: 4, fill: 'var(--accent)' }} 
                            />
                          </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* ═══ Muscle Volume Distribution ═══ */}
                <div className="workout-tile">
                  <h3 style={{ margin: '0 0 1rem 0' }}>Muscle Volume Distribution</h3>
                  {muscleVolumeData.length > 0 ? (() => {
                     const total = muscleVolumeData.reduce((sum, m) => sum + m.volume, 0) || 1;
                     const max = muscleVolumeData[0]?.volume || 1;
                     return (
                       <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                         {muscleVolumeData.map((m) => (
                           <div key={m.name} title={`${m.name}: ${m.volume.toLocaleString()} lbs`} style={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0, 1fr) 3rem', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                             <span>{m.name}</span>
                             <div style={{ height: 10, borderRadius: 4, background: 'var(--surface-border)', overflow: 'hidden' }}>
                               <div style={{ width: `${(m.volume / max) * 100}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
                             </div>
                             <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{Math.round((m.volume / total) * 100)}%</span>
                           </div>
                         ))}
                       </div>
                     );
                  })() : <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No data</p>}
                </div>

                {/* A4: Weekly Heatmap — vibrant color scale + legend */}
                 <div className="workout-tile">
                   <h3 style={{ margin: '0 0 1rem 0' }}>Training Frequency Heatmap</h3>
                   {/* Day-of-week header */}
                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                         <div key={`dow-${i}`} style={{ textAlign: 'center', fontSize: '0.6rem', color: 'var(--muted)' }}>{day}</div>
                      ))}
                   </div>
                   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                      {Array.from({length: 28}).map((_, i) => {
                         const d = new Date();
                         const dayOffset = d.getDay();
                         const adjustedDaysAgo = (27 - i) - (6 - dayOffset);
                         const targetDate = new Date();
                         targetDate.setDate(d.getDate() - adjustedDaysAgo);
                         const dKey = targetDate.toISOString().slice(0, 10);
                         const data = trainingHeatmap.get(dKey) || { setCount: 0, lifts: [] };
                         const val = data.setCount;
                         const getHeatColor = (v: number) => {
                           if (v === 0) return 'var(--input-bg)';
                           // Single-hue sequential scale: more sets = stronger accent.
                           if (v <= 5)  return 'rgba(var(--accent-rgb), 0.3)';
                           if (v <= 12) return 'rgba(var(--accent-rgb), 0.5)';
                           if (v <= 20) return 'rgba(var(--accent-rgb), 0.75)';
                           return 'rgba(var(--accent-rgb), 1)';
                         };
                         const isToday = dKey === new Date().toISOString().slice(0, 10);
                         return (
                            <div
                              key={dKey}
                              title={`${targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${val} sets`}
                              onClick={() => { if (val > 0) setSelectedHeatmapDate(dKey); }}
                              style={{
                                aspectRatio: '1/1',
                                background: getHeatColor(val),
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.6rem',
                                fontWeight: val > 0 ? 700 : 400,
                                color: val > 12 ? '#fff' : val > 0 ? 'var(--foreground)' : 'transparent',
                                outline: isToday ? '2px solid var(--accent)' : 'none',
                                outlineOffset: '1px',
                                cursor: val > 0 ? 'pointer' : 'default',
                                position: 'relative'
                              }}
                            >
                              {targetDate.getDate() === 1 ? <span style={{fontSize: '0.5rem', color: 'var(--muted)', position: 'absolute', bottom: '-12px'}}>{targetDate.toLocaleDateString(undefined, { month: 'short' })}</span> : null}
                              {val > 0 ? val : ''}
                            </div>
                         );
                     })}
                   </div>
                   {/* Color legend */}
                   <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.65rem', color: 'var(--muted)' }}>
                     <span>Fewer sets</span>
                     {['rgba(var(--accent-rgb), 0.3)', 'rgba(var(--accent-rgb), 0.5)', 'rgba(var(--accent-rgb), 0.75)', 'rgba(var(--accent-rgb), 1)'].map((c, i) => (
                       <div key={i} style={{ width: '18px', height: '12px', background: c, borderRadius: '3px' }} />
                     ))}
                     <span>More sets</span>
                   </div>
                   {selectedHeatmapDate && trainingHeatmap.has(selectedHeatmapDate) && (
                      <div className="animate-fade-in" style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface-glass)', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <strong style={{ fontSize: '0.9rem' }}>{new Date(selectedHeatmapDate + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
                              <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setSelectedHeatmapDate(null)}>✕</button>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Total Sets: {trainingHeatmap.get(selectedHeatmapDate)?.setCount}</div>
                          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
                              {trainingHeatmap.get(selectedHeatmapDate)?.lifts.map((l: string, i: number) => (
                                  <li key={i} style={{ padding: '0.15rem 0' }}>{l}</li>
                              ))}
                          </ul>
                      </div>
                   )}
                 </div>
              </div>
      </>
   );
}
