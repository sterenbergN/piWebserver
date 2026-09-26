'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Gym } from '@/lib/workout/types';
import { stationPath } from '@/lib/workout/station-link';

/** Printable sheet of QR stickers, one per station, linking to its station page. */
export default function QrStickerSheet() {
  const [gym, setGym] = useState<Gym | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    const gymId = new URLSearchParams(window.location.search).get('gym');
    fetch('/api/workout/gyms').then((r) => r.json()).then(async (d) => {
      const found: Gym | undefined = (d.gyms || []).find((g: Gym) => g.id === gymId);
      if (!found) { setStatus('missing'); return; }
      setGym(found);
      const entries = await Promise.all(found.stations.map(async (s) => [
        s.id,
        await QRCode.toDataURL(`${window.location.origin}${stationPath(found.id, s.id)}`, { margin: 1, width: 360 }),
      ] as const));
      setCodes(Object.fromEntries(entries));
      setStatus('ready');
    }).catch(() => setStatus('missing'));
  }, []);

  if (status === 'loading') return <p style={{ color: 'var(--muted)' }}>Preparing stickers…</p>;
  if (status === 'missing' || !gym) return (
    <div className="workout-tile">
      <p>Gym not found — you can only print stickers for your own gyms.</p>
      <Link className="btn btn-secondary" href="/workout/config">Back</Link>
    </div>
  );

  return (
    <div>
      <style>{`
        .qr-sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
        .qr-card { background: #fff; color: #111; border: 1px dashed #999; border-radius: 12px; padding: 0.75rem; text-align: center; break-inside: avoid; }
        .qr-card img { width: 100%; max-width: 160px; height: auto; }
        .qr-card strong { display: block; font-size: 0.95rem; line-height: 1.2; }
        .qr-card span { display: block; font-size: 0.7rem; color: #555; margin-top: 0.2rem; }
        @media print {
          .glass-nav, .qr-actions, footer { display: none !important; }
          body { background: #fff !important; }
          .workout-mobile-container { max-width: none !important; padding: 0 !important; }
          .qr-sheet { grid-template-columns: repeat(3, 1fr); gap: 0.4in; }
          .qr-card img { max-width: 1.8in; }
        }
      `}</style>
      <div className="qr-actions" style={{ marginBottom: '1rem' }}>
        <Link href={`/workout/config?gym=${encodeURIComponent(gym.id)}`} style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← {gym.name}</Link>
        <h1 style={{ fontSize: '1.4rem', margin: '0.3rem 0' }}>QR stickers</h1>
        <p className="workout-hint">Print these and stick them on your equipment. Scanning one shows that station&apos;s lifts, your last and best sets, and adds them to the workout you&apos;re doing.</p>
        <button className="workout-btn-primary" onClick={() => window.print()}>🖨 Print stickers</button>
      </div>
      <div className="qr-sheet">
        {gym.stations.map((s) => (
          <div key={s.id} className="qr-card">
            {codes[s.id] && <img src={codes[s.id]} alt={`QR code for ${s.name}`} />}
            <strong>{s.name}</strong>
            <span>{gym.emoji} {gym.name} · {s.lifts.length} lift{s.lifts.length === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
