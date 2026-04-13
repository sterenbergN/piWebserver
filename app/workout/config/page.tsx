'use client';

import { useState } from 'react';
import GymEditor from './GymEditor';
import WorkoutTypeEditor from './WorkoutTypeEditor';

type ConfigTab = 'gyms' | 'types';

export default function ConfigPage() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('gyms');

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
      <div className="workout-flex-between" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Configuration</h1>
        <button className="btn btn-secondary" onClick={() => window.location.href = '/workout'} style={{ padding: '0.5rem 1rem' }}>
          Back
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          className={activeTab === 'gyms' ? 'workout-btn-primary' : 'btn btn-secondary'}
          style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.25rem', borderRadius: '20px', width: 'auto' }}
          onClick={() => setActiveTab('gyms')}
        >
          Gyms & Lifts
        </button>
        <button
          className={activeTab === 'types' ? 'workout-btn-primary' : 'btn btn-secondary'}
          style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.25rem', borderRadius: '20px', width: 'auto' }}
          onClick={() => setActiveTab('types')}
        >
          Workout Types
        </button>
      </div>

      <div className="workout-tile" style={{ padding: 0, overflow: 'hidden' }}>
        {activeTab === 'gyms' && <GymEditor />}
        {activeTab === 'types' && <WorkoutTypeEditor />}
      </div>
    </div>
  );
}
