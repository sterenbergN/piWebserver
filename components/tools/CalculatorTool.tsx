'use client';

import { useState } from 'react';

// === calculators/UnitConverter.tsx (Mocked inline for structural simplicity) ===
const UnitConverter = () => {
  const [value, setValue] = useState<string>('');
  const [fromUnit, setFromUnit] = useState<string>('celsius');
  const [toUnit, setToUnit] = useState<string>('fahrenheit');

  const conversions: Record<string, Record<string, (v: number) => number>> = {
    // Temperature
    celsius: {
      fahrenheit: (c) => (c * 9) / 5 + 32,
      kelvin: (c) => c + 273.15,
      celsius: (c) => c
    },
    fahrenheit: {
      celsius: (f) => ((f - 32) * 5) / 9,
      kelvin: (f) => ((f - 32) * 5) / 9 + 273.15,
      fahrenheit: (f) => f
    },
    kelvin: {
      celsius: (k) => k - 273.15,
      fahrenheit: (k) => ((k - 273.15) * 9) / 5 + 32,
      kelvin: (k) => k
    },

    // Length
    meters: {
      feet: (m) => m * 3.28084,
      inches: (m) => m * 39.3701,
      miles: (m) => m * 0.000621371,
      meters: (m) => m
    },
    feet: {
      meters: (f) => f / 3.28084,
      inches: (f) => f * 12,
      miles: (f) => f / 5280,
      feet: (f) => f
    },
    inches: {
      meters: (i) => i / 39.3701,
      feet: (i) => i / 12,
      miles: (i) => i / 63360,
      inches: (i) => i
    },
    miles: {
      meters: (m) => m / 0.000621371,
      feet: (m) => m * 5280,
      inches: (m) => m * 63360,
      miles: (m) => m
    },

    // Weight
    kilograms: {
      pounds: (kg) => kg * 2.20462,
      ounces: (kg) => kg * 35.274,
      kilograms: (kg) => kg
    },
    pounds: {
      kilograms: (lb) => lb / 2.20462,
      ounces: (lb) => lb * 16,
      pounds: (lb) => lb
    },
    ounces: {
      kilograms: (oz) => oz / 35.274,
      pounds: (oz) => oz / 16,
      ounces: (oz) => oz
    }
  };

  const getCategories = () => {
    return [
      {
        name: 'Temperature',
        units: ['celsius', 'fahrenheit', 'kelvin']
      },
      {
        name: 'Length',
        units: ['meters', 'feet', 'inches', 'miles']
      },
      {
        name: 'Weight / Mass',
        units: ['kilograms', 'pounds', 'ounces']
      }
    ];
  };

  const handleFromChange = (newFrom: string) => {
    setFromUnit(newFrom);
    // Align categories if switching across types
    const cat = getCategories().find(c => c.units.includes(newFrom));
    if (cat && !cat.units.includes(toUnit)) {
      setToUnit(cat.units.find(u => u !== newFrom) || cat.units[0]);
    }
  };

  // Convert
  const numValue = parseFloat(value);
  let result = '';
  if (!isNaN(numValue) && conversions[fromUnit]?.[toUnit]) {
    const val = conversions[fromUnit][toUnit](numValue);
    // Round to 4 decimal places
    result = Math.round(val * 10000) / 10000 + '';
  }

  return (
    <div style={{ padding: '1rem', maxWidth: '600px', margin: '0 auto' }}>
      <p style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--muted)' }}>
        Interactively convert length, weight, and temperature measurements.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: '1rem', alignItems: 'center' }}>
          
          {/* FROM */}
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--accent-light)', letterSpacing: '0.05em', fontWeight: 600 }}>Convert From</label>
            <input 
              type="number" 
              value={value} 
              onChange={e => setValue(e.target.value)} 
              placeholder="0"
              style={{ fontSize: '2rem', background: 'transparent', border: 'none', borderBottom: '2px solid var(--surface-border)', padding: '0.5rem 0', color: 'var(--foreground)', width: '100%' }}
            />
            <select 
              value={fromUnit} 
              onChange={e => handleFromChange(e.target.value)}
              style={{ background: 'var(--input-bg)', border: '1px solid var(--surface-border)', padding: '0.75rem', borderRadius: '8px', color: 'var(--foreground)' }}
            >
              {getCategories().map(cat => (
                <optgroup key={cat.name} label={cat.name}>
                  {cat.units.map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          <div style={{ fontSize: '1.5rem', opacity: 0.5 }}>=</div>

          {/* TO */}
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--accent-light)', letterSpacing: '0.05em', fontWeight: 600 }}>Convert To</label>
            <input 
              type="text" 
              value={result} 
              readOnly 
              placeholder="0"
              style={{ fontSize: '2rem', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', padding: '0.5rem 0', color: 'var(--foreground)', width: '100%', opacity: result ? 1 : 0.5 }}
            />
            <select 
              value={toUnit} 
              onChange={e => setToUnit(e.target.value)}
              style={{ background: 'var(--input-bg)', border: '1px solid var(--surface-border)', padding: '0.75rem', borderRadius: '8px', color: 'var(--foreground)' }}
            >
              {getCategories().find(c => c.units.includes(fromUnit))?.units.map(u => (
                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
              )) || <option value="">---</option>}
            </select>
          </div>

        </div>
      </div>
    </div>
  );
};

// === Main Calculator Sub-Dashboard ===
export default function CalculatorTool() {
  const [activeCalc, setActiveCalc] = useState<'unit'>('unit');

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Calculators</h2>
      
      {/* Sub-nav for growing calculators list */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
        {[
          { id: 'unit', label: 'Unit Converter' },
          // Easily add new calculators here
        ].map(calc => (
          <button
            key={calc.id}
            className={`btn ${activeCalc === calc.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveCalc(calc.id as any)}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            {calc.label}
          </button>
        ))}
      </div>

      <div style={{ minHeight: '350px' }}>
        {activeCalc === 'unit' && <UnitConverter />}
      </div>
    </div>
  );
}
