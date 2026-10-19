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
          padding: '80px 96px', color: '#eceff4',
          background: '#2b303b', borderLeft: '16px solid #88c0d0',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, color: '#88c0d0', marginBottom: 28 }}>noahstuf.com</div>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{DEFAULT_PROFILE.name}</div>
        <div style={{ display: 'flex', fontSize: 36, color: '#a3adbf', marginTop: 28, lineHeight: 1.35, maxWidth: 980 }}>{DEFAULT_PROFILE.headline}</div>
        <div style={{ display: 'flex', fontSize: 26, color: '#a3be8c', marginTop: 44 }}>● Self-hosted on a Raspberry Pi</div>
      </div>
    ),
    size,
  );
}
