import { ImageResponse } from 'next/og';
import { DEFAULT_PROFILE } from '@/lib/resume';

// The picture shown when a link to the site is shared (pages without their
// own image — blog posts use their cover). Made once at build time.
export const alt = 'Noah Sterenberg — noahstuf.com';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '80px 96px', color: '#ededed',
          background: 'radial-gradient(circle at 15% 20%, rgba(107,70,193,0.55), transparent 55%), radial-gradient(circle at 90% 90%, rgba(49,130,206,0.45), transparent 50%), #0a0a0c',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, color: '#9f7aea', marginBottom: 28 }}>🐾 noahstuf.com</div>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{DEFAULT_PROFILE.name}</div>
        <div style={{ display: 'flex', fontSize: 36, color: '#a0aec0', marginTop: 28, lineHeight: 1.35, maxWidth: 980 }}>{DEFAULT_PROFILE.headline}</div>
        <div style={{ display: 'flex', fontSize: 26, color: '#68d391', marginTop: 44 }}>● Self-hosted on a Raspberry Pi</div>
      </div>
    ),
    size,
  );
}
