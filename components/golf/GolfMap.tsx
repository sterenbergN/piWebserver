'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { Fix, LatLon } from '@/lib/golf/types';

// One small Leaflet map for every golf screen. Points are drawn as circles and
// dots (no marker images to go missing); colours come from golf.css so they follow
// the light and dark themes.

export type MapPoint = { id: string; at: LatLon; tone: 'tee' | 'target' | 'shot' | 'old' | 'center'; label?: string; onDrag?: (p: LatLon) => void };
export type MapLine = { id: string; points: LatLon[]; tone: 'hole' | 'shot' | 'old' | 'aim'; dashed?: boolean };
export type MapArea = { id: string; points: LatLon[]; tone: 'likely' | 'possible' };

type Tiles = { url: string; attribution: string; maxZoom: number };
type MapConfig = { satellite: Tiles | null; streets: Tiles };

let configPromise: Promise<MapConfig | null> | null = null;
/** Asked once per visit; the answer depends on the Pi's settings, not on the page. */
function mapConfig() {
  configPromise ||= fetch('/api/golf/map', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return configPromise;
}

const tone = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--golf-${name}`).trim() || '#88c0d0';

export default function GolfMap({ points = [], lines = [], areas = [], me, fit, fitKey, onTap, className }: {
  points?: MapPoint[];
  lines?: MapLine[];
  areas?: MapArea[];
  me?: Fix | null;
  /** Points to keep in view; the map refits when `fitKey` changes, not on every GPS update. */
  fit?: LatLon[];
  fitKey?: string;
  onTap?: (p: LatLon) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const overlay = useRef<Leaflet.LayerGroup | null>(null);
  const meLayer = useRef<Leaflet.LayerGroup | null>(null);
  const bases = useRef<{ satellite: Leaflet.TileLayer | null; streets: Leaflet.TileLayer } | null>(null);
  const tapRef = useRef(onTap);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<'satellite' | 'streets'>('satellite');
  const [hasSatellite, setHasSatellite] = useState(false);
  const [failed, setFailed] = useState(false);
  tapRef.current = onTap;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [leaflet, config] = await Promise.all([import('leaflet'), mapConfig()]);
      if (cancelled || !box.current) return;
      if (!config) { setFailed(true); return; }
      L.current = leaflet;
      const m = leaflet.map(box.current, { zoomControl: false, attributionControl: true, maxZoom: 20 }).setView([39.5, -98.35], 4);
      m.attributionControl.setPrefix(false);
      leaflet.control.zoom({ position: 'bottomright' }).addTo(m);
      const layer = (t: Tiles) => leaflet.tileLayer(t.url, { attribution: t.attribution, maxZoom: 20, maxNativeZoom: t.maxZoom });
      bases.current = { satellite: config.satellite ? layer(config.satellite) : null, streets: layer(config.streets) };
      (bases.current.satellite || bases.current.streets).addTo(m);
      setHasSatellite(!!config.satellite);
      setBase(config.satellite ? 'satellite' : 'streets');
      overlay.current = leaflet.layerGroup().addTo(m);
      meLayer.current = leaflet.layerGroup().addTo(m);
      m.on('click', (e: Leaflet.LeafletMouseEvent) => tapRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
      map.current = m;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const switchBase = (next: 'satellite' | 'streets') => {
    const m = map.current, b = bases.current;
    if (!m || !b || !b.satellite) return;
    (next === 'satellite' ? b.streets : b.satellite).remove();
    (next === 'satellite' ? b.satellite : b.streets).addTo(m);
    setBase(next);
  };

  // Course drawing: holes, shots, search areas.
  useEffect(() => {
    const leaflet = L.current, group = overlay.current;
    if (!ready || !leaflet || !group) return;
    group.clearLayers();
    for (const a of areas) {
      const color = tone(a.tone === 'likely' ? 'likely' : 'possible');
      leaflet.polygon(a.points.map((p) => [p.lat, p.lon] as [number, number]), { color, weight: 2, fillColor: color, fillOpacity: a.tone === 'likely' ? 0.3 : 0.12, interactive: false }).addTo(group);
    }
    for (const l of lines) {
      leaflet.polyline(l.points.map((p) => [p.lat, p.lon] as [number, number]), {
        color: tone(l.tone), weight: l.tone === 'old' ? 2 : 3, opacity: l.tone === 'old' ? 0.55 : 0.95, dashArray: l.dashed ? '6 6' : undefined, interactive: false,
      }).addTo(group);
    }
    for (const p of points) {
      if (p.onDrag) {
        const icon = leaflet.divIcon({ className: `golf-pin is-${p.tone}`, html: `<span>${p.label ?? ''}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
        const marker = leaflet.marker([p.at.lat, p.at.lon], { icon, draggable: true, keyboard: false }).addTo(group);
        marker.on('dragend', () => { const ll = marker.getLatLng(); p.onDrag!({ lat: ll.lat, lon: ll.lng }); });
      } else {
        const big = p.tone === 'tee' || p.tone === 'target';
        const c = leaflet.circleMarker([p.at.lat, p.at.lon], { radius: big ? 8 : p.tone === 'old' ? 3.5 : 5, color: '#fff', weight: big ? 2 : 1, fillColor: tone(p.tone), fillOpacity: 1, interactive: !!p.label });
        if (p.label) c.bindTooltip(p.label, { direction: 'top', offset: [0, -6] });
        c.addTo(group);
      }
    }
  }, [ready, points, lines, areas]);

  // You, with the GPS accuracy as a circle around you.
  useEffect(() => {
    const leaflet = L.current, group = meLayer.current;
    if (!ready || !leaflet || !group) return;
    group.clearLayers();
    if (!me) return;
    leaflet.circle([me.lat, me.lon], { radius: me.acc, color: tone('me'), weight: 1, fillOpacity: 0.12, interactive: false }).addTo(group);
    leaflet.circleMarker([me.lat, me.lon], { radius: 6, color: '#fff', weight: 2, fillColor: tone('me'), fillOpacity: 1, interactive: false }).addTo(group);
  }, [ready, me]);

  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const leaflet = L.current, m = map.current;
    const pts = fitRef.current;
    if (!ready || !leaflet || !m || !pts?.length) return;
    if (pts.length === 1) m.setView([pts[0].lat, pts[0].lon], 18);
    else m.fitBounds(leaflet.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])), { padding: [36, 36], maxZoom: 19 });
  }, [ready, fitKey]);

  return (
    <div className={`golf-map ${className || ''}`}>
      <div ref={box} className="golf-map-canvas" />
      {failed && <p className="golf-map-note">The map needs a connection the first time.</p>}
      {hasSatellite && (
        <button type="button" className="golf-map-switch" onClick={() => switchBase(base === 'satellite' ? 'streets' : 'satellite')}>
          {base === 'satellite' ? 'Street map' : 'Satellite'}
        </button>
      )}
    </div>
  );
}
