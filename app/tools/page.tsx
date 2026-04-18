'use client';

import { useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';

import CalculatorTool from '@/components/tools/CalculatorTool';
import MoviePickerTool from '@/components/tools/MoviePickerTool';
import RestaurantPickerTool from '@/components/tools/RestaurantPickerTool';
import GolfTrackerTool from '@/components/tools/GolfTrackerTool';

export default function ToolsDashboard() {
  const [activeTool, setActiveTool] = useState<'calculators' | 'movies' | 'restaurants' | 'golf'>('calculators');
  const { popup } = useSitePopup();

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem', textAlign: 'center' }}>Utility Tools</h1>
      <p style={{ textAlign: 'center', color: 'var(--muted)', marginBottom: '2.5rem' }}>
        Select a tool from the menu below to get started.
      </p>

      {/* Tool Navigation */}
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2.5rem' }}>
        {[
          { id: 'calculators', label: '🧮 Calculators' },
          { id: 'movies', label: '🎬 Movie Picker' },
          { id: 'restaurants', label: '🍽️ Restaurant Finder' },
          { id: 'golf', label: '⛳ Golf Score Tracker' }
        ].map(tool => (
          <button
            key={tool.id}
            className={`btn ${activeTool === tool.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTool(tool.id as any)}
            style={{ minWidth: '160px', fontWeight: activeTool === tool.id ? 600 : 400 }}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {/* Active Tool Renderer */}
      <div className="animate-fade-in">
        {activeTool === 'calculators' && <CalculatorTool />}
        {activeTool === 'movies' && <MoviePickerTool />}
        {activeTool === 'restaurants' && <RestaurantPickerTool />}
        {activeTool === 'golf' && <GolfTrackerTool />}
      </div>

      {popup}
    </div>
  );
}
