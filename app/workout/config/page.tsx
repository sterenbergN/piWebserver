'use client';

import { useEffect, useState } from 'react';
import GymEditor from './GymEditor';
import WorkoutTypeEditor from './WorkoutTypeEditor';
import ProgramEditor from './ProgramEditor';
import PageHeader from '@/components/workout/PageHeader';

type ConfigTab = 'gyms' | 'types' | 'programs';

const TABS: { key: ConfigTab; label: string }[] = [
  { key: 'gyms', label: 'Gyms & Lifts' },
  { key: 'types', label: 'Workout Types' },
  { key: 'programs', label: 'Programs' },
];

export default function ConfigPage() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('gyms');
  // Deep link: /workout/config?tab=programs
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'types' || tab === 'programs') setActiveTab(tab);
  }, []);

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
      <PageHeader title="Gyms & lifts" subtitle="Your gyms, equipment, workout types and programs" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'workout-btn-primary' : 'btn btn-secondary'}
            style={{ flexShrink: 0, margin: 0, padding: '0.75rem 1.1rem', borderRadius: '20px', width: 'auto' }}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Gyms use full-width cards; workout types still live in a panel. */}
      {activeTab === 'gyms' && <GymEditor />}
      {activeTab === 'programs' && <ProgramEditor />}
      {activeTab === 'types' && (
        <div className="workout-tile" style={{ padding: 0, overflow: 'hidden' }}>
          <WorkoutTypeEditor />
        </div>
      )}
    </div>
  );
}
