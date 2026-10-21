// Unit conversion: every unit is a factor to its category's base unit
// (temperature, which has offsets, converts through Celsius).

export type Unit = { id: string; label: string; short: string; factor?: number };
export type Category = { id: string; label: string; units: Unit[] };

export const CATEGORIES: Category[] = [
  { id: 'length', label: 'Length', units: [
    { id: 'mm', label: 'Millimetres', short: 'mm', factor: 0.001 },
    { id: 'cm', label: 'Centimetres', short: 'cm', factor: 0.01 },
    { id: 'm', label: 'Metres', short: 'm', factor: 1 },
    { id: 'km', label: 'Kilometres', short: 'km', factor: 1000 },
    { id: 'in', label: 'Inches', short: 'in', factor: 0.0254 },
    { id: 'ft', label: 'Feet', short: 'ft', factor: 0.3048 },
    { id: 'yd', label: 'Yards', short: 'yd', factor: 0.9144 },
    { id: 'mi', label: 'Miles', short: 'mi', factor: 1609.344 },
  ] },
  { id: 'weight', label: 'Weight', units: [
    { id: 'g', label: 'Grams', short: 'g', factor: 0.001 },
    { id: 'kg', label: 'Kilograms', short: 'kg', factor: 1 },
    { id: 'oz', label: 'Ounces', short: 'oz', factor: 0.028349523125 },
    { id: 'lb', label: 'Pounds', short: 'lb', factor: 0.45359237 },
    { id: 'st', label: 'Stone', short: 'st', factor: 6.35029318 },
    { id: 't', label: 'Tonnes', short: 't', factor: 1000 },
  ] },
  { id: 'temperature', label: 'Temperature', units: [
    { id: 'c', label: 'Celsius', short: '°C' },
    { id: 'f', label: 'Fahrenheit', short: '°F' },
    { id: 'k', label: 'Kelvin', short: 'K' },
  ] },
  { id: 'volume', label: 'Volume', units: [
    { id: 'ml', label: 'Millilitres', short: 'mL', factor: 0.001 },
    { id: 'l', label: 'Litres', short: 'L', factor: 1 },
    { id: 'tsp', label: 'Teaspoons (US)', short: 'tsp', factor: 0.00492892159375 },
    { id: 'tbsp', label: 'Tablespoons (US)', short: 'tbsp', factor: 0.01478676478125 },
    { id: 'floz', label: 'Fluid ounces (US)', short: 'fl oz', factor: 0.0295735295625 },
    { id: 'cup', label: 'Cups (US)', short: 'cup', factor: 0.2365882365 },
    { id: 'qt', label: 'Quarts (US)', short: 'qt', factor: 0.946352946 },
    { id: 'gal', label: 'Gallons (US)', short: 'gal', factor: 3.785411784 },
  ] },
  { id: 'speed', label: 'Speed', units: [
    { id: 'mps', label: 'Metres / second', short: 'm/s', factor: 1 },
    { id: 'kph', label: 'Kilometres / hour', short: 'km/h', factor: 1000 / 3600 },
    { id: 'mph', label: 'Miles / hour', short: 'mph', factor: 0.44704 },
    { id: 'kn', label: 'Knots', short: 'kn', factor: 1852 / 3600 },
  ] },
  { id: 'area', label: 'Area', units: [
    { id: 'm2', label: 'Square metres', short: 'm²', factor: 1 },
    { id: 'ft2', label: 'Square feet', short: 'ft²', factor: 0.09290304 },
    { id: 'acre', label: 'Acres', short: 'ac', factor: 4046.8564224 },
    { id: 'ha', label: 'Hectares', short: 'ha', factor: 10000 },
    { id: 'km2', label: 'Square kilometres', short: 'km²', factor: 1e6 },
    { id: 'mi2', label: 'Square miles', short: 'mi²', factor: 2589988.110336 },
  ] },
  { id: 'pressure', label: 'Pressure', units: [
    { id: 'pa', label: 'Pascals', short: 'Pa', factor: 1 },
    { id: 'kpa', label: 'Kilopascals', short: 'kPa', factor: 1000 },
    { id: 'mpa', label: 'Megapascals', short: 'MPa', factor: 1e6 },
    { id: 'bar', label: 'Bar', short: 'bar', factor: 1e5 },
    { id: 'psi', label: 'Pounds / sq inch', short: 'psi', factor: 6894.757293168 },
    { id: 'atm', label: 'Atmospheres', short: 'atm', factor: 101325 },
    { id: 'inh2o', label: 'Inches of water', short: 'inH₂O', factor: 249.08891 },
    { id: 'inhg', label: 'Inches of mercury', short: 'inHg', factor: 3386.389 },
    { id: 'mmhg', label: 'mm of mercury', short: 'mmHg', factor: 133.322387415 },
  ] },
  { id: 'flow', label: 'Flow', units: [
    { id: 'lpm', label: 'Litres / minute', short: 'L/min', factor: 1 / 60000 },
    { id: 'm3h', label: 'Cubic metres / hour', short: 'm³/h', factor: 1 / 3600 },
    { id: 'gpm', label: 'Gallons / minute (US)', short: 'gpm', factor: 3.785411784 / 60000 },
    { id: 'cfm', label: 'Cubic feet / minute', short: 'cfm', factor: 0.028316846592 / 60 },
    { id: 'bpd', label: 'Barrels / day (oil)', short: 'bbl/d', factor: 0.158987294928 / 86400 },
  ] },
  { id: 'torque', label: 'Torque', units: [
    { id: 'nm', label: 'Newton metres', short: 'N·m', factor: 1 },
    { id: 'lbft', label: 'Pound-feet', short: 'lb·ft', factor: 1.3558179483314004 },
    { id: 'lbin', label: 'Pound-inches', short: 'lb·in', factor: 0.1129848290276167 },
    { id: 'kgfm', label: 'Kilogram-force metres', short: 'kgf·m', factor: 9.80665 },
  ] },
  { id: 'power', label: 'Power', units: [
    { id: 'w', label: 'Watts', short: 'W', factor: 1 },
    { id: 'kw', label: 'Kilowatts', short: 'kW', factor: 1000 },
    { id: 'hp', label: 'Horsepower (mech.)', short: 'hp', factor: 745.69987158227 },
    { id: 'btuh', label: 'BTU / hour', short: 'BTU/h', factor: 0.29307107 },
    { id: 'ton', label: 'Tons of cooling', short: 'TR', factor: 3516.8528 },
  ] },
  { id: 'energy', label: 'Energy', units: [
    { id: 'j', label: 'Joules', short: 'J', factor: 1 },
    { id: 'kj', label: 'Kilojoules', short: 'kJ', factor: 1000 },
    { id: 'kwh', label: 'Kilowatt-hours', short: 'kWh', factor: 3.6e6 },
    { id: 'btu', label: 'BTU', short: 'BTU', factor: 1055.05585262 },
    { id: 'kcal', label: 'Food calories', short: 'kcal', factor: 4184 },
  ] },
  { id: 'data', label: 'Data', units: [
    { id: 'kb', label: 'Kilobytes', short: 'KB', factor: 1e3 },
    { id: 'mb', label: 'Megabytes', short: 'MB', factor: 1e6 },
    { id: 'gb', label: 'Gigabytes', short: 'GB', factor: 1e9 },
    { id: 'tb', label: 'Terabytes', short: 'TB', factor: 1e12 },
    { id: 'gib', label: 'Gibibytes', short: 'GiB', factor: 2 ** 30 },
  ] },
];

const toCelsius: Record<string, (v: number) => number> = { c: (v) => v, f: (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 };
const fromCelsius: Record<string, (v: number) => number> = { c: (v) => v, f: (v) => (v * 9) / 5 + 32, k: (v) => v + 273.15 };

export function convert(value: number, category: Category, from: string, to: string): number {
  if (category.id === 'temperature') return fromCelsius[to](toCelsius[from](value));
  const f = category.units.find((u) => u.id === from)?.factor;
  const t = category.units.find((u) => u.id === to)?.factor;
  if (!f || !t) return NaN;
  return (value * f) / t;
}

/** Up to 6 significant digits, no float noise ("0.30000000000000004" → "0.3"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9 || abs < 1e-6) return n.toExponential(3);
  const rounded = Number(n.toPrecision(6));
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
