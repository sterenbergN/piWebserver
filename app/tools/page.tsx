'use client';

import { useEffect, useState } from 'react';
import CalculatorTool from '@/components/tools/CalculatorTool';
import MoviePickerTool from '@/components/tools/MoviePickerTool';
import RestaurantPickerTool from '@/components/tools/RestaurantPickerTool';
import GolfTrackerTool from '@/components/tools/GolfTrackerTool';
import './tools.css';

const TOOLS = [
  { id: 'calculators', icon: '🧮', label: 'Calculators' },
  { id: 'movies', icon: '🎬', label: 'Movie picker' },
  { id: 'food', icon: '🍽️', label: 'Where to eat' },
  { id: 'golf', icon: '⛳', label: 'Golf scores' },
] as const;
type ToolId = (typeof TOOLS)[number]['id'];

export default function ToolsPage() {
  const [tool, setTool] = useState<ToolId>('calculators');

  // The open tool lives in the URL (#golf) so it survives a refresh and can be linked,
  // and the navbar's tool links can switch it while this page is open.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (TOOLS.some(t => t.id === id)) setTool(id as ToolId);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const choose = (id: ToolId) => {
    setTool(id);
    history.replaceState(history.state, '', `#${id}`);
    // replaceState is silent; tell the navbar so it highlights the right tool.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  return (
    <div className="tl animate-fade-in">
      <div className="tl-head">
        <h1>Tools</h1>
        <p>Small things that come in handy.</p>
      </div>

      <div className="tl-switch" role="tablist" aria-label="Tools">
        {TOOLS.map(t => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} onClick={() => choose(t.id)}>
            <span aria-hidden>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tool === 'calculators' && <CalculatorTool />}
        {tool === 'movies' && <MoviePickerTool />}
        {tool === 'food' && <RestaurantPickerTool />}
        {tool === 'golf' && <GolfTrackerTool />}
      </div>
    </div>
  );
}
